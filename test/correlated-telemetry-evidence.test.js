import assert from 'node:assert/strict';
import test from 'node:test';

import {
  verifyCorrelatedTelemetryEvidence,
} from '../scripts/correlated-telemetry-evidence-lib.mjs';

const BUILD_SHA = '1111111111111111111111111111111111111111';
const OTHER_BUILD_SHA = '2222222222222222222222222222222222222222';
const SDK_VERSION = '2.66.2';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW_MS = 1_786_369_200_000;
const STARTED_AT_MS = NOW_MS - 60_000;
const SANDBOX_GENERATED_AT_MS = NOW_MS - 2_000;
const ARK_EYE_GENERATED_AT_MS = NOW_MS - 500;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function observedCalls() {
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

function sandboxVerification(overrides = {}) {
  return {
    ok: true,
    releaseState: 'sandbox-verified',
    errors: [],
    summary: {
      lifecycleCalls: 7,
      scoreCalls: 2,
      finalScore: 560,
      levelId: '1',
      rpcRequests: 8,
      hostPauseObserved: true,
      hostResumeObserved: true,
    },
    ...overrides,
  };
}

function sandboxStatus(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'official-arkadium-sandbox',
    sessionId: SESSION_ID,
    buildSha: BUILD_SHA,
    sdkVersion: SDK_VERSION,
    startedAtMs: STARTED_AT_MS,
    generatedAtMs: SANDBOX_GENERATED_AT_MS,
    hostPauseObserved: true,
    hostResumeObserved: true,
    bootErrorVisible: false,
    consoleErrorCount: 0,
    ...overrides,
  };
}

function sandboxEvents(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'official-arkadium-sandbox',
    sessionId: SESSION_ID,
    buildSha: BUILD_SHA,
    sdkVersion: SDK_VERSION,
    generatedAtMs: SANDBOX_GENERATED_AT_MS,
    observedCalls: observedCalls(),
    ...overrides,
  };
}

function arkEyeEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'ark-eye-sandbox-telemetry-correlation',
    buildSha: BUILD_SHA,
    sessionId: SESSION_ID,
    sdkVersion: SDK_VERSION,
    platformMode: 'arkadium-sandbox',
    generatedAtMs: ARK_EYE_GENERATED_AT_MS,
    consumerReadyAtMs: STARTED_AT_MS - 1_000,
    browserCapturedAtMs: SANDBOX_GENERATED_AT_MS - 100,
    eventCount: 16,
    firstEventName: 'sdk_initialize_started',
    lastEventName: 'game_end',
    firstSequence: 1,
    lastSequence: 16,
    clickHouseRowCount: 16,
    sessionFirstStreamSequence: 101,
    sessionLastStreamSequence: 116,
    ackFloorStreamSequence: 116,
    pending: 0,
    ackPending: 0,
    redelivered: 0,
    browserEvidenceSha256: HASH_A,
    rowsSha256: HASH_B,
    ...overrides,
  };
}

function bundle(overrides = {}) {
  return {
    sandbox: {
      verification: sandboxVerification(),
      status: sandboxStatus(),
      events: sandboxEvents(),
    },
    arkEye: arkEyeEvidence(),
    ...overrides,
  };
}

const options = Object.freeze({
  expectedBuildSha: BUILD_SHA,
  expectedSdkVersion: SDK_VERSION,
  nowMs: NOW_MS,
  maxAgeMs: 15 * 60_000,
});

test('official Sandbox and Ark Eye evidence bind to one exact persisted session', () => {
  const report = verifyCorrelatedTelemetryEvidence(bundle(), options);

  assert.equal(report.ok, true);
  assert.equal(report.releaseState, 'sandbox-telemetry-verified');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.summary, {
    buildSha: BUILD_SHA,
    sessionId: SESSION_ID,
    sdkVersion: SDK_VERSION,
    lifecycleCalls: 7,
    telemetryEventCount: 16,
    clickHouseRowCount: 16,
    ackFloorStreamSequence: 116,
    sandboxEvidenceSha256: report.summary.sandboxEvidenceSha256,
    browserEvidenceSha256: HASH_A,
    rowsSha256: HASH_B,
  });
  assert.match(report.summary.sandboxEvidenceSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.errors), true);
  assert.equal(Object.isFrozen(report.summary), true);
  assert.equal(
    verifyCorrelatedTelemetryEvidence(bundle(), options).summary.sandboxEvidenceSha256,
    report.summary.sandboxEvidenceSha256,
  );
});

