import { GAME_EVENT_NAMES } from '../../../../packages/game-events/src/index.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILD_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PLATFORM_MODES = Object.freeze([
  'standalone',
  'arkadium-sandbox',
  'arkadium-dev',
  'arkadium-prod',
]);
const CAPABILITIES = Object.freeze([
  'persistence',
  'analytics',
  'interstitialAds',
  'rewardedAds',
  'wallet',
  'leaderboards',
]);
const EVENT_NAMES = new Set(GAME_EVENT_NAMES);
const DELIVERY_OUTCOMES = new Set(['delivered', 'failed', 'beaconed', 'dropped']);

function boundedString(value, pattern, label, max = 128) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > max
    || (pattern && !pattern.test(value))) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function boundedCount(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function normalizedCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    CAPABILITIES.filter((name) => value[name] === true).sort((left, right) => left.localeCompare(right, 'en')),
  );
}

function lifecycleCalls(value) {
  const events = Array.isArray(value?.events) ? value.events : [];
  const names = [];
  for (const event of events.slice(-64)) {
    if (typeof event?.name === 'string' && EVENT_NAMES.has(event.name)) names.push(event.name);
  }
  return Object.freeze(names);
}

function lifecyclePhase(value) {
  if (typeof value?.phase !== 'string' || !/^[a-z][a-z-]{0,31}$/.test(value.phase)) {
    return 'unknown';
  }
  return value.phase;
}

function deliveryLabel(value) {
  if (!value || typeof value !== 'object' || !DELIVERY_OUTCOMES.has(value.outcome)) return 'none';
  const parts = [value.outcome];
  if (Number.isSafeInteger(value.attempts) && value.attempts > 0 && value.attempts <= 5) {
    parts.push(`attempts ${value.attempts}`);
  }
  if (Number.isSafeInteger(value.batchSize) && value.batchSize > 0 && value.batchSize <= 32) {
    parts.push(`batch ${value.batchSize}`);
  }
  if (Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) {
    parts.push(`HTTP ${value.httpStatus}`);
  }
  return parts.join(' · ');
}

export function shouldEnableIntegrationDebug({ search = '', platformMode } = {}) {
  if (platformMode === 'arkadium-prod') return false;
  if (!PLATFORM_MODES.includes(platformMode) || typeof search !== 'string' || search.length > 2_048) {
    return false;
  }
  try {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      .get('integrationDebug') === '1';
  } catch {
    return false;
  }
}

export function createIntegrationDebugModel({
  runtimeManifest,
  sdkVersion,
  sessionId,
  capabilities,
  integrationDiagnostics,
  deliveryDiagnostics,
} = {}) {
  const buildSha = boundedString(runtimeManifest?.buildSha, BUILD_SHA, 'Debug build SHA', 40);
  const gameVersion = boundedString(runtimeManifest?.gameVersion, VERSION, 'Debug game version', 64);
  const platformMode = boundedString(runtimeManifest?.mode, null, 'Debug platform mode', 32);
  if (!PLATFORM_MODES.includes(platformMode) || platformMode === 'arkadium-prod') {
    throw new TypeError('Debug platform mode is unavailable.');
  }
  const reviewedSdkVersion = boundedString(sdkVersion, VERSION, 'Debug SDK version', 64);
  const evidenceSessionId = boundedString(sessionId, UUID_V4, 'Debug session ID', 36);
  const queueCount = boundedCount(deliveryDiagnostics?.queueCount ?? 0, 256, 'Debug queue count');

  return Object.freeze({
    buildSha,
    gameVersion,
    platformMode,
    sdkVersion: reviewedSdkVersion,
    sessionId: evidenceSessionId,
    capabilities: normalizedCapabilities(capabilities),
    lifecyclePhase: lifecyclePhase(integrationDiagnostics),
    lifecycleCalls: lifecycleCalls(integrationDiagnostics),
    queueCount,
    lastDelivery: deliveryLabel(deliveryDiagnostics?.lastResult),
  });
}

function modelText(model) {
  return [
    `Build: ${model.buildSha}`,
    `Game: ${model.gameVersion}`,
    `Mode: ${model.platformMode}`,
    `SDK: ${model.sdkVersion}`,
    `Session: ${model.sessionId}`,
    `Capabilities: ${model.capabilities.join(', ') || 'none'}`,
    `Lifecycle: ${model.lifecyclePhase}`,
    `Calls: ${model.lifecycleCalls.join(' → ') || 'none'}`,
    `Game Eye queue: ${model.queueCount}`,
    `Last delivery: ${model.lastDelivery}`,
  ].join('\n');
}

export function createIntegrationDebugPanel({
  documentImpl = globalThis.document,
  mount = documentImpl?.body,
  search = globalThis.location?.search ?? '',
  runtimeManifest,
  sdkVersion,
} = {}) {
  if (!shouldEnableIntegrationDebug({
    search,
    platformMode: runtimeManifest?.mode,
  })) return null;
  if (!documentImpl || typeof documentImpl.createElement !== 'function' || !mount) {
    return null;
  }

  const root = documentImpl.createElement('aside');
  root.className = 'integration-debug-panel';
  root.dataset.role = 'integration-debug';
  root.setAttribute('aria-label', 'Arkadium integration diagnostics');

  const heading = documentImpl.createElement('h2');
  heading.textContent = 'Arkadium integration';
  const output = documentImpl.createElement('pre');
  output.textContent = 'Waiting for structural integration diagnostics.';
  root.append(heading, output);
  mount.appendChild(root);

  let destroyed = false;
  return Object.freeze({
    update(snapshot = {}) {
      if (destroyed) return;
      const model = createIntegrationDebugModel({
        runtimeManifest,
        sdkVersion,
        ...snapshot,
      });
      output.textContent = modelText(model);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.remove();
    },
  });
}
