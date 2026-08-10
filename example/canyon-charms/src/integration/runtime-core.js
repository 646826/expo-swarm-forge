import {
  createCanonicalEventFactory,
  createEventDispatcher,
} from '../../../../packages/game-events/src/index.js';
import { createStandalonePublisherPlatform } from '../../../../packages/publisher-platform/src/index.js';
import { createGameSessionController } from '../session/controller.js';

const MAX_DIAGNOSTIC_EVENTS = 256;
const MAX_DELIVERY_FAILURES = 64;

function defaultNow() {
  return new Date().toISOString();
}

function defaultId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10).join(''),
    ].join('-');
  }
  throw new Error('A cryptographic UUID source is required for integration events.');
}

function boundedPush(target, value, limit) {
  if (target.length === limit) target.shift();
  target.push(value);
}

function validCompletion(value) {
  return value
    && typeof value === 'object'
    && typeof value.levelId === 'string'
    && typeof value.result === 'string'
    && typeof value.reason === 'string'
    && Number.isSafeInteger(value.score)
    && value.score >= 0
    && Number.isSafeInteger(value.movesRemaining)
    && value.movesRemaining >= 0;
}

/**
 * Connects Canyon Charms session semantics to one reviewed canonical event
 * stream. It remains fully playable with the typed standalone platform; Task 7
 * supplies the exact official Arkadium implementation through the same port.
 */
export function createCanyonIntegration({
  platform = createStandalonePublisherPlatform(),
  platformMode = 'standalone',
  publisherMode = platformMode !== 'standalone',
  sinks = [],
  now = defaultNow,
  createId = defaultId,
  setPaused = () => {},
  suspendAudio = () => {},
  resumeAudio = () => {},
  reportIntegrationError = () => {},
} = {}) {
  if (!Array.isArray(sinks)) throw new TypeError('Integration sinks must be an array.');

  const events = [];
  const deliveryFailures = [];
  const createEvent = createCanonicalEventFactory({ now, createId });
  const localDiagnosticsSink = Object.freeze({
    id: 'canyon-diagnostics',
    route: 'gameEye',
    async dispatch(event) {
      boundedPush(events, event, MAX_DIAGNOSTIC_EVENTS);
    },
  });
  const dispatcher = createEventDispatcher([localDiagnosticsSink, ...sinks]);
  let chain = Promise.resolve();
  let completion = null;

  async function emit(name, properties = {}) {
    const event = createEvent(name, properties);
    const result = await dispatcher.dispatch(event);
    for (const failed of result.failed) {
      boundedPush(deliveryFailures, Object.freeze({
        eventId: event.eventId,
        eventName: event.name,
        sinkId: failed.id,
        code: failed.code,
      }), MAX_DELIVERY_FAILURES);
    }
    return event;
  }

  async function handleTransition(type, payload) {
    if (type === 'initialization-started') {
      await emit('sdk_initialize_started', { mode: platformMode });
      return;
    }
    if (type === 'initialized') {
      const context = payload.context ?? {};
      await emit('sdk_initialize_succeeded', {
        mode: platformMode,
        userState: context.userState ?? 'anonymous',
        locale: context.locale ?? 'en-US',
      });
      return;
    }
    if (type === 'ready') {
      await emit('sdk_ready');
      return;
    }
    if (type === 'game-started') {
      await emit('game_start', { levelId: payload.levelId });
      return;
    }
    if (type === 'level-started') {
      await emit('level_start', { levelId: payload.levelId });
      return;
    }
    if (type === 'score') {
      await emit('score_changed', { score: payload.score });
      return;
    }
    if (type === 'paused') {
      await emit('pause', { source: payload.source });
      return;
    }
    if (type === 'resumed') {
      await emit('resume', { source: payload.source });
      return;
    }
    if (type === 'level-ended' && completion) {
      await emit('level_end', {
        levelId: completion.levelId,
        result: completion.result,
        score: completion.score,
        movesRemaining: completion.movesRemaining,
      });
      return;
    }
    if (type === 'game-ended' && completion) {
      await emit('game_end', {
        reason: completion.reason,
        score: completion.score,
      });
      return;
    }
    if (type === 'integration-error') {
      await emit('integration_error', {
        stage: payload.stage,
        code: payload.code,
      });
    }
  }

  const controller = createGameSessionController({
    platform,
    publisherMode,
    setPaused,
    suspendAudio,
    resumeAudio,
    reportIntegrationError,
    onTransition: handleTransition,
  });

  function enqueue(operation) {
    const scheduled = chain.then(operation, operation);
    chain = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  function boot() {
    return enqueue(() => controller.boot());
  }

  function startLevel(levelId) {
    return enqueue(() => controller.startLevel(levelId));
  }

  function moveRejected({ reason, movesRemaining }) {
    return enqueue(async () => {
      await emit('move_rejected', { reason, movesRemaining });
      return Object.freeze({ ok: true, value: undefined });
    });
  }

  function moveAccepted({ scoreDelta, combo, movesRemaining, totalScore }) {
    return enqueue(async () => {
      await emit('move_accepted', { scoreDelta, combo, movesRemaining });
      return controller.score(totalScore);
    });
  }

  function pause(source = 'player') {
    return enqueue(() => controller.pause(source));
  }

  function resume(source = 'player') {
    return enqueue(() => controller.resume(source));
  }

  function complete(value) {
    return enqueue(async () => {
      if (!validCompletion(value)) {
        throw new TypeError('Completion requires reviewed level, result, reason, score, and moves fields.');
      }
      completion = Object.freeze({ ...value });
      try {
        return await controller.endLevel(value.levelId, value.reason);
      } finally {
        completion = null;
      }
    });
  }

  function destroy() {
    return enqueue(() => controller.destroy());
  }

  async function settled() {
    await chain;
    await controller.settled();
  }

  function diagnostics() {
    return Object.freeze({
      phase: controller.phase,
      events: Object.freeze([...events]),
      deliveryFailures: Object.freeze([...deliveryFailures]),
    });
  }

  return Object.freeze({
    get phase() {
      return controller.phase;
    },
    boot,
    startLevel,
    moveRejected,
    moveAccepted,
    pause,
    resume,
    complete,
    destroy,
    settled,
    diagnostics,
  });
}
