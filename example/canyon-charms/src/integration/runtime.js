import { NO_CAPABILITIES } from '../../../../packages/publisher-platform/src/index.js';
import { createCanyonIntegration as createCoreIntegration } from './runtime-core.js';

function createDeferredRuntimePlatform(runtimeManifest) {
  let platformPromise = null;
  let resolvedPlatform = null;
  let destroyed = false;

  async function platform() {
    if (destroyed) throw new Error('Runtime publisher platform has been destroyed.');
    if (!platformPromise) {
      platformPromise = import('../platform/runtime-platform.js')
        .then(({ createRuntimePlatform }) => createRuntimePlatform(runtimeManifest))
        .then((value) => {
          resolvedPlatform = value;
          return value;
        });
    }
    return platformPromise;
  }

  async function call(method, ...args) {
    const target = await platform();
    if (typeof target?.[method] !== 'function') {
      throw new Error('Runtime publisher platform does not implement the required contract.');
    }
    return target[method](...args);
  }

  function subscribe(method, handler) {
    if (!resolvedPlatform || typeof resolvedPlatform[method] !== 'function') {
      throw new Error('Runtime publisher platform must initialize before lifecycle subscription.');
    }
    return resolvedPlatform[method](handler);
  }

  return Object.freeze({
    get capabilities() {
      return resolvedPlatform?.capabilities ?? NO_CAPABILITIES;
    },
    initialize: () => call('initialize'),
    signalReady: () => call('signalReady'),
    signalGameStart: () => call('signalGameStart'),
    signalScore: (value) => call('signalScore', value),
    signalLevelStart: (levelId) => call('signalLevelStart', levelId),
    signalLevelEnd: (levelId) => call('signalLevelEnd', levelId),
    signalGameEnd: (reason) => call('signalGameEnd', reason),
    onPause: (handler) => subscribe('onPause', handler),
    onResume: (handler) => subscribe('onResume', handler),
    loadSave: () => call('loadSave'),
    writeSave: (save) => call('writeSave', save),
    track: (event) => call('track', event),
    showInterstitial: (placement) => call('showInterstitial', placement),
    showRewarded: (placement) => call('showRewarded', placement),
    getWalletBalance: () => call('getWalletBalance'),
    consumeCurrency: (amount, transactionId) => call('consumeCurrency', amount, transactionId),
    submitLeaderboard: (entry) => call('submitLeaderboard', entry),
    async destroy() {
      destroyed = true;
      if (!platformPromise) return;
      let target;
      try {
        target = await platformPromise;
      } catch {
        return;
      }
      await target.destroy();
    },
  });
}

function publishRuntimeEvidence(runtimeManifest) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.runtimeMode = runtimeManifest.mode;
  document.documentElement.dataset.runtimeBuildSha = runtimeManifest.buildSha;
}

/**
 * Keeps the normal static release standalone while allowing the exact Vite
 * candidate to inject one validated publisher manifest at build time.
 */
export function createCanyonIntegration(options = {}) {
  const runtimeManifest = globalThis.__CANYON_RUNTIME_MANIFEST__ ?? null;
  if (!runtimeManifest || options.platform) return createCoreIntegration(options);

  publishRuntimeEvidence(runtimeManifest);
  return createCoreIntegration({
    ...options,
    platform: createDeferredRuntimePlatform(runtimeManifest),
    platformMode: runtimeManifest.mode,
    publisherMode: true,
  });
}
