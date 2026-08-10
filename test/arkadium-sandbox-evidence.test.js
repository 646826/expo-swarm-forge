import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_SANDBOX_RPC_OPERATIONS,
  SANDBOX_RELEASE_STATES,
  verifySandboxEvidence,
  verifySandboxEvidenceBundle,
  verifySandboxEvidenceDirectory,
} from '../scripts/arkadium-sandbox-evidence-lib.mjs';

const SHA = '1111111111111111111111111111111111111111';
const OTHER_SHA = '2222222222222222222222222222222222222222';
const SDK_VERSION = '2.66.2';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const NOW_MS = 1_786_369_200_000;
const STARTED_AT_MS = NOW_MS - 60_000;
const GENERATED_AT_MS = NOW_MS - 1_000;

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

function combinedEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'official-arkadium-sandbox',
    sessionId: SESSION_ID,
    buildSha: SHA,
    sdkVersion: SDK_VERSION,
    startedAtMs: STARTED_AT_MS,
    generatedAtMs: GENERATED_AT_MS,
    observedCalls: observedCalls(),
    hostPauseObserved: true,
    hostResumeObserved: true,
    bootErrorVisible: false,
    consoleErrorCount: 0,
    ...overrides,
  };
}

function statusEvidence(overrides = {}) {
  const evidence = combinedEvidence();
  return {
    schemaVersion: evidence.schemaVersion,
    source: evidence.source,
    sessionId: evidence.sessionId,
    buildSha: evidence.buildSha,
    sdkVersion: evidence.sdkVersion,
    startedAtMs: evidence.startedAtMs,
    generatedAtMs: evidence.generatedAtMs,
    hostPauseObserved: evidence.hostPauseObserved,
    hostResumeObserved: evidence.hostResumeObserved,
    bootErrorVisible: evidence.bootErrorVisible,
    consoleErrorCount: evidence.consoleErrorCount,
    ...overrides,
  };
}

function eventsEvidence(overrides = {}) {
  const evidence = combinedEvidence();
  return {
    schemaVersion: evidence.schemaVersion,
    source: evidence.source,
    sessionId: evidence.sessionId,
    buildSha: evidence.buildSha,
    sdkVersion: evidence.sdkVersion,
    generatedAtMs: evidence.generatedAtMs,
    observedCalls: evidence.observedCalls,
    ...overrides,
  };
}

function rpcTrace(operation, index, startedAtMs) {
  return {
    traceId: `rpc-${index}`,
    operation,
    targetState: 'parent',
    startedAtMs,
    respondedAtMs: startedAtMs + 5,
    callbackAtMs: startedAtMs + 8,
    durationMs: 8,
    payloadItemCounts: {
      request: 1,
      response: 1,
      callback: 0,
    },
  };
}

function rpcEvidence(overrides = {}) {
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
  const traces = operations.map((operation, index) => rpcTrace(
    operation,
    index + 1,
    STARTED_AT_MS + 1_000 + index * 20,
  ));
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
    ...overrides,
  };
}

const options = Object.freeze({
  expectedBuildSha: SHA,
  expectedSdkVersion: SDK_VERSION,
  nowMs: NOW_MS,
  maxAgeMs: 5 * 60_000,
});

test('evidence requires exact build, SDK and lifecycle ordering', () => {
  const report = verifySandboxEvidence(combinedEvidence(), options);
  assert.equal(report.ok, true);
  assert.equal(report.releaseState, 'sandbox-verified');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.summary, {
    lifecycleCalls: 7,
    scoreCalls: 2,
    finalScore: 560,
    levelId: '1',
    hostPauseObserved: true,
    hostResumeObserved: true,
  });
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.errors), true);
  assert.equal(Object.isFrozen(report.summary), true);
  assert.deepEqual(SANDBOX_RELEASE_STATES, [
    'contract-ready',
    'sandbox-verified',
    'arkadium-dev-ready',
    'production-approved',
  ]);
});

