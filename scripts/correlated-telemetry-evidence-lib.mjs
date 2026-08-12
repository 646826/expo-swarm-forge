import { createHash } from 'node:crypto';

const BUILD_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEVEL_ID = /^[1-9]\d{0,8}$/;
const SCORE_CALL = /^score:(0|[1-9]\d{0,15})$/;
const MAX_STRUCTURE_DEPTH = 12;
const MAX_STRUCTURE_FIELDS = 1_024;
const MAX_LIFECYCLE_CALLS = 128;
const MAX_TELEMETRY_EVENTS = 256;
const EXPECTED_SDK_VERSION = '2.66.2';

const OPTION_KEYS = Object.freeze([
  'expectedBuildSha',
  'expectedSdkVersion',
  'nowMs',
  'maxAgeMs',
]);
const INPUT_KEYS = Object.freeze(['sandbox', 'arkEye']);
const SANDBOX_KEYS = Object.freeze(['verification', 'status', 'events']);
const VERIFICATION_KEYS = Object.freeze(['ok', 'releaseState', 'errors', 'summary']);
const VERIFICATION_SUMMARY_KEYS = Object.freeze([
  'lifecycleCalls',
  'scoreCalls',
  'finalScore',
  'levelId',
  'rpcRequests',
  'hostPauseObserved',
  'hostResumeObserved',
]);
const STATUS_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'sessionId',
  'buildSha',
  'sdkVersion',
  'startedAtMs',
  'generatedAtMs',
  'hostPauseObserved',
  'hostResumeObserved',
  'bootErrorVisible',
  'consoleErrorCount',
]);
const EVENTS_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'sessionId',
  'buildSha',
  'sdkVersion',
  'generatedAtMs',
  'observedCalls',
]);
const ARK_EYE_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'buildSha',
  'sessionId',
  'sdkVersion',
  'platformMode',
  'generatedAtMs',
  'consumerReadyAtMs',
  'browserCapturedAtMs',
  'eventCount',
  'firstEventName',
  'lastEventName',
  'firstSequence',
  'lastSequence',
  'clickHouseRowCount',
  'sessionFirstStreamSequence',
  'sessionLastStreamSequence',
  'ackFloorStreamSequence',
  'pending',
  'ackPending',
  'redelivered',
  'browserEvidenceSha256',
  'rowsSha256',
]);

const UNSAFE_INPUT_REPORT = Object.freeze({
  ok: false,
  releaseState: 'sandbox-verified',
  errors: Object.freeze([
    'Correlated telemetry evidence contains unsafe object structure.',
  ]),
  summary: Object.freeze({}),
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnsafeStructure(value, seen = new Set(), depth = 0) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return false;
  }
  if (typeof value !== 'object' || depth > MAX_STRUCTURE_DEPTH || seen.has(value)) {
    return true;
  }

  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    if (Object.getOwnPropertySymbols(value).length > 0) return true;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return true;
  }

  const array = Array.isArray(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    return true;
  }

  const entries = Object.entries(descriptors)
    .filter(([key]) => !array || key !== 'length');
  if (entries.length > MAX_STRUCTURE_FIELDS) return true;

  seen.add(value);
  for (const [, descriptor] of entries) {
    if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return true;
    }
    if (hasUnsafeStructure(descriptor.value, seen, depth + 1)) return true;
  }
  seen.delete(value);
  return false;
}

function exactDescriptors(value, expectedKeys) {
  if (!isPlainObject(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    return null;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return null;
    }
  }
  return descriptors;
}

function descriptorValue(descriptors, key) {
  const descriptor = descriptors?.[key];
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function exactArrayValues(value, maximum = MAX_STRUCTURE_FIELDS) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== length) return null;

  const values = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      return null;
    }
    values.push(descriptor.value);
  }
  return values;
}

