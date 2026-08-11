import assert from 'node:assert/strict';
import test from 'node:test';

import {
  verifySandboxEvidence,
  verifySandboxEvidenceBundle,
} from '../scripts/arkadium-sandbox-evidence-lib.mjs';

const SHA = '1111111111111111111111111111111111111111';
const SDK_VERSION = '2.66.2';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const NOW_MS = 1_786_369_200_000;
const STARTED_AT_MS = NOW_MS - 60_000;
const GENERATED_AT_MS = NOW_MS - 1_000;

const options = Object.freeze({
  expectedBuildSha: SHA,
  expectedSdkVersion: SDK_VERSION,
  nowMs: NOW_MS,
  maxAgeMs: 5 * 60_000,
});

function lifecycleCalls() {
  return [
    'ready',
    'gameStart',
    'levelStart:1',
    'score:240',
    'score:560',
    'levelEnd:1',
    'gameEnd',
  ];
}

function combinedEvidence() {
  return {
    schemaVersion: 1,
    source: 'official-arkadium-sandbox',
    sessionId: SESSION_ID,
    buildSha: SHA,
    sdkVersion: SDK_VERSION,
    startedAtMs: STARTED_AT_MS,
    generatedAtMs: GENERATED_AT_MS,
    observedCalls: lifecycleCalls(),
    hostPauseObserved: true,
    hostResumeObserved: true,
    bootErrorVisible: false,
    consoleErrorCount: 0,
  };
}

function statusEvidence() {
  const evidence = combinedEvidence();
  const { observedCalls: ignored, ...status } = evidence;
  return status;
}

function eventsEvidence() {
  const evidence = combinedEvidence();
  return {
    schemaVersion: evidence.schemaVersion,
    source: evidence.source,
    sessionId: evidence.sessionId,
    buildSha: evidence.buildSha,
    sdkVersion: evidence.sdkVersion,
    generatedAtMs: evidence.generatedAtMs,
    observedCalls: evidence.observedCalls,
  };
}

function rpcEvidence() {
  const operations = [
    'host.getDetails',
    'host.isAuthSupported',
    'lifecycle.onTestReady',
    'lifecycle.onGameStart',
    'lifecycle.onChangeScore',
    'lifecycle.onLevelStart',
    'lifecycle.onLevelEnd',
    'lifecycle.onGameEnd',
  ];
  const traces = operations.map((operation, index) => {
    const startedAtMs = STARTED_AT_MS + 1_000 + index * 20;
    return {
      traceId: `rpc-${index + 1}`,
      operation,
      targetState: 'parent',
      startedAtMs,
      respondedAtMs: startedAtMs + 5,
      callbackAtMs: startedAtMs + 8,
      durationMs: 8,
      payloadItemCounts: { request: 1, response: 1, callback: 0 },
    };
  });
  return {
    schemaVersion: 1,
    buildSha: SHA,
    sdkVersion: SDK_VERSION,
    environment: 'DEV',
    generatedAtMs: GENERATED_AT_MS,
    status: 'PASS',
    summary: {
      requests: traces.length,
      responses: traces.length,
      callbacks: traces.length,
      timeouts: 0,
      violations: 0,
    },
    traces,
    violations: [],
  };
}

test('combined evidence rejects an accessor on an expected field without invoking it', () => {
  let getterCalls = 0;
  const evidence = combinedEvidence();
  Object.defineProperty(evidence, 'buildSha', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return SHA;
    },
  });

  const report = verifySandboxEvidence(evidence, options);
  assert.equal(report.ok, false);
  assert.equal(report.releaseState, 'contract-ready');
  assert.equal(getterCalls, 0);
});

test('bundle rejects a top-level accessor without invoking it', () => {
  let getterCalls = 0;
  const bundle = {
    status: statusEvidence(),
    events: eventsEvidence(),
    rpcDiagnostics: rpcEvidence(),
  };
  Object.defineProperty(bundle, 'status', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return statusEvidence();
    },
  });

  const report = verifySandboxEvidenceBundle(bundle, options);
  assert.equal(report.ok, false);
  assert.equal(report.releaseState, 'contract-ready');
  assert.equal(getterCalls, 0);
});

test('array evidence with an exotic prototype is rejected before inherited accessors run', () => {
  let getterCalls = 0;
  const calls = lifecycleCalls();
  const exoticPrototype = Object.create(Array.prototype);
  Object.defineProperty(exoticPrototype, 'some', {
    get() {
      getterCalls += 1;
      return Array.prototype.some;
    },
  });
  Object.setPrototypeOf(calls, exoticPrototype);

  const evidence = combinedEvidence();
  evidence.observedCalls = calls;
  const report = verifySandboxEvidence(evidence, options);
  assert.equal(report.ok, false);
  assert.equal(report.releaseState, 'contract-ready');
  assert.equal(getterCalls, 0);
});
