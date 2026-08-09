import {
  NO_CAPABILITIES,
  PLATFORM_FAILURES,
  ok,
} from './result.js';

const DEFAULT_LOCALE = 'en-US';
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

function normalizeLocale(value) {
  if (typeof value !== 'string') return DEFAULT_LOCALE;
  const locale = value.trim();
  return locale.length <= 35 && LOCALE_PATTERN.test(locale) ? locale : DEFAULT_LOCALE;
}

function nonEmptyString(value, maxLength = 128) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function subscribeEventSource(eventSource, name, emit) {
  const subscribe = eventSource?.[name];
  if (subscribe === undefined) return () => {};
  if (typeof subscribe !== 'function') {
    throw new TypeError(`Standalone event source ${name} must be a function.`);
  }
  const unsubscribe = subscribe(emit);
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

export function createStandalonePublisherPlatform(options = {}) {
  const pauseHandlers = new Set();
  const resumeHandlers = new Set();
  let state = 'new';
  const context = Object.freeze({
    userState: 'anonymous',
    locale: normalizeLocale(options.locale),
    capabilities: NO_CAPABILITIES,
  });

  const emit = (handlers) => {
    if (state === 'destroyed') return;
    for (const handler of [...handlers]) {
      try {
        handler();
      } catch {
        // A host callback must not prevent the remaining subscribers from running.
      }
    }
  };

  const sourceUnsubscribers = [
    subscribeEventSource(options.eventSource, 'onPause', () => emit(pauseHandlers)),
    subscribeEventSource(options.eventSource, 'onResume', () => emit(resumeHandlers)),
  ];

  const guard = () => {
    if (state === 'destroyed') return PLATFORM_FAILURES.destroyed;
    if (state !== 'initialized') return PLATFORM_FAILURES.notInitialized;
    return null;
  };

  const lifecycle = (validator = null) => async (value) => {
    const blocked = guard();
    if (blocked) return blocked;
    if (validator && !validator(value)) return PLATFORM_FAILURES.invalidArgument;
    return ok(undefined);
  };

  const unsupported = async () => guard() ?? PLATFORM_FAILURES.unsupported;

  const subscribe = (handlers, handler) => {
    if (typeof handler !== 'function') throw new TypeError('Publisher callback must be a function.');
    if (state === 'destroyed') return () => {};
    handlers.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      handlers.delete(handler);
    };
  };

  return Object.freeze({
    capabilities: NO_CAPABILITIES,

    async initialize() {
      if (state === 'destroyed') return PLATFORM_FAILURES.destroyed;
      state = 'initialized';
      return ok(context);
    },

    signalReady: lifecycle(),
    signalGameStart: lifecycle(),
    signalScore: lifecycle((score) => Number.isSafeInteger(score) && score >= 0),
    signalLevelStart: lifecycle((levelId) => nonEmptyString(levelId)),
    signalLevelEnd: lifecycle((levelId) => nonEmptyString(levelId)),
    signalGameEnd: lifecycle((reason) => nonEmptyString(reason)),

    onPause(handler) {
      return subscribe(pauseHandlers, handler);
    },

    onResume(handler) {
      return subscribe(resumeHandlers, handler);
    },

    loadSave: unsupported,
    writeSave: unsupported,
    track: unsupported,
    showInterstitial: unsupported,
    showRewarded: unsupported,
    getWalletBalance: unsupported,
    consumeCurrency: unsupported,
    submitLeaderboard: unsupported,

    async destroy() {
      if (state === 'destroyed') return;
      state = 'destroyed';
      pauseHandlers.clear();
      resumeHandlers.clear();
      for (const unsubscribe of sourceUnsubscribers) {
        try {
          unsubscribe();
        } catch {
          // Teardown remains idempotent even when an injected source misbehaves.
        }
      }
    },
  });
}