function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function createReport(ok, errors, summary = {}) {
  return Object.freeze({
    ok,
    releaseState: ok ? 'sandbox-telemetry-verified' : 'sandbox-verified',
    errors: Object.freeze([...new Set(errors)].slice(0, 32)),
    summary: Object.freeze(ok ? { ...summary } : {}),
  });
}

function normalizeOptions(value) {
  if (hasUnsafeStructure(value)) {
    throw new TypeError('Correlated telemetry evidence verification options are invalid.');
  }
  const options = exactDescriptors(value, OPTION_KEYS);
  const expectedBuildSha = descriptorValue(options, 'expectedBuildSha');
  const expectedSdkVersion = descriptorValue(options, 'expectedSdkVersion');
  const nowMs = descriptorValue(options, 'nowMs');
  const maxAgeMs = descriptorValue(options, 'maxAgeMs');
  if (!options
    || typeof expectedBuildSha !== 'string'
    || !BUILD_SHA.test(expectedBuildSha)
    || expectedSdkVersion !== EXPECTED_SDK_VERSION
    || !safeInteger(nowMs)
    || !safeInteger(maxAgeMs, 1, 24 * 60 * 60_000)) {
    throw new TypeError('Correlated telemetry evidence verification options are invalid.');
  }
  return Object.freeze({
    expectedBuildSha,
    expectedSdkVersion,
    nowMs,
    maxAgeMs,
  });
}

function validFreshTimestamp(value, options) {
  return safeInteger(value)
    && value <= options.nowMs
    && options.nowMs - value <= options.maxAgeMs;
}

function validateLifecycle(callsValue, summary, errors) {
  const calls = exactArrayValues(callsValue, MAX_LIFECYCLE_CALLS);
  if (!calls || calls.length < 6) {
    errors.push('Official Sandbox lifecycle evidence is invalid.');
    return null;
  }
  if (calls.some((call) => typeof call !== 'string' || call.length === 0 || call.length > 96)) {
    errors.push('Official Sandbox lifecycle evidence is invalid.');
    return null;
  }

  const levelStart = /^levelStart:([1-9]\d{0,8})$/.exec(calls[2] ?? '');
  const levelEnd = /^levelEnd:([1-9]\d{0,8})$/.exec(calls.at(-2) ?? '');
  if (calls[0] !== 'ready'
    || calls[1] !== 'gameStart'
    || calls.at(-1) !== 'gameEnd'
    || !levelStart
    || !levelEnd
    || levelStart[1] !== levelEnd[1]) {
    errors.push('Official Sandbox lifecycle ordering is invalid.');
  }

  const scoreCalls = calls.slice(3, -2);
  const scores = [];
  for (const call of scoreCalls) {
    const match = SCORE_CALL.exec(call);
    if (!match) {
      errors.push('Official Sandbox lifecycle ordering is invalid.');
      continue;
    }
    const score = Number(match[1]);
    if (!safeInteger(score, 0, 1_000_000_000)) {
      errors.push('Official Sandbox lifecycle ordering is invalid.');
      continue;
    }
    scores.push(score);
  }
  if (scores.length === 0) errors.push('Official Sandbox lifecycle ordering is invalid.');
  for (let index = 1; index < scores.length; index += 1) {
    if (scores[index] < scores[index - 1]) {
      errors.push('Official Sandbox lifecycle ordering is invalid.');
      break;
    }
  }

  const lifecycleNames = calls.filter((call) => !call.startsWith('score:'));
  if (new Set(lifecycleNames).size !== lifecycleNames.length) {
    errors.push('Official Sandbox lifecycle ordering is invalid.');
  }

  const lifecycleCalls = descriptorValue(summary, 'lifecycleCalls');
  const expectedScoreCalls = descriptorValue(summary, 'scoreCalls');
  const finalScore = descriptorValue(summary, 'finalScore');
  const levelId = descriptorValue(summary, 'levelId');
  if (lifecycleCalls !== calls.length
    || expectedScoreCalls !== scores.length
    || finalScore !== scores.at(-1)
    || levelId !== levelStart?.[1]) {
    errors.push('Official Sandbox verification summary does not match lifecycle evidence.');
  }

  return Object.freeze({
    lifecycleCalls: calls.length,
    generatedCalls: calls,
  });
}