test('build, SDK, freshness, host lifecycle, console and boot failures fail closed', () => {
  const mutations = [
    ['build SHA', { buildSha: OTHER_SHA }],
    ['SDK version', { sdkVersion: '2.66.3' }],
    ['stale', { generatedAtMs: NOW_MS - options.maxAgeMs - 1 }],
    ['future', { generatedAtMs: NOW_MS + 1 }],
    ['session timing', { startedAtMs: GENERATED_AT_MS + 1 }],
    ['host pause', { hostPauseObserved: false }],
    ['host resume', { hostResumeObserved: false }],
    ['boot error', { bootErrorVisible: true }],
    ['console error', { consoleErrorCount: 1 }],
  ];

  for (const [message, override] of mutations) {
    const report = verifySandboxEvidence(combinedEvidence(override), options);
    assert.equal(report.ok, false, message);
    assert.equal(report.releaseState, 'contract-ready', message);
    assert.equal(report.errors.length > 0, true, message);
  }
});

test('missing, duplicate, reordered, regressing and unknown lifecycle calls fail closed', () => {
  const invalidCalls = [
    observedCalls().filter((call) => call !== 'gameEnd'),
    ['ready', 'ready', ...observedCalls().slice(1)],
    ['ready', 'levelStart:1', 'gameStart', 'score:240', 'levelEnd:1', 'gameEnd'],
    ['ready', 'gameStart', 'levelStart:1', 'score:560', 'score:240', 'levelEnd:1', 'gameEnd'],
    ['ready', 'gameStart', 'levelStart:1', 'score:240', 'levelEnd:2', 'gameEnd'],
    ['ready', 'gameStart', 'levelStart:1', 'wallet:consume', 'score:240', 'levelEnd:1', 'gameEnd'],
    ['ready', 'gameStart', 'levelStart:1', 'score:{"token":"do-not-echo"}', 'levelEnd:1', 'gameEnd'],
  ];

  for (const calls of invalidCalls) {
    const report = verifySandboxEvidence(combinedEvidence({ observedCalls: calls }), options);
    assert.equal(report.ok, false, JSON.stringify(calls));
    assert.equal(report.errors.length > 0, true, JSON.stringify(calls));
    assert.doesNotMatch(JSON.stringify(report), /do-not-echo/i);
  }
});

test('sensitive fields, accessors, symbols and raw payload objects are rejected without reading them', () => {
  for (const [key, value] of [
    ['token', 'do-not-echo'],
    ['credential', 'do-not-echo'],
    ['profile', { email: 'do-not-echo' }],
    ['savePayload', { score: 1 }],
    ['appInsightsId', 'do-not-echo'],
    ['requestId', 'do-not-echo'],
    ['transactionId', 'do-not-echo'],
    ['payload', { raw: 'do-not-echo' }],
  ]) {
    const report = verifySandboxEvidence({ ...combinedEvidence(), [key]: value }, options);
    assert.equal(report.ok, false, key);
    assert.doesNotMatch(JSON.stringify(report), /do-not-echo/i);
  }

  let getterCalls = 0;
  const accessorEvidence = combinedEvidence();
  Object.defineProperty(accessorEvidence, 'token', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'do-not-echo';
    },
  });
  const accessorReport = verifySandboxEvidence(accessorEvidence, options);
  assert.equal(accessorReport.ok, false);
  assert.equal(getterCalls, 0);

  const symbolEvidence = combinedEvidence();
  symbolEvidence[Symbol('token')] = 'do-not-echo';
  assert.equal(verifySandboxEvidence(symbolEvidence, options).ok, false);
});

test('bundle binds status, events and sanitized RPC diagnostics to one exact run', () => {
  const report = verifySandboxEvidenceBundle({
    status: statusEvidence(),
    events: eventsEvidence(),
    rpcDiagnostics: rpcEvidence(),
  }, options);

  assert.equal(report.ok, true);
  assert.equal(report.releaseState, 'sandbox-verified');
  assert.equal(report.summary.rpcRequests, 8);
  assert.deepEqual(DEFAULT_SANDBOX_RPC_OPERATIONS.includes('lifecycle.onGameStart'), true);
});

