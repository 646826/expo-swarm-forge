import { relative, resolve, sep } from 'node:path';

const BUILD_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;
const EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const CAPTURE_OPTION_KEYS = Object.freeze([
  'capturedAt',
  'expectedBuildSha',
  'title',
  'telemetry',
  'beforeMove',
  'afterMove',
  'paused',
  'resumed',
  'officialRuntimeRequests',
  'gameEventPostCount',
  'consoleErrorCount',
]);
const TELEMETRY_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'sessionId',
  'buildSha',
  'gameVersion',
  'platformMode',
  'sdkVersion',
  'phase',
  'eventCount',
  'lastEventName',
  'queueCount',
  'droppedCount',
  'inFlight',
  'lastDelivery',
]);
const DELIVERY_KEYS = Object.freeze([
  'outcome',
  'attempts',
  'batchSize',
  'httpStatus',
]);
const DRIVER_KEYS = Object.freeze(['mode', 'status', 'score', 'moves']);

function captureError() {
  throw new Error('Local telemetry capture evidence is invalid.');
}

function exactDataDescriptors(value, expectedKeys, fail = captureError) {
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
    if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function read(descriptors, key, fail = captureError) {
  const descriptor = descriptors[key];
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function boundedInteger(value, minimum, maximum, fail = captureError) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function canonicalIso(value) {
  if (typeof value !== 'string' || value.length !== 24) captureError();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) captureError();
  return value;
}

function normalizeDelivery(value) {
  const descriptors = exactDataDescriptors(value, DELIVERY_KEYS);
  const outcome = read(descriptors, 'outcome');
  const attempts = boundedInteger(read(descriptors, 'attempts'), 1, 5);
  const batchSize = boundedInteger(read(descriptors, 'batchSize'), 1, 32);
  const httpStatus = read(descriptors, 'httpStatus');
  if (outcome !== 'delivered' || httpStatus !== 202) captureError();
  return Object.freeze({ outcome, attempts, batchSize, httpStatus });
}

function normalizeTelemetry(value, expectedBuildSha) {
  const descriptors = exactDataDescriptors(value, TELEMETRY_KEYS);
  const schemaVersion = read(descriptors, 'schemaVersion');
  const source = read(descriptors, 'source');
  const sessionId = read(descriptors, 'sessionId');
  const buildSha = read(descriptors, 'buildSha');
  const gameVersion = read(descriptors, 'gameVersion');
  const platformMode = read(descriptors, 'platformMode');
  const sdkVersion = read(descriptors, 'sdkVersion');
  const phase = read(descriptors, 'phase');
  const eventCount = boundedInteger(read(descriptors, 'eventCount'), 1, 256);
  const lastEventName = read(descriptors, 'lastEventName');
  const queueCount = read(descriptors, 'queueCount');
  const droppedCount = read(descriptors, 'droppedCount');
  const inFlight = read(descriptors, 'inFlight');

  if (schemaVersion !== 1
    || source !== 'local-browser-telemetry'
    || typeof sessionId !== 'string'
    || !UUID_V4.test(sessionId)
    || buildSha !== expectedBuildSha
    || typeof gameVersion !== 'string'
    || !SEMVER.test(gameVersion)
    || platformMode !== 'standalone'
    || sdkVersion !== null
    || phase !== 'playing'
    || typeof lastEventName !== 'string'
    || !EVENT_NAME.test(lastEventName)
    || queueCount !== 0
    || droppedCount !== 0
    || inFlight !== false) captureError();

  return Object.freeze({
    schemaVersion,
    source,
    sessionId,
    buildSha,
    gameVersion,
    platformMode,
    sdkVersion,
    phase,
    eventCount,
    lastEventName,
    queueCount,
    droppedCount,
    inFlight,
    lastDelivery: normalizeDelivery(read(descriptors, 'lastDelivery')),
  });
}

function normalizeDriverSnapshot(value) {
  const descriptors = exactDataDescriptors(value, DRIVER_KEYS);
  const mode = read(descriptors, 'mode');
  const status = read(descriptors, 'status');
  const score = boundedInteger(read(descriptors, 'score'), 0, 1_000_000_000);
  const moves = boundedInteger(read(descriptors, 'moves'), 0, 1_000);
  if (mode !== 'playing' || status !== 'playing') captureError();
  return Object.freeze({ mode, status, score, moves });
}

export function validateLocalTelemetryCaptureUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) {
    throw new Error('Local telemetry capture URL is invalid.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Local telemetry capture URL is invalid.');
  }
  const queryKeys = [...url.searchParams.keys()];
  if (url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || !/^\d{1,5}$/.test(url.port)
    || Number(url.port) < 1
    || Number(url.port) > 65_535
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.hash
    || url.search !== '?seed=12345&telemetryEvidence=1'
    || queryKeys.length !== 2
    || url.searchParams.getAll('seed').length !== 1
    || url.searchParams.getAll('telemetryEvidence').length !== 1) {
    throw new Error('Local telemetry capture URL is invalid.');
  }
  return url.href;
}

