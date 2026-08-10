import { createGameEyeSink } from '../../../../packages/game-events/src/index.js';
import { NO_CAPABILITIES } from '../../../../packages/publisher-platform/src/index.js';
import { createIntegrationDebugPanel } from './debug-panel.js';
import { createCanyonIntegration as createCoreIntegration } from './runtime-core.js';

const EXPECTED_OFFICIAL_SDK_VERSION = '2.66.2';

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

function createCandidateGameEyeSink(runtimeManifest) {
  if (!runtimeManifest.gameEyeEndpoint) return null;
  return createGameEyeSink({
    endpoint: runtimeManifest.gameEyeEndpoint,
    context: {
      project: runtimeManifest.gameEyeProject,
      gameVersion: runtimeManifest.gameVersion,
      buildSha: runtimeManifest.buildSha,
      platformMode: runtimeManifest.mode,
      sdkVersion: EXPECTED_OFFICIAL_SDK_VERSION,
      locale: 'en-US',
      userState: 'anonymous',
    },
  });
}

function instrumentCandidateIntegration({
  integration,
  platform,
  gameEyeSink,
  runtimeManifest,
}) {
  const debugPanel = gameEyeSink
    ? createIntegrationDebugPanel({
      runtimeManifest,
      sdkVersion: EXPECTED_OFFICIAL_SDK_VERSION,
    })
    : null;
  let destroyed = false;
  let unsubscribeDiagnostics = null;

  function updateDebugPanel() {
    if (!debugPanel || destroyed) return;
    try {
      debugPanel.update({
        sessionId: gameEyeSink.sessionId,
        capabilities: platform.capabilities,
        integrationDiagnostics: integration.diagnostics(),
        deliveryDiagnostics: gameEyeSink.diagnostics(),
      });
    } catch {
      // A diagnostics surface is an observer and cannot alter game behavior.
    }
  }

  if (debugPanel) unsubscribeDiagnostics = gameEyeSink.subscribe(updateDebugPanel);
  updateDebugPanel();

  const pageTarget = globalThis;
  const onPageHide = () => {
    gameEyeSink?.flushOnUnload();
    updateDebugPanel();
  };
  if (gameEyeSink && typeof pageTarget.addEventListener === 'function') {
    pageTarget.addEventListener('pagehide', onPageHide);
  }

  function tracked(method) {
    return (...args) => Promise.resolve(integration[method](...args)).finally(updateDebugPanel);
  }

  async function destroy() {
    if (destroyed) return;
    try {
      await integration.destroy();
    } finally {
      gameEyeSink?.flushOnUnload();
      gameEyeSink?.destroy({ useBeacon: false });
      unsubscribeDiagnostics?.();
      if (gameEyeSink && typeof pageTarget.removeEventListener === 'function') {
        pageTarget.removeEventListener('pagehide', onPageHide);
      }
      debugPanel?.destroy();
      destroyed = true;
    }
  }

  return Object.freeze({
    get phase() {
      return integration.phase;
    },
    boot: tracked('boot'),
    startLevel: tracked('startLevel'),
    moveRejected: tracked('moveRejected'),
    moveAccepted: tracked('moveAccepted'),
    pause: tracked('pause'),
    resume: tracked('resume'),
    complete: tracked('complete'),
    destroy,
    settled: tracked('settled'),
    diagnostics: () => integration.diagnostics(),
  });
}

/**
 * Keeps the normal static release standalone while allowing the exact Vite
 * candidate to inject one validated publisher manifest at build time.
 */
export function createCanyonIntegration(options = {}) {
  const runtimeManifest = globalThis.__CANYON_RUNTIME_MANIFEST__ ?? null;
  if (!runtimeManifest || options.platform) return createCoreIntegration(options);

  publishRuntimeEvidence(runtimeManifest);
  const platform = createDeferredRuntimePlatform(runtimeManifest);
  const gameEyeSink = createCandidateGameEyeSink(runtimeManifest);
  const configuredSinks = options.sinks ?? [];
  if (!Array.isArray(configuredSinks)) {
    throw new TypeError('Integration sinks must be an array.');
  }
  const integration = createCoreIntegration({
    ...options,
    platform,
    platformMode: runtimeManifest.mode,
    publisherMode: true,
    sinks: gameEyeSink ? [...configuredSinks, gameEyeSink] : configuredSinks,
  });

  return instrumentCandidateIntegration({
    integration,
    platform,
    gameEyeSink,
    runtimeManifest,
  });
}