function validateSandbox(value, options, errors) {
  const sandbox = exactDescriptors(value, SANDBOX_KEYS);
  if (!sandbox) {
    errors.push('Official Sandbox evidence has an unexpected shape.');
    return null;
  }

  const verification = exactDescriptors(
    descriptorValue(sandbox, 'verification'),
    VERIFICATION_KEYS,
  );
  const status = exactDescriptors(descriptorValue(sandbox, 'status'), STATUS_KEYS);
  const events = exactDescriptors(descriptorValue(sandbox, 'events'), EVENTS_KEYS);
  if (!verification || !status || !events) {
    errors.push('Official Sandbox evidence has an unexpected shape.');
    return null;
  }

  const verificationErrors = exactArrayValues(descriptorValue(verification, 'errors'), 32);
  const summary = exactDescriptors(
    descriptorValue(verification, 'summary'),
    VERIFICATION_SUMMARY_KEYS,
  );
  if (!verificationErrors || !summary) {
    errors.push('Official Sandbox verification has an unexpected shape.');
    return null;
  }
  if (descriptorValue(verification, 'ok') !== true
    || descriptorValue(verification, 'releaseState') !== 'sandbox-verified'
    || verificationErrors.length !== 0) {
    errors.push('Official Sandbox evidence is not verified.');
  }
  if (!safeInteger(descriptorValue(summary, 'lifecycleCalls'), 1, MAX_LIFECYCLE_CALLS)
    || !safeInteger(descriptorValue(summary, 'scoreCalls'), 1, MAX_LIFECYCLE_CALLS)
    || !safeInteger(descriptorValue(summary, 'finalScore'), 0, 1_000_000_000)
    || typeof descriptorValue(summary, 'levelId') !== 'string'
    || !LEVEL_ID.test(descriptorValue(summary, 'levelId'))
    || !safeInteger(descriptorValue(summary, 'rpcRequests'), 1, 256)
    || descriptorValue(summary, 'hostPauseObserved') !== true
    || descriptorValue(summary, 'hostResumeObserved') !== true) {
    errors.push('Official Sandbox verification summary is invalid.');
  }

  const statusSessionId = descriptorValue(status, 'sessionId');
  const statusBuildSha = descriptorValue(status, 'buildSha');
  const statusSdkVersion = descriptorValue(status, 'sdkVersion');
  const startedAtMs = descriptorValue(status, 'startedAtMs');
  const generatedAtMs = descriptorValue(status, 'generatedAtMs');
  if (descriptorValue(status, 'schemaVersion') !== 1
    || descriptorValue(status, 'source') !== 'official-arkadium-sandbox'
    || typeof statusSessionId !== 'string'
    || !UUID_V4.test(statusSessionId)
    || statusBuildSha !== options.expectedBuildSha
    || statusSdkVersion !== options.expectedSdkVersion
    || !validFreshTimestamp(generatedAtMs, options)
    || !safeInteger(startedAtMs)
    || startedAtMs > generatedAtMs
    || generatedAtMs - startedAtMs > 4 * 60 * 60_000
    || descriptorValue(status, 'hostPauseObserved') !== true
    || descriptorValue(status, 'hostResumeObserved') !== true
    || descriptorValue(status, 'bootErrorVisible') !== false
    || descriptorValue(status, 'consoleErrorCount') !== 0) {
    errors.push('Official Sandbox status evidence is invalid.');
  }

  if (descriptorValue(events, 'schemaVersion') !== 1
    || descriptorValue(events, 'source') !== 'official-arkadium-sandbox'
    || descriptorValue(events, 'sessionId') !== statusSessionId
    || descriptorValue(events, 'buildSha') !== statusBuildSha
    || descriptorValue(events, 'sdkVersion') !== statusSdkVersion
    || descriptorValue(events, 'generatedAtMs') !== generatedAtMs) {
    errors.push('Official Sandbox status and lifecycle evidence do not describe the same run.');
  }

  const lifecycle = validateLifecycle(
    descriptorValue(events, 'observedCalls'),
    summary,
    errors,
  );
  if (!lifecycle) return null;

  const normalized = Object.freeze({
    verification: Object.freeze({
      ok: true,
      releaseState: 'sandbox-verified',
      errors: Object.freeze([]),
      summary: Object.freeze({
        lifecycleCalls: descriptorValue(summary, 'lifecycleCalls'),
        scoreCalls: descriptorValue(summary, 'scoreCalls'),
        finalScore: descriptorValue(summary, 'finalScore'),
        levelId: descriptorValue(summary, 'levelId'),
        rpcRequests: descriptorValue(summary, 'rpcRequests'),
        hostPauseObserved: descriptorValue(summary, 'hostPauseObserved'),
        hostResumeObserved: descriptorValue(summary, 'hostResumeObserved'),
      }),
    }),
    status: Object.freeze({
      schemaVersion: 1,
      source: 'official-arkadium-sandbox',
      sessionId: statusSessionId,
      buildSha: statusBuildSha,
      sdkVersion: statusSdkVersion,
      startedAtMs,
      generatedAtMs,
      hostPauseObserved: true,
      hostResumeObserved: true,
      bootErrorVisible: false,
      consoleErrorCount: 0,
    }),
    events: Object.freeze({
      schemaVersion: 1,
      source: 'official-arkadium-sandbox',
      sessionId: statusSessionId,
      buildSha: statusBuildSha,
      sdkVersion: statusSdkVersion,
      generatedAtMs,
      observedCalls: Object.freeze([...lifecycle.generatedCalls]),
    }),
  });

  return Object.freeze({
    buildSha: statusBuildSha,
    sessionId: statusSessionId,
    sdkVersion: statusSdkVersion,
    startedAtMs,
    generatedAtMs,
    lifecycleCalls: lifecycle.lifecycleCalls,
    normalized,
  });
}

