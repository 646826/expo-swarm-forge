import { validateRuntimeManifest } from '../../../../packages/integration-config/src/index.js';

const EXPECTED_OFFICIAL_SDK_VERSION = '2.66.2';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const EVIDENCE_MODES = new Set(['standalone', 'arkadium-sandbox', 'arkadium-dev']);
const SESSION_PHASES = new Set([
  'new',
  'initializing',
  'ready',
  'playing',
  'paused',
  'ended',
  'destroyed',
]);
const DELIVERY_OUTCOMES = new Set(['delivered', 'failed', 'dropped', 'beaconed']);
const SNAPSHOT_OPTION_KEYS = Object.freeze([
  'runtimeManifest',
  'sdkVersion',
  'sessionId',
  'integrationDiagnostics',
  'deliveryDiagnostics',
]);
const INSTALL_OPTION_KEYS = Object.freeze([
  'runtimeManifest',
  'sdkVersion',
  'sessionId',
  'getIntegrationDiagnostics',
  'getDeliveryDiagnostics',
  'globalImpl',
  'search',
]);
const INTEGRATION_KEYS = Object.freeze(['phase', 'events', 'deliveryFailures']);
const DELIVERY_KEYS = Object.freeze([
  'sessionId',
  'queueCount',
  'droppedCount',
  'inFlight',
  'lastResult',
]);
const LAST_RESULT_KEYS = Object.freeze([
  'outcome',
  'attempts',
  'batchSize',
  'httpStatus',
]);

function optionsError() {
  throw new TypeError('Telemetry evidence options are invalid.');
}

function contextError() {
  throw new Error('Telemetry evidence context is invalid.');
}

function diagnosticsError() {
  throw new Error('Telemetry evidence diagnostics are invalid.');
}

function apiError() {
  throw new Error('Telemetry evidence API cannot be installed.');
}

function exactDataDescriptors(value, expectedKeys, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();

  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    if (Object.getOwnPropertySymbols(value).length > 0) fail();
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail();
  }
  if (prototype !== Object.prototype && prototype !== null) fail();

  const actual = Object.keys(descriptors).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) fail();
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function read(descriptors, key, fail) {
  const descriptor = descriptors[key];
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function plainDataDescriptors(value, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    if (Object.getOwnPropertySymbols(value).length > 0) fail();
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail();
  }
  if (prototype !== Object.prototype && prototype !== null) fail();
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function exactArrayValues(value, maximum, fail) {
  if (!Array.isArray(value)) fail();
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    if (Object.getOwnPropertySymbols(value).length > 0) fail();
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail();
  }
  if (prototype !== Array.prototype) fail();
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) fail();
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== length) fail();

  const values = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) fail();
    values.push(descriptor.value);
  }
  return values;
}

function boundedInteger(value, minimum, maximum, fail) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function normalizeContext(runtimeManifest, sdkVersion, sessionId) {
  let manifest;
  try {
    manifest = validateRuntimeManifest(runtimeManifest);
  } catch {
    contextError();
  }
  if (!EVIDENCE_MODES.has(manifest.mode)
    || typeof sessionId !== 'string'
    || !UUID_V4.test(sessionId)) contextError();
  if (manifest.mode === 'standalone') {
    if (sdkVersion !== null) contextError();
  } else if (sdkVersion !== EXPECTED_OFFICIAL_SDK_VERSION) {
    contextError();
  }
  return manifest;
}

function normalizeEventNames(value) {
  const events = exactArrayValues(value, 256, diagnosticsError);
  return events.map((event) => {
    const descriptors = plainDataDescriptors(event, diagnosticsError);
    const name = read(descriptors, 'name', diagnosticsError);
    if (typeof name !== 'string' || !EVENT_NAME.test(name)) diagnosticsError();
    return name;
  });
}

function validateDeliveryFailures(value) {
  const failures = exactArrayValues(value, 64, diagnosticsError);
  for (const failure of failures) plainDataDescriptors(failure, diagnosticsError);
}

function normalizeIntegrationDiagnostics(value) {
  const descriptors = exactDataDescriptors(value, INTEGRATION_KEYS, diagnosticsError);
  const phase = read(descriptors, 'phase', diagnosticsError);
  if (typeof phase !== 'string' || !SESSION_PHASES.has(phase)) diagnosticsError();
  const eventNames = normalizeEventNames(read(descriptors, 'events', diagnosticsError));
  validateDeliveryFailures(read(descriptors, 'deliveryFailures', diagnosticsError));
  return Object.freeze({
    phase,
    eventCount: eventNames.length,
    lastEventName: eventNames.at(-1) ?? null,
  });
}

function normalizeLastDelivery(value) {
  if (value === null) return null;
  const descriptors = exactDataDescriptors(value, LAST_RESULT_KEYS, diagnosticsError);
  const outcome = read(descriptors, 'outcome', diagnosticsError);
  const attempts = read(descriptors, 'attempts', diagnosticsError);
  const batchSize = read(descriptors, 'batchSize', diagnosticsError);
  const httpStatus = read(descriptors, 'httpStatus', diagnosticsError);
  if (typeof outcome !== 'string' || !DELIVERY_OUTCOMES.has(outcome)) diagnosticsError();
  boundedInteger(attempts, 0, 5, diagnosticsError);
  boundedInteger(batchSize, 0, 32, diagnosticsError);
  if (httpStatus !== null) boundedInteger(httpStatus, 100, 599, diagnosticsError);
  return Object.freeze({ outcome, attempts, batchSize, httpStatus });
}

