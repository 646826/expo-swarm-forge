export const PLATFORM_MODES = Object.freeze([
  'standalone',
  'arkadium-sandbox',
  'arkadium-dev',
  'arkadium-prod',
]);

export const ANALYTICS_PROVIDERS = Object.freeze([
  'none',
  'console',
  'app-insights',
]);

const MODE_SET = new Set(PLATFORM_MODES);
const ANALYTICS_SET = new Set(ANALYTICS_PROVIDERS);
const ENVIRONMENT_SET = new Set(['DEV', 'STAGING', 'PROD']);
const ALLOWED_KEYS = new Set([
  'schemaVersion',
  'mode',
  'arkadiumEnvironment',
  'gameId',
  'analyticsProvider',
  'appInsightsId',
  'gameEyeEndpoint',
  'gameEyeProject',
  'gameVersion',
  'buildSha',
]);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const PLACEHOLDER_VALUES = new Set([
  'demo',
  'test',
  'changeme',
  'change-me',
  'none',
  'null',
  'undefined',
]);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function invalid(field, detail = 'configuration is invalid') {
  throw new TypeError(`${field} ${detail}.`);
}

function readPlainData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Runtime manifest must be a plain object.');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Runtime manifest must be a plain object.');
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw new TypeError('Runtime manifest cannot contain symbol keys.');
  }

  const values = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
    if (!ALLOWED_KEYS.has(key)) throw new TypeError(`Unknown runtime field: ${key}`);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Runtime manifest fields must be enumerable plain data properties.');
    }
    values[key] = descriptor.value;
  }
  return values;
}

function nullableString(value, field, maxLength = 256) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') invalid(field);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    invalid(field);
  }
  return normalized;
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  if (PLACEHOLDER_VALUES.has(normalized)) return true;
  const compact = normalized.replace(/[-_.:]/g, '');
  return compact.length > 0 && /^0+$/.test(compact);
}

function identifier(value, field, { required = false, rejectPlaceholder = false } = {}) {
  const normalized = nullableString(value, field, 160);
  if (normalized === null) {
    if (required) invalid(field, 'configuration is required');
    return null;
  }
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) invalid(field);
  if (rejectPlaceholder && isPlaceholder(normalized)) invalid(field);
  return normalized;
}

function environment(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !ENVIRONMENT_SET.has(value)) {
    invalid('arkadiumEnvironment');
  }
  return value;
}

function endpoint(value, { required = false, requireHttps = false } = {}) {
  const normalized = nullableString(value, 'gameEyeEndpoint', 2048);
  if (normalized === null) {
    if (required) invalid('gameEyeEndpoint', 'configuration is required');
    return null;
  }

  let url;
  try {
    url = new URL(normalized);
  } catch {
    invalid('gameEyeEndpoint');
  }
  if (!['http:', 'https:'].includes(url.protocol)) invalid('gameEyeEndpoint');
  if (url.username || url.password || url.search || url.hash) invalid('gameEyeEndpoint');
  if (url.pathname !== '/v1/game-events') invalid('gameEyeEndpoint');
  if (requireHttps && url.protocol !== 'https:') invalid('gameEyeEndpoint');
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) invalid('gameEyeEndpoint');
  return url.toString();
}

function requireNull(value, field) {
  if (value !== null) invalid(field);
}

function requireAnalytics(value) {
  if (typeof value !== 'string' || !ANALYTICS_SET.has(value)) {
    invalid('analyticsProvider');
  }
  return value;
}