function validateArkEye(value, sandbox, options, errors) {
  const evidence = exactDescriptors(value, ARK_EYE_KEYS);
  if (!evidence) {
    errors.push('Ark Eye correlation evidence has an unexpected shape.');
    return null;
  }

  const buildSha = descriptorValue(evidence, 'buildSha');
  const sessionId = descriptorValue(evidence, 'sessionId');
  const sdkVersion = descriptorValue(evidence, 'sdkVersion');
  const generatedAtMs = descriptorValue(evidence, 'generatedAtMs');
  const consumerReadyAtMs = descriptorValue(evidence, 'consumerReadyAtMs');
  const browserCapturedAtMs = descriptorValue(evidence, 'browserCapturedAtMs');
  const eventCount = descriptorValue(evidence, 'eventCount');
  const firstSequence = descriptorValue(evidence, 'firstSequence');
  const lastSequence = descriptorValue(evidence, 'lastSequence');
  const clickHouseRowCount = descriptorValue(evidence, 'clickHouseRowCount');
  const sessionFirstStreamSequence = descriptorValue(
    evidence,
    'sessionFirstStreamSequence',
  );
  const sessionLastStreamSequence = descriptorValue(
    evidence,
    'sessionLastStreamSequence',
  );
  const ackFloorStreamSequence = descriptorValue(evidence, 'ackFloorStreamSequence');
  const browserEvidenceSha256 = descriptorValue(evidence, 'browserEvidenceSha256');
  const rowsSha256 = descriptorValue(evidence, 'rowsSha256');

  if (descriptorValue(evidence, 'schemaVersion') !== 1
    || descriptorValue(evidence, 'source') !== 'ark-eye-sandbox-telemetry-correlation'
    || buildSha !== options.expectedBuildSha
    || buildSha !== sandbox.buildSha
    || sessionId !== sandbox.sessionId
    || sdkVersion !== options.expectedSdkVersion
    || sdkVersion !== sandbox.sdkVersion
    || descriptorValue(evidence, 'platformMode') !== 'arkadium-sandbox') {
    errors.push('Ark Eye correlation identity does not match the official Sandbox run.');
  }

  if (!validFreshTimestamp(generatedAtMs, options)
    || !safeInteger(consumerReadyAtMs)
    || consumerReadyAtMs > sandbox.startedAtMs
    || !safeInteger(browserCapturedAtMs)
    || browserCapturedAtMs < sandbox.startedAtMs
    || browserCapturedAtMs > sandbox.generatedAtMs
    || generatedAtMs < browserCapturedAtMs) {
    errors.push('Ark Eye correlation timing is invalid.');
  }

  if (!safeInteger(eventCount, 1, MAX_TELEMETRY_EVENTS)
    || descriptorValue(evidence, 'firstEventName') !== 'sdk_initialize_started'
    || descriptorValue(evidence, 'lastEventName') !== 'game_end'
    || firstSequence !== 1
    || lastSequence !== eventCount
    || clickHouseRowCount !== eventCount) {
    errors.push('Ark Eye correlated event evidence is invalid.');
  }

  if (!safeInteger(sessionFirstStreamSequence, 1)
    || !safeInteger(sessionLastStreamSequence, 1)
    || sessionLastStreamSequence < sessionFirstStreamSequence
    || sessionLastStreamSequence - sessionFirstStreamSequence + 1 !== eventCount
    || ackFloorStreamSequence !== sessionLastStreamSequence
    || descriptorValue(evidence, 'pending') !== 0
    || descriptorValue(evidence, 'ackPending') !== 0
    || descriptorValue(evidence, 'redelivered') !== 0) {
    errors.push('Ark Eye durable acknowledgement evidence is invalid.');
  }

  if (typeof browserEvidenceSha256 !== 'string'
    || !SHA256.test(browserEvidenceSha256)
    || typeof rowsSha256 !== 'string'
    || !SHA256.test(rowsSha256)) {
    errors.push('Ark Eye correlation hashes are invalid.');
  }

  return Object.freeze({
    eventCount,
    clickHouseRowCount,
    ackFloorStreamSequence,
    browserEvidenceSha256,
    rowsSha256,
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sandboxEvidenceSha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function verifyCorrelatedTelemetryEvidence(input, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  if (hasUnsafeStructure(input)) return UNSAFE_INPUT_REPORT;

  const errors = [];
  const root = exactDescriptors(input, INPUT_KEYS);
  if (!root) {
    errors.push('Correlated telemetry evidence has an unexpected shape.');
    return createReport(false, errors);
  }

  const sandbox = validateSandbox(descriptorValue(root, 'sandbox'), options, errors);
  if (!sandbox) return createReport(false, errors);
  const arkEye = validateArkEye(
    descriptorValue(root, 'arkEye'),
    sandbox,
    options,
    errors,
  );
  if (!arkEye || errors.length > 0) return createReport(false, errors);

  return createReport(true, [], {
    buildSha: sandbox.buildSha,
    sessionId: sandbox.sessionId,
    sdkVersion: sandbox.sdkVersion,
    lifecycleCalls: sandbox.lifecycleCalls,
    telemetryEventCount: arkEye.eventCount,
    clickHouseRowCount: arkEye.clickHouseRowCount,
    ackFloorStreamSequence: arkEye.ackFloorStreamSequence,
    sandboxEvidenceSha256: sandboxEvidenceSha256(sandbox.normalized),
    browserEvidenceSha256: arkEye.browserEvidenceSha256,
    rowsSha256: arkEye.rowsSha256,
  });
}
