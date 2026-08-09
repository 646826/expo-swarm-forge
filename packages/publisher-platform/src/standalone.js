import { LifecycleGuard } from './lifecycle.js';
import { NO_CAPABILITIES, err, ok } from './result.js';

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
  const guard = new LifecycleGuard();
  const pauseHandlers = new Set();
  const resumeHandlers = new Set();
  const context = Object.freeze({
    userState: 'anonymous',
    locale: normalizeLocale(options.locale),
    capabilities: NO_CAPABILITIES,
  });

  const emit = (handlers) => {
    if (guard.state === 'destroyed') return;
    for (const handler of [...handlers]) {
      try {
        handler();
      } catch {
        // A host callback must not prevent remaining subscribers from running.
      }
    }
  };

  const sourceUnsubscribers = [
    subscribeEventSource(options.eventSource, 'onPause', () => emit(pauseHandlers)),
    subscribeEventSource(options.eventSource, 'onResume', () => emit(resumeHandlers)),
  ];

  const subscribe = (handlers, handler) => {
    if (typeof handler !== 'function') throw new TypeError('Publisher callback must be a function.');
    if (guard.state === 'destroyed') return () => {};
    handlers.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      handlers.delete(handler);
    };
  };

  const requireCapability = (capability) => {
    if (guard.state === 'destroyed') {
      return err('DESTROYED', 'Platform has been destroyed.', false);
    }
    if (guard.state === 'new') {
      return err('NOT_INITIALIZED', 'Platform has not been initialized.', true);
    }
    return err('UNSUPPORTED_CAPABILITY', `Capability ${capability} is unavailable.`, true);
  };

  return Object.freeze({
    capabilities: NO_CAPABILITIES,

    async initialize() {
      const transition = guard.markInitialized();
      if (!transition.ok) return transition;
      return ok(context);
    },

    async signalReady() {
      return guard.markReady();
    },

    async signalGameStart() {
      return guard.markGameStarted();
    },

    async signalScore(score) {
      const active = guard.assertGameplayActive();
      if (!active.ok) return active;
      if (!Number.isSafeInteger(score) || score < 0) {
        return err('INVALID_ARGUMENT', 'Score must be a non-negative safe integer.', false);
      }
      return ok(undefined);
    },

    async signalLevelStart(levelId) {
      const active = guard.assertGameplayActive();
      if (!active.ok) return active;
      if (!nonEmptyString(levelId)) {
        return err('INVALID_ARGUMENT', 'Level ID must be a non-empty string.', false);
      }
      return ok(undefined);
    },

    async signalLevelEnd(levelId) {
      const active = guard.assertGameplayActive();
      if (!active.ok) return active;
      if (!nonEmptyString(levelId)) {
        return err('INVALID_ARGUMENT', 'Level ID must be a non-empty string.', false);
      }
      return ok(undefined);
    },

    async signalGameEnd(reason) {
      const active = guard.assertGameplayActive();
      if (!active.ok) return active;
      if (!nonEmptyString(reason)) {
        return err('INVALID_ARGUMENT', 'Game-end reason must be a non-empty string.', false);
      }
      return guard.markGameEnded();
    },

    onPause(handler) {
      return subscribe(pauseHandlers, handler);
    },

    onResume(handler) {
      return subscribe(resumeHandlers, handler);
    },

    async loadSave() { return requireCapability('persistence'); },
    async writeSave() { return requireCapability('persistence'); },
    async track() { return requireCapability('analytics'); },
    async showInterstitial() { return requireCapability('interstitialAds'); },
    async showRewarded() { return requireCapability('rewardedAds'); },
    async getWalletBalance() { return requireCapability('wallet'); },
    async consumeCurrency() { return requireCapability('wallet'); },
    async submitLeaderboard() { return requireCapability('leaderboards'); },

    async destroy() {
      if (guard.state === 'destroyed') return;
      guard.markDestroyed();
      pauseHandlers.clear();
      resumeHandlers.clear();
      for (const unsubscribe of sourceUnsubscribers) {
        try {
          unsubscribe();
        } catch {
          // Teardown remains idempotent when an injected source misbehaves.
        }
      }
    },
  });
}
