import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/verify-correlated-telemetry-evidence.mjs');
const BUILD_SHA = '1111111111111111111111111111111111111111';
const SDK_VERSION = '2.66.2';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW_MS = 1_786_369_200_000;
const STARTED_AT_MS = NOW_MS - 60_000;
const SANDBOX_GENERATED_AT_MS = NOW_MS - 2_000;
const ARK_EYE_GENERATED_AT_MS = NOW_MS - 500;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function verification() {
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

function status() {
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

function events() {
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

function arkEye(overrides = {}) {
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

async function fixture(arkEyeOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'correlated-telemetry-command-'));
  const directory = join(root, 'sandbox');
  const arkEyePath = join(root, 'ark-eye-correlation.json');
  const outputPath = join(directory, 'correlated-telemetry-verification.json');
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, 'sandbox-verification.json'),
      `${JSON.stringify(verification(), null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(directory, 'sandbox-status.json'),
      `${JSON.stringify(status(), null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(directory, 'sandbox-events.json'),
      `${JSON.stringify(events(), null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      arkEyePath,
      `${JSON.stringify(arkEye(arkEyeOverrides), null, 2)}\n`,
      'utf8',
    ),
  ]);
  return { root, directory, arkEyePath, outputPath };
}

function runCommand(input, extra = []) {
  return spawnSync(process.execPath, [
    SCRIPT,
    '--directory', input.directory,
    '--ark-eye-evidence', input.arkEyePath,
    '--expected-build-sha', BUILD_SHA,
    '--expected-sdk-version', SDK_VERSION,
    '--now-ms', String(NOW_MS),
    '--max-age-ms', '900000',
    ...extra,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('command writes the exact successful correlation report', async () => {
  const input = await fixture();
  const result = runCommand(input);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Arkadium Sandbox telemetry correlation verified\./);

  const reportText = await readFile(input.outputPath, 'utf8');
  assert.equal(reportText.endsWith('\n'), true);
  const report = JSON.parse(reportText);
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
  assert.doesNotMatch(
    reportText,
    /endpoint|credential|token|cookie|profile|save|password|authorization/i,
  );
});

test('command writes a fail-closed report for mismatched evidence without echoing values', async () => {
  const input = await fixture({ sessionId: OTHER_SESSION_ID });
  const result = runCommand(input);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Correlated telemetry evidence: /m);
  assert.doesNotMatch(result.stderr, new RegExp(OTHER_SESSION_ID, 'i'));

  const reportText = await readFile(input.outputPath, 'utf8');
  const report = JSON.parse(reportText);
  assert.equal(report.ok, false);
  assert.equal(report.releaseState, 'sandbox-verified');
  assert.equal(report.errors.length > 0, true);
  assert.deepEqual(report.summary, {});
  assert.doesNotMatch(reportText, new RegExp(OTHER_SESSION_ID, 'i'));
});

test('malformed evidence and unknown options fail generically without secret disclosure', async () => {
  const malformed = await fixture();
  await writeFile(malformed.arkEyePath, '{"credential":"do-not-echo"', 'utf8');
  const malformedResult = runCommand(malformed);

  assert.equal(malformedResult.status, 1);
  assert.doesNotMatch(malformedResult.stderr, /do-not-echo/i);
  const malformedReport = JSON.parse(await readFile(malformed.outputPath, 'utf8'));
  assert.deepEqual(malformedReport, {
    ok: false,
    releaseState: 'sandbox-verified',
    errors: ['Correlated telemetry evidence command failed.'],
    summary: {},
  });

  const unknown = await fixture();
  const unknownResult = runCommand(unknown, ['--credential', 'do-not-echo']);
  assert.equal(unknownResult.status, 1);
  assert.doesNotMatch(unknownResult.stderr, /do-not-echo/i);
  await assert.rejects(() => access(unknown.outputPath));
});