test('bundle rejects cross-run evidence and unsafe RPC diagnostics', () => {
  const mutations = [
    {
      status: statusEvidence(),
      events: eventsEvidence({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
      rpcDiagnostics: rpcEvidence(),
    },
    {
      status: statusEvidence(),
      events: eventsEvidence(),
      rpcDiagnostics: rpcEvidence({ buildSha: OTHER_SHA }),
    },
    {
      status: statusEvidence(),
      events: eventsEvidence(),
      rpcDiagnostics: rpcEvidence({ status: 'FAIL' }),
    },
    {
      status: statusEvidence(),
      events: eventsEvidence(),
      rpcDiagnostics: rpcEvidence({
        traces: [rpcTrace('wallet.consumeCurrency', 1, STARTED_AT_MS + 1_000)],
        summary: { requests: 1, responses: 1, callbacks: 1, timeouts: 0, violations: 0 },
      }),
    },
    {
      status: statusEvidence(),
      events: eventsEvidence(),
      rpcDiagnostics: rpcEvidence({ payload: { token: 'do-not-echo' } }),
    },
  ];

  for (const bundle of mutations) {
    const report = verifySandboxEvidenceBundle(bundle, options);
    assert.equal(report.ok, false);
    assert.equal(report.releaseState, 'contract-ready');
    assert.doesNotMatch(JSON.stringify(report), /do-not-echo/i);
  }
});

test('directory verification requires all three exact JSON files and writes no synthetic success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkadium-sandbox-evidence-'));
  try {
    await writeFile(join(directory, 'sandbox-status.json'), `${JSON.stringify(statusEvidence())}\n`);
    await writeFile(join(directory, 'sandbox-events.json'), `${JSON.stringify(eventsEvidence())}\n`);
    await writeFile(join(directory, 'rpc-diagnostics.json'), `${JSON.stringify(rpcEvidence())}\n`);

    const report = await verifySandboxEvidenceDirectory(directory, options);
    assert.equal(report.ok, true);

    await rm(join(directory, 'rpc-diagnostics.json'));
    await assert.rejects(
      () => verifySandboxEvidenceDirectory(directory, options),
      /rpc-diagnostics\.json/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('manual workflow is protected, exact-build, Chrome-backed and fail-closed', async () => {
  const [workflow, runbook, checklist, runtime, main] = await Promise.all([
    readFile(new URL('../.github/workflows/arkadium-sandbox.yml', import.meta.url), 'utf8'),
    readFile(new URL('../docs/ARKADIUM_SANDBOX_RUNBOOK.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/ARKADIUM_CHECKLIST.md', import.meta.url), 'utf8'),
    readFile(new URL('../example/canyon-charms/src/integration/runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../example/canyon-charms/src/main.js', import.meta.url), 'utf8'),
  ]);

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /candidate_sha:/);
  assert.match(workflow, /environment:\s*\n\s*name:\s*arkadium-sandbox/);
  assert.match(workflow, /ARKADIUM_SANDBOX_AUTOMATION_JSON/);
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /npm run build:arkadium/);
  assert.match(workflow, /actions\/deploy-pages@/);
  assert.match(workflow, /sandbox-candidates\/\$\{\{ inputs\.candidate_sha \}\}/);
  assert.match(workflow, /capture-arkadium-sandbox-evidence\.mjs/);
  assert.match(workflow, /verify-arkadium-sandbox-evidence\.mjs/);
  assert.match(workflow, /sandbox-status\.json/);
  assert.match(workflow, /sandbox-events\.json/);
  assert.match(workflow, /rpc-diagnostics\.json/);
  assert.match(workflow, /sandbox-console\.log/);
  assert.match(workflow, /sandbox-page\.png/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|\|\|\s*true|synthetic|fabricated/i);

  assert.match(runbook, /contract-ready/);
  assert.match(runbook, /sandbox-verified/);
  assert.match(runbook, /arkadium-dev-ready/);
  assert.match(runbook, /production-approved/);
  assert.match(runbook, /protected environment/i);
  assert.match(checklist, /Current release state:\s*`contract-ready`/);
  assert.match(checklist, /does not claim Sandbox verification/i);

  assert.match(runtime, /__CANYON_SANDBOX_EVIDENCE__/);
  assert.match(runtime, /official-arkadium-sandbox/);
  assert.match(main, /__CANYON_SANDBOX_DRIVER__/);
  assert.match(main, /sandboxEvidence/);
  assert.match(main, /findHint\(game\)/);
  assert.match(main, /arkadium-prod/);
});
