import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const COMMAND = join(ROOT, 'scripts/verify-correlated-telemetry-evidence.mjs');
const BUILD_SHA = '1111111111111111111111111111111111111111';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const SDK_VERSION = '2.66.2';
const NOW_MS = 1_786_369_200_000;
const STARTED_AT_MS = NOW_MS - 60_000;
const SANDBOX_GENERATED_AT_MS = NOW_MS - 2_000;
const ARK_EYE_GENERATED_AT_MS = NOW_MS - 500;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sandboxVerification() {
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
  };
}

function sandboxStatus() {
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
  };
}

function sandboxEvents() {
  return {
    schemaVersion: 1,
    source: 'official-arkadium-sandbox',
    sessionId: SESSION_ID,
    buildSha: BUILD_SHA,
    sdkVersion: SDK_VERSION,
    generatedAtMs: SANDBOX_GENERATED_AT_MS,
    observedCalls: [
      'ready',
      'gameStart',
      'levelStart:1',
      'score:240',
      'score:560',
      'levelEnd:1',
      'gameEnd',
    ],
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

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fixture(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'correlated-telemetry-command-'));
  const paths = {
    verification: join(directory, 'sandbox-verification.json'),
    status: join(directory, 'sandbox-status.json'),
    events: join(directory, 'sandbox-events.json'),
    arkEye: join(directory, 'ark-eye-evidence.json'),
    output: join(directory, 'correlated-report.json'),
  };
  await Promise.all([
    writeJson(paths.verification, sandboxVerification()),
    writeJson(paths.status, sandboxStatus()),
    writeJson(paths.events, sandboxEvents()),
    writeJson(paths.arkEye, arkEyeEvidence(overrides)),
  ]);
  return paths;
}

function run(paths, extra = []) {
  return spawnSync(process.execPath, [
    COMMAND,
    '--sandbox-verification', paths.verification,
    '--sandbox-status', paths.status,
    '--sandbox-events', paths.events,
    '--ark-eye-evidence', paths.arkEye,
    '--expected-build-sha', BUILD_SHA,
    '--output', paths.output,
    '--now-ms', String(NOW_MS),
    '--max-age-ms', String(15 * 60_000),
    ...extra,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('command writes one correlated release-gate report for an exact persisted Sandbox session', async () => {
  const paths = await fixture();
  const result = run(paths);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  const report = JSON.parse(await readFile(paths.output, 'utf8'));
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
  assert.deepEqual(JSON.parse(result.stdout), report);
});

test('verification drift writes the fail-closed report and exits non-zero', async () => {
  const paths = await fixture({ clickHouseRowCount: 15 });
  const result = run(paths);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(await readFile(paths.output, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.releaseState, 'sandbox-verified');
  assert.equal(report.errors.length > 0, true);
  assert.deepEqual(report.summary, {});
  assert.deepEqual(JSON.parse(result.stdout), report);
});

test('malformed input and unsafe invocation fail without echoing paths or values', async () => {
  const paths = await fixture();
  await writeFile(paths.arkEye, '{"credential":"do-not-echo"', 'utf8');
  const malformed = run(paths);
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stdout, '');
  assert.match(malformed.stderr, /^Correlated telemetry evidence command failed\.\n$/);
  assert.doesNotMatch(`${malformed.stdout}${malformed.stderr}`, /do-not-echo|credential|ark-eye-evidence\.json/i);

  const duplicate = run(paths, ['--output', join(tmpdir(), 'other-output.json')]);
  assert.equal(duplicate.status, 1);
  assert.equal(duplicate.stdout, '');
  assert.match(duplicate.stderr, /^Correlated telemetry evidence command failed\.\n$/);
});

test('input and output paths must be distinct', async () => {
  const paths = await fixture();
  paths.output = paths.arkEye;
  const result = run(paths);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Correlated telemetry evidence command failed\.\n$/);
});