export function validateLocalTelemetryCaptureOutput(root, value) {
  if (typeof root !== 'string'
    || root.length === 0
    || typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.startsWith('/')
    || value.startsWith('\\')
    || value.includes('\0')
    || value.includes('\\')
    || !value.endsWith('.json')) {
    throw new Error('Local telemetry capture output is invalid.');
  }
  const resolvedRoot = resolve(root);
  const output = resolve(resolvedRoot, value);
  const path = relative(resolvedRoot, output);
  if (!path
    || path.startsWith('..')
    || path.split(sep).includes('..')
    || output === resolvedRoot) {
    throw new Error('Local telemetry capture output is invalid.');
  }
  return output;
}

export function createLocalTelemetryCaptureEvidence(options) {
  const descriptors = exactDataDescriptors(options, CAPTURE_OPTION_KEYS);
  const capturedAt = canonicalIso(read(descriptors, 'capturedAt'));
  const expectedBuildSha = read(descriptors, 'expectedBuildSha');
  const title = read(descriptors, 'title');
  if (typeof expectedBuildSha !== 'string'
    || !BUILD_SHA.test(expectedBuildSha)
    || title !== 'Canyon Charms') captureError();

  const telemetry = normalizeTelemetry(read(descriptors, 'telemetry'), expectedBuildSha);
  const beforeMove = normalizeDriverSnapshot(read(descriptors, 'beforeMove'));
  const afterMove = normalizeDriverSnapshot(read(descriptors, 'afterMove'));
  const paused = read(descriptors, 'paused');
  const resumed = read(descriptors, 'resumed');
  const officialRuntimeRequests = read(descriptors, 'officialRuntimeRequests');
  const gameEventPostCount = read(descriptors, 'gameEventPostCount');
  const consoleErrorCount = read(descriptors, 'consoleErrorCount');

  if (afterMove.moves !== beforeMove.moves - 1
    || afterMove.score < beforeMove.score
    || paused !== true
    || resumed !== true
    || officialRuntimeRequests !== 0
    || !Number.isSafeInteger(gameEventPostCount)
    || gameEventPostCount < 1
    || gameEventPostCount > 32
    || consoleErrorCount !== 0) captureError();

  return Object.freeze({
    schemaVersion: 1,
    source: 'local-browser-telemetry-capture',
    capturedAt,
    expectedBuildSha,
    browser: Object.freeze({
      title,
      runtimeMode: telemetry.platformMode,
      officialRuntimeRequests,
      gameEventPostCount,
      consoleErrorCount,
    }),
    interaction: Object.freeze({
      initialMoves: beforeMove.moves,
      finalMoves: afterMove.moves,
      scoreDelta: afterMove.score - beforeMove.score,
      paused,
      resumed,
    }),
    telemetry,
  });
}