test('cross-bundle identity, ordering, freshness, persistence and ACK drift fail closed', () => {
  const mutations = [
    ['candidate build', bundle({ arkEye: arkEyeEvidence({ buildSha: OTHER_BUILD_SHA }) })],
    ['session', bundle({ arkEye: arkEyeEvidence({ sessionId: OTHER_SESSION_ID }) })],
    ['SDK', bundle({ arkEye: arkEyeEvidence({ sdkVersion: '2.66.3' }) })],
    ['source', bundle({ arkEye: arkEyeEvidence({ source: 'local-browser-telemetry' }) })],
    ['platform', bundle({ arkEye: arkEyeEvidence({ platformMode: 'standalone' }) })],
    ['first event', bundle({ arkEye: arkEyeEvidence({ firstEventName: 'sdk_ready' }) })],
    ['last event', bundle({ arkEye: arkEyeEvidence({ lastEventName: 'resume' }) })],
    ['sequence', bundle({ arkEye: arkEyeEvidence({ lastSequence: 15 }) })],
    ['row count', bundle({ arkEye: arkEyeEvidence({ clickHouseRowCount: 15 }) })],
    ['stream span', bundle({ arkEye: arkEyeEvidence({ sessionFirstStreamSequence: 102 }) })],
    ['ACK floor', bundle({ arkEye: arkEyeEvidence({ ackFloorStreamSequence: 115 }) })],
    ['pending', bundle({ arkEye: arkEyeEvidence({ pending: 1 }) })],
    ['ACK pending', bundle({ arkEye: arkEyeEvidence({ ackPending: 1 }) })],
    ['redelivery', bundle({ arkEye: arkEyeEvidence({ redelivered: 1 }) })],
    ['consumer readiness', bundle({ arkEye: arkEyeEvidence({ consumerReadyAtMs: STARTED_AT_MS + 1 }) })],
    ['browser timing', bundle({ arkEye: arkEyeEvidence({ browserCapturedAtMs: STARTED_AT_MS - 1 }) })],
    ['stale Ark Eye evidence', bundle({ arkEye: arkEyeEvidence({ generatedAtMs: NOW_MS - options.maxAgeMs - 1 }) })],
    ['unverified Sandbox', bundle({
      sandbox: {
        verification: sandboxVerification({ ok: false, releaseState: 'contract-ready' }),
        status: sandboxStatus(),
        events: sandboxEvents(),
      },
    })],
  ];

  for (const [label, input] of mutations) {
    const report = verifyCorrelatedTelemetryEvidence(input, options);
    assert.equal(report.ok, false, label);
    assert.equal(report.releaseState, 'sandbox-verified', label);
    assert.equal(report.errors.length > 0, true, label);
    assert.deepEqual(report.summary, {}, label);
  }
});

test('Sandbox status, lifecycle and verification summary must describe the same official run', () => {
  const mutations = [
    {
      verification: sandboxVerification({
        summary: { ...sandboxVerification().summary, lifecycleCalls: 6 },
      }),
      status: sandboxStatus(),
      events: sandboxEvents(),
    },
    {
      verification: sandboxVerification(),
      status: sandboxStatus({ sessionId: OTHER_SESSION_ID }),
      events: sandboxEvents(),
    },
    {
      verification: sandboxVerification(),
      status: sandboxStatus(),
      events: sandboxEvents({ observedCalls: [...observedCalls()].reverse() }),
    },
    {
      verification: sandboxVerification(),
      status: sandboxStatus(),
      events: sandboxEvents({ generatedAtMs: SANDBOX_GENERATED_AT_MS - 1 }),
    },
  ];

  for (const sandbox of mutations) {
    const report = verifyCorrelatedTelemetryEvidence({
      sandbox,
      arkEye: arkEyeEvidence(),
    }, options);
    assert.equal(report.ok, false);
    assert.equal(report.releaseState, 'sandbox-verified');
  }
});

test('unsafe structures fail closed before getters run and rejected values never echo', () => {
  let getterCalls = 0;
  const input = bundle();
  Object.defineProperty(input.arkEye, 'buildSha', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'do-not-echo';
    },
  });
  const accessorReport = verifyCorrelatedTelemetryEvidence(input, options);
  assert.equal(accessorReport.ok, false);
  assert.equal(getterCalls, 0);
  assert.doesNotMatch(JSON.stringify(accessorReport), /do-not-echo/i);

  const symbolInput = bundle();
  symbolInput.sandbox.status[Symbol('token')] = 'do-not-echo';
  assert.equal(verifyCorrelatedTelemetryEvidence(symbolInput, options).ok, false);

  const extraInput = bundle();
  extraInput.arkEye = { ...extraInput.arkEye, credential: 'do-not-echo' };
  const extraReport = verifyCorrelatedTelemetryEvidence(extraInput, options);
  assert.equal(extraReport.ok, false);
  assert.doesNotMatch(JSON.stringify(extraReport), /do-not-echo/i);
});

test('invalid options are rejected without reading accessor values', () => {
  let getterCalls = 0;
  const unsafeOptions = { ...options };
  Object.defineProperty(unsafeOptions, 'expectedBuildSha', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'do-not-echo';
    },
  });
  assert.throws(
    () => verifyCorrelatedTelemetryEvidence(bundle(), unsafeOptions),
    /Correlated telemetry evidence verification options are invalid\./,
  );
  assert.equal(getterCalls, 0);
});