function normalizeDeliveryDiagnostics(value, expectedSessionId) {
  const descriptors = exactDataDescriptors(value, DELIVERY_KEYS, diagnosticsError);
  const sessionId = read(descriptors, 'sessionId', diagnosticsError);
  const queueCount = read(descriptors, 'queueCount', diagnosticsError);
  const droppedCount = read(descriptors, 'droppedCount', diagnosticsError);
  const inFlight = read(descriptors, 'inFlight', diagnosticsError);
  if (sessionId !== expectedSessionId) diagnosticsError();
  boundedInteger(queueCount, 0, 256, diagnosticsError);
  boundedInteger(droppedCount, 0, 1_000_000_000, diagnosticsError);
  if (typeof inFlight !== 'boolean') diagnosticsError();
  return Object.freeze({
    queueCount,
    droppedCount,
    inFlight,
    lastDelivery: normalizeLastDelivery(read(descriptors, 'lastResult', diagnosticsError)),
  });
}

function snapshotFromValues({
  runtimeManifest,
  sdkVersion,
  sessionId,
  integrationDiagnostics,
  deliveryDiagnostics,
}) {
  const manifest = normalizeContext(runtimeManifest, sdkVersion, sessionId);
  const integration = normalizeIntegrationDiagnostics(integrationDiagnostics);
  const delivery = normalizeDeliveryDiagnostics(deliveryDiagnostics, sessionId);
  return Object.freeze({
    schemaVersion: 1,
    source: 'local-browser-telemetry',
    sessionId,
    buildSha: manifest.buildSha,
    gameVersion: manifest.gameVersion,
    platformMode: manifest.mode,
    sdkVersion,
    phase: integration.phase,
    eventCount: integration.eventCount,
    lastEventName: integration.lastEventName,
    queueCount: delivery.queueCount,
    droppedCount: delivery.droppedCount,
    inFlight: delivery.inFlight,
    lastDelivery: delivery.lastDelivery,
  });
}

export function createTelemetryEvidenceSnapshot(options) {
  const descriptors = exactDataDescriptors(options, SNAPSHOT_OPTION_KEYS, optionsError);
  return snapshotFromValues({
    runtimeManifest: read(descriptors, 'runtimeManifest', optionsError),
    sdkVersion: read(descriptors, 'sdkVersion', optionsError),
    sessionId: read(descriptors, 'sessionId', optionsError),
    integrationDiagnostics: read(descriptors, 'integrationDiagnostics', optionsError),
    deliveryDiagnostics: read(descriptors, 'deliveryDiagnostics', optionsError),
  });
}

function optedIn(search) {
  if (typeof search !== 'string' || search.length > 2_048) optionsError();
  try {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      .get('telemetryEvidence') === '1';
  } catch {
    return false;
  }
}

export function installTelemetryEvidenceApi(options) {
  const descriptors = exactDataDescriptors(options, INSTALL_OPTION_KEYS, optionsError);
  const search = read(descriptors, 'search', optionsError);
  if (!optedIn(search)) return null;

  const runtimeManifest = read(descriptors, 'runtimeManifest', optionsError);
  let manifest;
  try {
    manifest = validateRuntimeManifest(runtimeManifest);
  } catch {
    contextError();
  }
  if (manifest.mode === 'arkadium-prod') return null;

  const sdkVersion = read(descriptors, 'sdkVersion', optionsError);
  const sessionId = read(descriptors, 'sessionId', optionsError);
  normalizeContext(runtimeManifest, sdkVersion, sessionId);

  const getIntegrationDiagnostics = read(
    descriptors,
    'getIntegrationDiagnostics',
    optionsError,
  );
  const getDeliveryDiagnostics = read(
    descriptors,
    'getDeliveryDiagnostics',
    optionsError,
  );
  const globalImpl = read(descriptors, 'globalImpl', optionsError);
  if (typeof getIntegrationDiagnostics !== 'function'
    || typeof getDeliveryDiagnostics !== 'function'
    || (!globalImpl || !['object', 'function'].includes(typeof globalImpl))
    || Object.prototype.hasOwnProperty.call(globalImpl, '__CANYON_TELEMETRY_EVIDENCE__')) {
    apiError();
  }

  const readEvidence = () => {
    let integrationDiagnostics;
    let deliveryDiagnostics;
    try {
      integrationDiagnostics = getIntegrationDiagnostics();
      deliveryDiagnostics = getDeliveryDiagnostics();
    } catch {
      throw new Error('Telemetry evidence is unavailable.');
    }
    return snapshotFromValues({
      runtimeManifest,
      sdkVersion,
      sessionId,
      integrationDiagnostics,
      deliveryDiagnostics,
    });
  };

  try {
    Object.defineProperty(globalImpl, '__CANYON_TELEMETRY_EVIDENCE__', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: readEvidence,
    });
  } catch {
    apiError();
  }

  let active = true;
  return Object.freeze({
    read: readEvidence,
    destroy() {
      if (!active) return;
      active = false;
      const descriptor = Object.getOwnPropertyDescriptor(
        globalImpl,
        '__CANYON_TELEMETRY_EVIDENCE__',
      );
      if (descriptor?.value === readEvidence) {
        delete globalImpl.__CANYON_TELEMETRY_EVIDENCE__;
      }
    },
  });
}
