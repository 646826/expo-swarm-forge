import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BUILD_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SDK_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEVEL_ID = /^[1-9]\d{0,8}$/;
const TRACE_ID = /^rpc-[1-9]\d{0,5}$/;
const MAX_EVIDENCE_FILE_BYTES = 1_048_576;
const MAX_LIFECYCLE_CALLS = 128;
const MAX_RPC_TRACES = 256;
const DEFAULT_MAX_SESSION_DURATION_MS = 30 * 60_000;

const COMBINED_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'sessionId',
  'buildSha',
  'sdkVersion',
  'startedAtMs',
  'generatedAtMs',
  'observedCalls',
  'hostPauseObserved',
  'hostResumeObserved',
  'bootErrorVisible',
  'consoleErrorCount',
]);
const STATUS_KEYS = Object.freeze(COMBINED_KEYS.filter((key) => key !== 'observedCalls'));
const EVENTS_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'sessionId',
  'buildSha',
  'sdkVersion',
  'generatedAtMs',
  'observedCalls',
]);
const RPC_KEYS = Object.freeze([
  'schemaVersion',
  'buildSha',
  'sdkVersion',
  'environment',
  'generatedAtMs',
  'status',
  'summary',
  'traces',
  'violations',
]);
const RPC_SUMMARY_KEYS = Object.freeze([
  'requests',
  'responses',
  'callbacks',
  'timeouts',
  'violations',
]);
const RPC_TRACE_KEYS = Object.freeze([
  'traceId',
  'operation',
  'targetState',
  'startedAtMs',
  'respondedAtMs',
  'callbackAtMs',
  'durationMs',
  'payloadItemCounts',
]);
const RPC_PAYLOAD_COUNT_KEYS = Object.freeze(['request', 'response', 'callback']);

export const SANDBOX_RELEASE_STATES = Object.freeze([
  'contract-ready',
  'sandbox-verified',
  'arkadium-dev-ready',
  'production-approved',
]);

export const DEFAULT_SANDBOX_RPC_OPERATIONS = Object.freeze([
  'debugMode',
  'host.getDetails',
  'host.isAuthSupported',
  'auth.isUserAuthorized',
  'auth.getUserProfile',
  'lifecycle.registerEventCallback',
  'lifecycle.onTestReady',
  'lifecycle.onGameStart',
  'lifecycle.onChangeScore',
  'lifecycle.onLevelStart',
  'lifecycle.onLevelEnd',
  'lifecycle.onGameEnd',
]);

const REQUIRED_RPC_OPERATIONS = Object.freeze([
  'host.getDetails',
  'host.isAuthSupported',
  'lifecycle.onTestReady',
  'lifecycle.onGameStart',
  'lifecycle.onChangeScore',
  'lifecycle.onLevelStart',
  'lifecycle.onLevelEnd',
  'lifecycle.onGameEnd',
]);

const SENSITIVE_KEY_PARTS = Object.freeze([
  'accesstoken',
  'refreshtoken',
  'token',
  'credential',
  'password',
  'secret',
  'cookie',
  'authorization',
  'profile',
  'savepayload',
  'appinsights',
  'requestid',
  'transactionid',
  'email',
  'rawpayload',
]);
const SENSITIVE_KEY_EXCEPTIONS = new Set(['payloaditemcounts']);

function normalizeKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEY_EXCEPTIONS.has(normalized)) return false;
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeStructure(value, errors, path = 'evidence', seen = new Set(), depth = 0) {
  if (errors.length >= 32) return;
  if (depth > 12) {
    errors.push(`${path} is too deeply nested.`);
    return;
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') {
    errors.push(`${path} contains an unsupported value.`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${path} contains a cycle.`);
    return;
  }
  seen.add(value);

  if (Object.getOwnPropertySymbols(value).length > 0) {
    errors.push(`${path} contains symbol-keyed data.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = Object.entries(descriptors).filter(([key]) => key !== 'length');
  if (entries.length > 1_024) errors.push(`${path} contains too many fields.`);

  if (!Array.isArray(value) && !isPlainObject(value)) {
    errors.push(`${path} must be a plain object or array.`);
  }
  for (const [key, descriptor] of entries.slice(0, 1_024)) {
    if (!('value' in descriptor)) {
      errors.push(`${path} contains an accessor.`);
      continue;
    }
    if (!Array.isArray(value) && isSensitiveKey(key)) {
      errors.push(`${path} contains a forbidden field name.`);
      continue;
    }
    safeStructure(descriptor.value, errors, `${path}.${key}`, seen, depth + 1);
  }
  seen.delete(value);
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function createReport(ok, errors, summary = {}) {
  const uniqueErrors = Object.freeze([...new Set(errors)].slice(0, 32));
  return Object.freeze({
    ok,
    releaseState: ok ? 'sandbox-verified' : 'contract-ready',
    errors: uniqueErrors,
    summary: Object.freeze({ ...summary }),
  });
}

function normalizeOptions(options = {}) {
  if (!isPlainObject(options)
    || typeof options.expectedBuildSha !== 'string'
    || !BUILD_SHA.test(options.expectedBuildSha)
    || typeof options.expectedSdkVersion !== 'string'
    || !SDK_VERSION.test(options.expectedSdkVersion)
    || !safeInteger(options.nowMs)
    || !safeInteger(options.maxAgeMs, 1, 24 * 60 * 60_000)) {
    throw new TypeError('Sandbox evidence verification options are invalid.');
  }
  const maxSessionDurationMs = options.maxSessionDurationMs ?? DEFAULT_MAX_SESSION_DURATION_MS;
  if (!safeInteger(maxSessionDurationMs, 1, 4 * 60 * 60_000)) {
    throw new TypeError('Sandbox evidence verification options are invalid.');
  }
  return Object.freeze({
    expectedBuildSha: options.expectedBuildSha,
    expectedSdkVersion: options.expectedSdkVersion,
    nowMs: options.nowMs,
    maxAgeMs: options.maxAgeMs,
    maxSessionDurationMs,
  });
}

function validateCommonEvidence(value, expectedKeys, options, errors) {
  safeStructure(value, errors);
  if (!exactKeys(value, expectedKeys)) {
    errors.push('Sandbox evidence has an unexpected shape.');
    return false;
  }
  if (value.schemaVersion !== 1) errors.push('Sandbox evidence schema version is invalid.');
  if (value.source !== 'official-arkadium-sandbox') {
    errors.push('Sandbox evidence source is not official.');
  }
  if (typeof value.sessionId !== 'string' || !UUID_V4.test(value.sessionId)) {
    errors.push('Sandbox evidence session ID is invalid.');
  }
  if (value.buildSha !== options.expectedBuildSha) {
    errors.push('Sandbox evidence build SHA does not match the candidate.');
  }
  if (value.sdkVersion !== options.expectedSdkVersion) {
    errors.push('Sandbox evidence SDK version does not match the reviewed SDK.');
  }
  if (!safeInteger(value.generatedAtMs)) {
    errors.push('Sandbox evidence timestamp is invalid.');
  } else {
    if (value.generatedAtMs > options.nowMs) {
      errors.push('Sandbox evidence timestamp is in the future.');
    }
    if (options.nowMs - value.generatedAtMs > options.maxAgeMs) {
      errors.push('Sandbox evidence is stale.');
    }
  }
  return true;
}

function parseLifecycleCalls(calls, errors) {
  if (!Array.isArray(calls)
    || calls.length < 6
    || calls.length > MAX_LIFECYCLE_CALLS) {
    errors.push('Sandbox lifecycle evidence has an invalid call count.');
    return null;
  }
  if (calls.some((call) => typeof call !== 'string' || call.length === 0 || call.length > 96)) {
    errors.push('Sandbox lifecycle evidence contains an invalid call.');
    return null;
  }

  if (calls[0] !== 'ready'
    || calls[1] !== 'gameStart'
    || calls.at(-1) !== 'gameEnd') {
    errors.push('Sandbox lifecycle ordering is invalid.');
  }
  const levelStartMatch = /^levelStart:([1-9]\d{0,8})$/.exec(calls[2] ?? '');
  const levelEndMatch = /^levelEnd:([1-9]\d{0,8})$/.exec(calls.at(-2) ?? '');
  if (!levelStartMatch || !levelEndMatch || levelStartMatch[1] !== levelEndMatch[1]) {
    errors.push('Sandbox level lifecycle evidence is invalid.');
  }

  const scoreCalls = calls.slice(3, -2);
  if (scoreCalls.length === 0) errors.push('Sandbox lifecycle evidence is missing score calls.');
  const scores = [];
  for (const call of scoreCalls) {
    const match = /^score:(0|[1-9]\d{0,15})$/.exec(call);
    if (!match) {
      errors.push('Sandbox lifecycle evidence contains an unknown operation.');
      continue;
    }
    const score = Number(match[1]);
    if (!safeInteger(score, 0, 1_000_000_000)) {
      errors.push('Sandbox score evidence is invalid.');
      continue;
    }
    scores.push(score);
  }
  for (let index = 1; index < scores.length; index += 1) {
    if (scores[index] < scores[index - 1]) {
      errors.push('Sandbox score evidence regressed.');
      break;
    }
  }

  const lifecycleNames = calls.filter((call) => !call.startsWith('score:'));
  if (new Set(lifecycleNames).size !== lifecycleNames.length) {
    errors.push('Sandbox lifecycle evidence contains duplicate lifecycle calls.');
  }

  const knownCall = /^(?:ready|gameStart|gameEnd|levelStart:[1-9]\d{0,8}|levelEnd:[1-9]\d{0,8}|score:(?:0|[1-9]\d{0,15}))$/;
  if (calls.some((call) => !knownCall.test(call))) {
    errors.push('Sandbox lifecycle evidence contains an unknown operation.');
  }

  return Object.freeze({
    lifecycleCalls: calls.length,
    scoreCalls: scores.length,
    finalScore: scores.at(-1) ?? null,
    levelId: levelStartMatch?.[1] ?? null,
  });
}

export function verifySandboxEvidence(input, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const errors = [];
  const shaped = validateCommonEvidence(input, COMBINED_KEYS, options, errors);
  if (!shaped) return createReport(false, errors);

  if (!safeInteger(input.startedAtMs)) {
    errors.push('Sandbox session start timestamp is invalid.');
  } else if (safeInteger(input.generatedAtMs)) {
    if (input.startedAtMs > input.generatedAtMs) {
      errors.push('Sandbox session timing is invalid.');
    }
    if (input.generatedAtMs - input.startedAtMs > options.maxSessionDurationMs) {
      errors.push('Sandbox session duration exceeds the reviewed limit.');
    }
  }
  if (input.hostPauseObserved !== true) errors.push('Sandbox host pause was not observed.');
  if (input.hostResumeObserved !== true) errors.push('Sandbox host resume was not observed.');
  if (input.bootErrorVisible !== false) errors.push('Sandbox boot error was visible.');
  if (input.consoleErrorCount !== 0) errors.push('Sandbox console errors were observed.');

  const lifecycle = parseLifecycleCalls(input.observedCalls, errors);
  return createReport(errors.length === 0, errors, lifecycle ?? {});
}

function validateStatusEvidence(status, options, errors) {
  const shaped = validateCommonEvidence(status, STATUS_KEYS, options, errors);
  if (!shaped) return;
  if (!safeInteger(status.startedAtMs)) {
    errors.push('Sandbox status start timestamp is invalid.');
  } else if (safeInteger(status.generatedAtMs)) {
    if (status.startedAtMs > status.generatedAtMs) {
      errors.push('Sandbox status timing is invalid.');
    }
    if (status.generatedAtMs - status.startedAtMs > options.maxSessionDurationMs) {
      errors.push('Sandbox status duration exceeds the reviewed limit.');
    }
  }
  if (status.hostPauseObserved !== true) errors.push('Sandbox host pause was not observed.');
  if (status.hostResumeObserved !== true) errors.push('Sandbox host resume was not observed.');
  if (status.bootErrorVisible !== false) errors.push('Sandbox boot error was visible.');
  if (status.consoleErrorCount !== 0) errors.push('Sandbox console errors were observed.');
}

function validateEventsEvidence(events, options, errors) {
  const shaped = validateCommonEvidence(events, EVENTS_KEYS, options, errors);
  if (!shaped) return null;
  return parseLifecycleCalls(events.observedCalls, errors);
}

function validateRpcDiagnostics(rpc, status, options, errors) {
  safeStructure(rpc, errors, 'rpcDiagnostics');
  if (!exactKeys(rpc, RPC_KEYS)) {
    errors.push('RPC diagnostics have an unexpected shape.');
    return null;
  }
  if (rpc.schemaVersion !== 1) errors.push('RPC diagnostics schema version is invalid.');
  if (rpc.buildSha !== options.expectedBuildSha) {
    errors.push('RPC diagnostics build SHA does not match the candidate.');
  }
  if (rpc.sdkVersion !== options.expectedSdkVersion) {
    errors.push('RPC diagnostics SDK version does not match the reviewed SDK.');
  }
  if (!['DEV', 'STAGING'].includes(rpc.environment)) {
    errors.push('RPC diagnostics environment is invalid.');
  }
  if (rpc.status !== 'PASS') errors.push('RPC diagnostics did not pass.');
  if (rpc.generatedAtMs !== status.generatedAtMs) {
    errors.push('RPC diagnostics timestamp does not match the Sandbox session.');
  }
  if (!exactKeys(rpc.summary, RPC_SUMMARY_KEYS)) {
    errors.push('RPC diagnostics summary has an unexpected shape.');
    return null;
  }
  for (const key of RPC_SUMMARY_KEYS) {
    if (!safeInteger(rpc.summary[key], 0, MAX_RPC_TRACES)) {
      errors.push('RPC diagnostics summary contains an invalid count.');
      break;
    }
  }
  if (!Array.isArray(rpc.traces)
    || rpc.traces.length === 0
    || rpc.traces.length > MAX_RPC_TRACES) {
    errors.push('RPC diagnostics trace count is invalid.');
    return null;
  }
  if (!Array.isArray(rpc.violations) || rpc.violations.length !== 0) {
    errors.push('RPC diagnostics contain violations.');
  }

  const seenTraceIds = new Set();
  const observedOperations = new Set();
  for (const trace of rpc.traces) {
    if (!exactKeys(trace, RPC_TRACE_KEYS)) {
      errors.push('RPC diagnostics contain an invalid trace shape.');
      continue;
    }
    if (typeof trace.traceId !== 'string'
      || !TRACE_ID.test(trace.traceId)
      || seenTraceIds.has(trace.traceId)) {
      errors.push('RPC diagnostics contain an invalid trace ID.');
    } else {
      seenTraceIds.add(trace.traceId);
    }
    if (!DEFAULT_SANDBOX_RPC_OPERATIONS.includes(trace.operation)) {
      errors.push('RPC diagnostics contain an unknown operation.');
    } else {
      observedOperations.add(trace.operation);
    }
    if (trace.targetState !== 'parent') {
      errors.push('RPC diagnostics contain an invalid target state.');
    }
    if (![trace.startedAtMs, trace.respondedAtMs, trace.callbackAtMs, trace.durationMs]
      .every((value) => safeInteger(value))) {
      errors.push('RPC diagnostics contain an invalid timestamp.');
    } else {
      if (!(trace.startedAtMs <= trace.respondedAtMs
        && trace.respondedAtMs <= trace.callbackAtMs)) {
        errors.push('RPC diagnostics timestamps are not monotonic.');
      }
      if (trace.callbackAtMs - trace.startedAtMs !== trace.durationMs) {
        errors.push('RPC diagnostics duration is invalid.');
      }
      if (trace.startedAtMs < status.startedAtMs
        || trace.callbackAtMs > status.generatedAtMs) {
        errors.push('RPC diagnostics fall outside the Sandbox session window.');
      }
    }
    if (!exactKeys(trace.payloadItemCounts, RPC_PAYLOAD_COUNT_KEYS)) {
      errors.push('RPC diagnostics payload counts have an unexpected shape.');
    } else if (!RPC_PAYLOAD_COUNT_KEYS.every((key) => safeInteger(
      trace.payloadItemCounts[key],
      0,
      4_096,
    ))) {
      errors.push('RPC diagnostics payload counts are invalid.');
    }
  }

  for (const operation of REQUIRED_RPC_OPERATIONS) {
    if (!observedOperations.has(operation)) {
      errors.push('RPC diagnostics are missing a required operation.');
    }
  }
  if (rpc.summary.requests !== rpc.traces.length
    || rpc.summary.responses !== rpc.traces.length
    || rpc.summary.callbacks !== rpc.traces.length
    || rpc.summary.timeouts !== 0
    || rpc.summary.violations !== 0) {
    errors.push('RPC diagnostics summary does not match the traces.');
  }

  return Object.freeze({ rpcRequests: rpc.traces.length });
}

export function verifySandboxEvidenceBundle(bundle, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const errors = [];
  safeStructure(bundle, errors, 'bundle');
  if (!exactKeys(bundle, ['status', 'events', 'rpcDiagnostics'])) {
    errors.push('Sandbox evidence bundle has an unexpected shape.');
    return createReport(false, errors);
  }

  validateStatusEvidence(bundle.status, options, errors);
  const lifecycle = validateEventsEvidence(bundle.events, options, errors);
  if (isPlainObject(bundle.status) && isPlainObject(bundle.events)) {
    for (const key of ['schemaVersion', 'source', 'sessionId', 'buildSha', 'sdkVersion', 'generatedAtMs']) {
      if (bundle.status[key] !== bundle.events[key]) {
        errors.push('Sandbox status and lifecycle evidence do not describe the same run.');
        break;
      }
    }
  }
  const rpc = validateRpcDiagnostics(bundle.rpcDiagnostics, bundle.status ?? {}, options, errors);

  return createReport(errors.length === 0, errors, {
    ...(lifecycle ?? {}),
    ...(rpc ?? {}),
    hostPauseObserved: bundle.status?.hostPauseObserved === true,
    hostResumeObserved: bundle.status?.hostResumeObserved === true,
  });
}

async function readEvidenceJson(directory, fileName) {
  const path = join(directory, fileName);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw new Error(`Required Sandbox evidence file is missing: ${fileName}.`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_EVIDENCE_FILE_BYTES) {
    throw new Error(`Sandbox evidence file is invalid: ${fileName}.`);
  }
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Sandbox evidence file is unreadable: ${fileName}.`);
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`Sandbox evidence file is not valid JSON: ${fileName}.`);
  }
}

export async function verifySandboxEvidenceDirectory(directory, options = {}) {
  const root = resolve(directory);
  const [status, events, rpcDiagnostics] = await Promise.all([
    readEvidenceJson(root, 'sandbox-status.json'),
    readEvidenceJson(root, 'sandbox-events.json'),
    readEvidenceJson(root, 'rpc-diagnostics.json'),
  ]);
  return verifySandboxEvidenceBundle({ status, events, rpcDiagnostics }, options);
}

export function sha256Pattern() {
  return SHA256;
}
