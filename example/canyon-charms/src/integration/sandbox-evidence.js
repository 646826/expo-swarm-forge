const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILD_SHA = /^[0-9a-f]{40}$/;
const SDK_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const LEVEL_ID = /^[1-9]\d{0,8}$/;

function enabled(runtimeManifest, search) {
  if (runtimeManifest?.mode !== 'arkadium-sandbox' || typeof search !== 'string') return false;
  try {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      .get('sandboxEvidence') === '1';
  } catch {
    return false;
  }
}

function structuralCalls(diagnostics) {
  const calls = [];
  const events = Array.isArray(diagnostics?.events) ? diagnostics.events : [];
  for (const event of events.slice(-128)) {
    const properties = event?.properties && typeof event.properties === 'object'
      ? event.properties
      : {};
    if (event?.name === 'sdk_ready') calls.push('ready');
    else if (event?.name === 'game_start') calls.push('gameStart');
    else if (event?.name === 'level_start'
      && typeof properties.levelId === 'string'
      && LEVEL_ID.test(properties.levelId)) {
      calls.push(`levelStart:${properties.levelId}`);
    } else if (event?.name === 'score_changed'
      && Number.isSafeInteger(properties.score)
      && properties.score >= 0
      && properties.score <= 1_000_000_000) {
      calls.push(`score:${properties.score}`);
    } else if (event?.name === 'level_end'
      && typeof properties.levelId === 'string'
      && LEVEL_ID.test(properties.levelId)) {
      calls.push(`levelEnd:${properties.levelId}`);
    } else if (event?.name === 'game_end') calls.push('gameEnd');
  }
  return Object.freeze(calls);
}

function hostLifecycle(diagnostics, name) {
  const events = Array.isArray(diagnostics?.events) ? diagnostics.events : [];
  return events.some((event) => event?.name === name && event?.properties?.source === 'host');
}

function bootErrorVisible(documentImpl) {
  const node = documentImpl?.querySelector?.('[data-role="boot-error"]');
  return Boolean(node && node.hidden !== true);
}

export function createSandboxEvidenceSnapshot({
  runtimeManifest,
  sdkVersion,
  sessionId,
  diagnostics,
  documentImpl = globalThis.document,
} = {}) {
  if (runtimeManifest?.mode !== 'arkadium-sandbox'
    || typeof runtimeManifest.buildSha !== 'string'
    || !BUILD_SHA.test(runtimeManifest.buildSha)
    || typeof sdkVersion !== 'string'
    || !SDK_VERSION.test(sdkVersion)
    || typeof sessionId !== 'string'
    || !UUID_V4.test(sessionId)) {
    throw new Error('Sandbox evidence context is invalid.');
  }
  return Object.freeze({
    schemaVersion: 1,
    source: 'official-arkadium-sandbox',
    sessionId,
    buildSha: runtimeManifest.buildSha,
    sdkVersion,
    observedCalls: structuralCalls(diagnostics),
    hostPauseObserved: hostLifecycle(diagnostics, 'pause'),
    hostResumeObserved: hostLifecycle(diagnostics, 'resume'),
    bootErrorVisible: bootErrorVisible(documentImpl),
  });
}

export function installSandboxEvidenceApi({
  runtimeManifest,
  sdkVersion,
  sessionId,
  getDiagnostics,
  globalImpl = globalThis,
  documentImpl = globalThis.document,
  search = globalThis.location?.search ?? '',
} = {}) {
  if (!enabled(runtimeManifest, search)) return null;
  if (typeof getDiagnostics !== 'function'
    || !globalImpl
    || Object.prototype.hasOwnProperty.call(globalImpl, '__CANYON_SANDBOX_EVIDENCE__')) {
    throw new Error('Sandbox evidence API cannot be installed.');
  }

  const read = () => createSandboxEvidenceSnapshot({
    runtimeManifest,
    sdkVersion,
    sessionId,
    diagnostics: getDiagnostics(),
    documentImpl,
  });
  Object.defineProperty(globalImpl, '__CANYON_SANDBOX_EVIDENCE__', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: read,
  });

  let active = true;
  return Object.freeze({
    read,
    destroy() {
      if (!active) return;
      active = false;
      delete globalImpl.__CANYON_SANDBOX_EVIDENCE__;
    },
  });
}