export function validateRuntimeManifest(input) {
  const data = readPlainData(input);
  if (data.schemaVersion !== 1) invalid('schemaVersion');
  if (typeof data.mode !== 'string' || !MODE_SET.has(data.mode)) invalid('mode');
  if (data.gameEyeProject !== 'canyon-charms') invalid('gameEyeProject');
  if (typeof data.gameVersion !== 'string' || !SEMVER_PATTERN.test(data.gameVersion)) {
    invalid('gameVersion');
  }
  if (typeof data.buildSha !== 'string' || !SHA_PATTERN.test(data.buildSha)) {
    invalid('buildSha');
  }

  const arkadiumEnvironment = environment(data.arkadiumEnvironment);
  const analyticsProvider = requireAnalytics(data.analyticsProvider);
  let gameId = identifier(data.gameId, 'gameId');
  let appInsightsId = identifier(data.appInsightsId, 'appInsightsId');
  let gameEyeEndpoint = endpoint(data.gameEyeEndpoint);

  if (data.mode === 'standalone') {
    requireNull(arkadiumEnvironment, 'arkadiumEnvironment');
    requireNull(gameId, 'gameId');
    requireNull(appInsightsId, 'appInsightsId');
    if (analyticsProvider !== 'none') invalid('analyticsProvider');
  } else if (data.mode === 'arkadium-sandbox') {
    if (arkadiumEnvironment !== 'DEV') invalid('arkadiumEnvironment');
    if (analyticsProvider !== 'console') invalid('analyticsProvider');
    requireNull(appInsightsId, 'appInsightsId');
  } else if (data.mode === 'arkadium-dev') {
    if (!['DEV', 'STAGING'].includes(arkadiumEnvironment)) invalid('arkadiumEnvironment');
    gameId = identifier(data.gameId, 'gameId', { required: true, rejectPlaceholder: true });
    if (!['console', 'app-insights'].includes(analyticsProvider)) invalid('analyticsProvider');
    if (analyticsProvider === 'console') requireNull(appInsightsId, 'appInsightsId');
    else appInsightsId = identifier(data.appInsightsId, 'appInsightsId', {
      required: true,
      rejectPlaceholder: true,
    });
  } else {
    if (arkadiumEnvironment !== 'PROD') invalid('arkadiumEnvironment');
    gameId = identifier(data.gameId, 'gameId', { required: true, rejectPlaceholder: true });
    if (analyticsProvider !== 'app-insights') invalid('analyticsProvider');
    appInsightsId = identifier(data.appInsightsId, 'appInsightsId', {
      required: true,
      rejectPlaceholder: true,
    });
    gameEyeEndpoint = endpoint(data.gameEyeEndpoint, { required: true, requireHttps: true });
  }

  return Object.freeze({
    schemaVersion: 1,
    mode: data.mode,
    arkadiumEnvironment,
    gameId,
    analyticsProvider,
    appInsightsId,
    gameEyeEndpoint,
    gameEyeProject: 'canyon-charms',
    gameVersion: data.gameVersion,
    buildSha: data.buildSha,
  });
}

function envValue(env, name) {
  const value = env?.[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function runtimeManifestFromEnv(env = {}) {
  const mode = envValue(env, 'GAME_MODE') ?? 'standalone';
  const defaultEnvironment = mode === 'arkadium-prod'
    ? 'PROD'
    : mode === 'standalone'
      ? null
      : 'DEV';
  const defaultAnalytics = mode === 'arkadium-prod'
    ? 'app-insights'
    : mode === 'standalone'
      ? 'none'
      : 'console';

  return validateRuntimeManifest({
    schemaVersion: 1,
    mode,
    arkadiumEnvironment: envValue(env, 'ARKADIUM_ENV') ?? defaultEnvironment,
    gameId: envValue(env, 'ARKADIUM_GAME_ID'),
    analyticsProvider: envValue(env, 'ARKADIUM_ANALYTICS_PROVIDER') ?? defaultAnalytics,
    appInsightsId: envValue(env, 'ARKADIUM_APP_INSIGHTS_ID'),
    gameEyeEndpoint: envValue(env, 'GAME_EYE_ENDPOINT'),
    gameEyeProject: envValue(env, 'GAME_EYE_PROJECT') ?? 'canyon-charms',
    gameVersion: envValue(env, 'GAME_VERSION'),
    buildSha: envValue(env, 'BUILD_SHA'),
  });
}
