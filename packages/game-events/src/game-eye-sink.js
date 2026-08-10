import { validateCanonicalEvent } from './catalog.js';

const ENVELOPE_SCHEMA = 'ark.game-events.v1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILD_SHA = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const LOCALE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const PLATFORM_MODES = Object.freeze([
  'standalone',
  'arkadium-sandbox',
  'arkadium-dev',
  'arkadium-prod',
]);
const USER_STATES = Object.freeze(['anonymous', 'registered', 'subscriber']);
const CONTEXT_KEYS = Object.freeze([
  'project',
  'gameVersion',
  'buildSha',
  'platformMode',
  'sdkVersion',
  'locale',
  'userState',
]);

export const GAME_EYE_LIMITS = Object.freeze({
  maxBatchSize: 32,
  maxPayloadBytes: 65_536,
  maxQueueSize: 256,
  maxRetryDelays: 4,
});

function defaultSessionId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Game Eye requires a cryptographic UUID source.');
  }
  return globalThis.crypto.randomUUID();
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) return false;
  }
  return true;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function normalizeContext(value) {
  if (!assertPlainObject(value) || !exactKeys(value, CONTEXT_KEYS)) {
    throw new Error('Game Eye context configuration is invalid.');
  }
  const normalized = {
    project: value.project,
    gameVersion: value.gameVersion,
    buildSha: value.buildSha,
    platformMode: value.platformMode,
    sdkVersion: value.sdkVersion,
    locale: value.locale,
    userState: value.userState,
  };
  if (typeof normalized.project !== 'string' || !IDENTIFIER.test(normalized.project)) {
    throw new Error('Game Eye context configuration is invalid.');
  }
  if (typeof normalized.gameVersion !== 'string' || !VERSION.test(normalized.gameVersion)) {
    throw new Error('Game Eye context configuration is invalid.');
  }
  if (typeof normalized.buildSha !== 'string' || !BUILD_SHA.test(normalized.buildSha)) {
    throw new Error('Game Eye context configuration is invalid.');
  }
  if (!PLATFORM_MODES.includes(normalized.platformMode)) {
    throw new Error('Game Eye context configuration is invalid.');
  }
  if (normalized.sdkVersion !== null
    && (typeof normalized.sdkVersion !== 'string' || !VERSION.test(normalized.sdkVersion))) {
    throw new Error('Game Eye context configuration is invalid.');
  }
  if (typeof normalized.locale !== 'string'
    || normalized.locale.length > 35
    || !LOCALE.test(normalized.locale)) {
    throw new Error('Game Eye context configuration is invalid.');
  }
  if (!USER_STATES.includes(normalized.userState)) {
    throw new Error('Game Eye context configuration is invalid.');
  }
  return normalized;
}

function normalizeEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('Game Eye endpoint is invalid.');
  }
  const localHttp = endpoint.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !localHttp)
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || endpoint.pathname.length < 2) {
    throw new Error('Game Eye endpoint is invalid.');
  }
  return endpoint.href;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} is outside the reviewed limit.`);
  }
  return value;
}

function normalizeRetryDelays(value) {
  if (!Array.isArray(value) || value.length > GAME_EYE_LIMITS.maxRetryDelays) {
    throw new TypeError('Game Eye retry configuration is invalid.');
  }
  return Object.freeze(value.map((delay) => boundedInteger(
    delay,
    0,
    10_000,
    'Game Eye retry delay',
  )));
}

function cloneEvent(value) {
  try {
    validateCanonicalEvent(value);
    const cloned = {
      eventId: value.eventId,
      name: value.name,
      version: value.version,
      sequence: value.sequence,
      occurredAt: value.occurredAt,
      properties: { ...value.properties },
    };
    validateCanonicalEvent(cloned);
    return Object.freeze({
      ...cloned,
      properties: Object.freeze(cloned.properties),
    });
  } catch {
    throw new Error('Game Eye event is invalid.');
  }
}

function safeStatus(response) {
  return Number.isSafeInteger(response?.status)
    && response.status >= 100
    && response.status <= 599
    ? response.status
    : null;
}

function result(ok, valueOrCode) {
  return ok
    ? Object.freeze({ ok: true, value: Object.freeze(valueOrCode) })
    : Object.freeze({
      ok: false,
      error: Object.freeze({ code: valueOrCode, retryable: true }),
    });
}

function deliveryResult(outcome, attempts, batchSize, httpStatus) {
  return Object.freeze({ outcome, attempts, batchSize, httpStatus });
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function removeDelivered(queue, batch) {
  const deliveredIds = new Set(batch.map((event) => event.eventId));
  return queue.filter((event) => !deliveredIds.has(event.eventId));
}

function defaultBeacon() {
  if (typeof globalThis.navigator?.sendBeacon !== 'function') return null;
  return globalThis.navigator.sendBeacon.bind(globalThis.navigator);
}

/**
 * Creates the reviewed Game Eye transport. `dispatch` only validates and
 * queues; network failure is recorded structurally and never blocks gameplay.
 */
export function createGameEyeSink({
  endpoint,
  context,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  beaconImpl = defaultBeacon(),
  createSessionId = defaultSessionId,
  retryDelaysMs = [250, 1_000],
  sleepImpl = defaultSleep,
  autoFlush = true,
  maxBatchSize = GAME_EYE_LIMITS.maxBatchSize,
  maxPayloadBytes = GAME_EYE_LIMITS.maxPayloadBytes,
  maxQueueSize = GAME_EYE_LIMITS.maxQueueSize,
} = {}) {
  const target = normalizeEndpoint(endpoint);
  const audience = normalizeContext(context);
  if (typeof fetchImpl !== 'function'
    || (beaconImpl !== null && typeof beaconImpl !== 'function')
    || typeof createSessionId !== 'function'
    || typeof sleepImpl !== 'function'
    || typeof autoFlush !== 'boolean') {
    throw new Error('Game Eye sink configuration is invalid.');
  }
  const retries = normalizeRetryDelays(retryDelaysMs);
  const batchLimit = boundedInteger(
    maxBatchSize,
    1,
    GAME_EYE_LIMITS.maxBatchSize,
    'Game Eye batch size',
  );
  const payloadLimit = boundedInteger(
    maxPayloadBytes,
    1_024,
    GAME_EYE_LIMITS.maxPayloadBytes,
    'Game Eye payload size',
  );
  const queueLimit = boundedInteger(
    maxQueueSize,
    1,
    GAME_EYE_LIMITS.maxQueueSize,
    'Game Eye queue size',
  );

  let sessionId;
  try {
    sessionId = createSessionId();
  } catch {
    throw new Error('Game Eye sink configuration is invalid.');
  }
  if (typeof sessionId !== 'string' || !UUID_V4.test(sessionId)) {
    throw new Error('Game Eye sink configuration is invalid.');
  }

  let queue = [];
  let droppedCount = 0;
  let lastSequence = 0;
  let lastResult = null;
  let inFlight = null;
  let scheduled = null;
  let destroyed = false;
  const listeners = new Set();

  function diagnostics() {
    return Object.freeze({
      sessionId,
      queueCount: queue.length,
      droppedCount,
      inFlight: Boolean(inFlight),
      lastResult,
    });
  }

  function notify() {
    const snapshot = diagnostics();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Diagnostic listeners are observers and cannot affect delivery.
      }
    }
  }

  function envelopeFor(batch) {
    if (!Array.isArray(batch) || batch.length < 1 || batch.length > batchLimit) {
      throw new Error('Game Eye envelope is invalid.');
    }
    let previous = 0;
    for (const event of batch) {
      try {
        validateCanonicalEvent(event);
      } catch {
        throw new Error('Game Eye envelope is invalid.');
      }
      if (event.sequence <= previous) throw new Error('Game Eye envelope is invalid.');
      previous = event.sequence;
    }
    const envelope = {
      schema: ENVELOPE_SCHEMA,
      project: audience.project,
      gameVersion: audience.gameVersion,
      buildSha: audience.buildSha,
      platformMode: audience.platformMode,
      sdkVersion: audience.sdkVersion,
      sessionId,
      locale: audience.locale,
      userState: audience.userState,
      events: batch,
    };
    const body = JSON.stringify(envelope);
    if (byteLength(body) > payloadLimit) {
      throw new Error('Game Eye envelope exceeds the reviewed payload limit.');
    }
    return Object.freeze({ envelope: Object.freeze(envelope), body });
  }

  function nextBatch() {
    let size = Math.min(batchLimit, queue.length);
    while (size > 0) {
      const batch = queue.slice(0, size);
      try {
        return Object.freeze({ batch: Object.freeze(batch), ...envelopeFor(batch) });
      } catch (error) {
        if (!/payload limit/i.test(error.message) || size === 1) throw error;
        size -= 1;
      }
    }
    return null;
  }

  async function performFlush(singleBatch) {
    let delivered = 0;
    while (queue.length > 0) {
      let prepared;
      try {
        prepared = nextBatch();
      } catch {
        lastResult = deliveryResult('failed', 0, 0, null);
        notify();
        return result(false, 'PAYLOAD_VALIDATION_FAILED');
      }
      if (!prepared) break;

      let deliveredBatch = false;
      let httpStatus = null;
      let attempts = 0;
      for (let attempt = 0; attempt <= retries.length; attempt += 1) {
        if (attempt > 0) await sleepImpl(retries[attempt - 1]);
        attempts += 1;
        try {
          const response = await fetchImpl(target, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: prepared.body,
            keepalive: true,
          });
          httpStatus = safeStatus(response);
          if (response?.ok === true) {
            deliveredBatch = true;
            break;
          }
        } catch {
          httpStatus = null;
        }
      }

      if (!deliveredBatch) {
        lastResult = deliveryResult(
          'failed',
          attempts,
          prepared.batch.length,
          httpStatus,
        );
        notify();
        return result(false, 'DELIVERY_FAILED');
      }

      queue = removeDelivered(queue, prepared.batch);
      delivered += prepared.batch.length;
      lastResult = deliveryResult(
        'delivered',
        attempts,
        prepared.batch.length,
        httpStatus,
      );
      notify();
      if (singleBatch) break;
    }
    return result(true, { delivered, remaining: queue.length });
  }

  function startFlush(singleBatch) {
    if (inFlight) return inFlight;
    const operation = performFlush(singleBatch);
    inFlight = operation.finally(() => {
      inFlight = null;
      notify();
    });
    notify();
    return inFlight;
  }

  function scheduleFlush() {
    if (destroyed || scheduled || inFlight || queue.length === 0) return;
    scheduled = Promise.resolve()
      .then(() => {
        scheduled = null;
        return startFlush(false);
      })
      .catch(() => undefined);
  }

  async function enqueue(value) {
    if (destroyed) throw new Error('Game Eye sink is destroyed.');
    const event = cloneEvent(value);
    if (event.sequence <= lastSequence) throw new Error('Game Eye event is invalid.');
    lastSequence = event.sequence;

    if (queue.length === queueLimit) {
      queue.shift();
      droppedCount += 1;
      lastResult = deliveryResult('dropped', 0, 1, null);
    }
    queue.push(event);
    if (event.name === 'sdk_initialize_succeeded') {
      if (typeof event.properties.locale === 'string') audience.locale = event.properties.locale;
      if (USER_STATES.includes(event.properties.userState)) audience.userState = event.properties.userState;
    }
    notify();
    return event;
  }

  async function dispatch(event) {
    await enqueue(event);
    if (autoFlush) scheduleFlush();
  }

  async function flush() {
    if (destroyed) return result(false, 'SINK_DESTROYED');
    if (scheduled) await scheduled;
    if (inFlight) await inFlight;
    if (queue.length === 0) return result(true, { delivered: 0, remaining: 0 });
    return startFlush(false);
  }

  function flushOnUnload() {
    if (destroyed || queue.length === 0) {
      return result(true, { delivered: 0, remaining: queue.length });
    }
    if (typeof beaconImpl !== 'function') return result(false, 'BEACON_UNAVAILABLE');

    let prepared;
    try {
      prepared = nextBatch();
    } catch {
      lastResult = deliveryResult('failed', 0, 0, null);
      notify();
      return result(false, 'PAYLOAD_VALIDATION_FAILED');
    }

    let accepted = false;
    try {
      accepted = beaconImpl(
        target,
        new Blob([prepared.body], { type: 'application/json' }),
      ) === true;
    } catch {
      accepted = false;
    }
    if (!accepted) {
      lastResult = deliveryResult('failed', 1, prepared.batch.length, null);
      notify();
      return result(false, 'BEACON_REJECTED');
    }

    queue = removeDelivered(queue, prepared.batch);
    lastResult = deliveryResult('beaconed', 1, prepared.batch.length, null);
    notify();
    return result(true, { delivered: prepared.batch.length, remaining: queue.length });
  }

  async function settled() {
    if (scheduled) await scheduled;
    if (inFlight) await inFlight;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Game Eye diagnostic listener must be a function.');
    }
    listeners.add(listener);
    listener(diagnostics());
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function queuedEvents() {
    return Object.freeze([...queue]);
  }

  function destroy({ useBeacon = true } = {}) {
    if (destroyed) return;
    if (useBeacon) flushOnUnload();
    destroyed = true;
    listeners.clear();
  }

  return Object.freeze({
    id: 'game-eye',
    route: 'gameEye',
    get sessionId() {
      return sessionId;
    },
    enqueue,
    dispatch,
    flush,
    flushOnUnload,
    settled,
    diagnostics,
    subscribe,
    queuedEvents,
    destroy,
  });
}
