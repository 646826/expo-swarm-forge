import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createLocalTelemetryCaptureEvidence,
  validateLocalTelemetryCaptureOutput,
  validateLocalTelemetryCaptureUrl,
} from '../scripts/local-telemetry-capture-lib.mjs';

const SHA = '1111111111111111111111111111111111111111';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

function telemetry(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'local-browser-telemetry',
    sessionId: SESSION_ID,
    buildSha: SHA,
    gameVersion: '1.1.0',
    platformMode: 'standalone',
    sdkVersion: null,
    phase: 'playing',
    eventCount: 8,
    lastEventName: 'resumed',
    queueCount: 0,
    droppedCount: 0,
    inFlight: false,
    lastDelivery: {
      outcome: 'delivered',
      attempts: 1,
      batchSize: 8,
      httpStatus: 202,
    },
    ...overrides,
  };
}

function capture(overrides = {}) {
  return createLocalTelemetryCaptureEvidence({
    capturedAt: '2026-08-11T23:30:00.000Z',
    expectedBuildSha: SHA,
    title: 'Canyon Charms',
    telemetry: telemetry(),
    beforeMove: {
      mode: 'playing',
      status: 'playing',
      score: 0,
      moves: 20,
    },
    afterMove: {
      mode: 'playing',
      status: 'playing',
      score: 120,
      moves: 19,
    },
    paused: true,
    resumed: true,
    officialRuntimeRequests: 0,
    gameEventPostCount: 1,
    consoleErrorCount: 0,
    ...overrides,
  });
}

test('capture URL accepts one exact loopback telemetry run', () => {
  assert.equal(
    validateLocalTelemetryCaptureUrl(
      'http://127.0.0.1:4173/?seed=12345&telemetryEvidence=1',
    ),
    'http://127.0.0.1:4173/?seed=12345&telemetryEvidence=1',
  );

  for (const value of [
    'https://127.0.0.1:4173/?seed=12345&telemetryEvidence=1',
    'http://localhost:4173/?seed=12345&telemetryEvidence=1',
    'http://127.0.0.1/?seed=12345&telemetryEvidence=1',
    'http://127.0.0.1:4173/game/?seed=12345&telemetryEvidence=1',
    'http://127.0.0.1:4173/?seed=1&telemetryEvidence=1',
    'http://127.0.0.1:4173/?seed=12345&telemetryEvidence=0',
    'http://127.0.0.1:4173/?seed=12345&telemetryEvidence=1&debug=1',
    'http://user:secret@127.0.0.1:4173/?seed=12345&telemetryEvidence=1',
    'http://127.0.0.1:4173/?seed=12345&telemetryEvidence=1#fragment',
  ]) {
    assert.throws(
      () => validateLocalTelemetryCaptureUrl(value),
      /Local telemetry capture URL is invalid\./,
      value,
    );
  }
});

test('capture output stays inside the repository and is JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'telemetry-capture-root-'));
  try {
    assert.equal(
      validateLocalTelemetryCaptureOutput(root, 'evidence/local-telemetry.json'),
      join(root, 'evidence', 'local-telemetry.json'),
    );
    for (const value of [
      '../outside.json',
      '/tmp/outside.json',
      'evidence/local-telemetry.txt',
      'evidence',
      '',
    ]) {
      assert.throws(
        () => validateLocalTelemetryCaptureOutput(root, value),
        /Local telemetry capture output is invalid\./,
        value,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('capture evidence is exact, frozen, correlated and privacy-minimal', () => {
  const evidence = capture();

  assert.deepEqual(evidence, {
    schemaVersion: 1,
    source: 'local-browser-telemetry-capture',
    capturedAt: '2026-08-11T23:30:00.000Z',
    expectedBuildSha: SHA,
    browser: {
      title: 'Canyon Charms',
      runtimeMode: 'standalone',
      officialRuntimeRequests: 0,
      gameEventPostCount: 1,
      consoleErrorCount: 0,
    },
    interaction: {
      initialMoves: 20,
      finalMoves: 19,
      scoreDelta: 120,
      paused: true,
      resumed: true,
    },
    telemetry: telemetry(),
  });
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.browser), true);
  assert.equal(Object.isFrozen(evidence.interaction), true);
  assert.equal(Object.isFrozen(evidence.telemetry), true);
  assert.equal(Object.isFrozen(evidence.telemetry.lastDelivery), true);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /endpoint|url|credential|authorization|access[_ -]?token|refresh[_ -]?token|password|cookie|profile|save[_ -]?payload|app[_ -]?insights|request[_ -]?id|transaction[_ -]?id/i,
  );
});

test('capture evidence fails closed on build, delivery, interaction and browser drift', () => {
  const invalid = [
    { expectedBuildSha: '2222222222222222222222222222222222222222' },
    { telemetry: telemetry({ platformMode: 'arkadium-sandbox', sdkVersion: '2.66.2' }) },
    { telemetry: telemetry({ queueCount: 1 }) },
    { telemetry: telemetry({ droppedCount: 1 }) },
    { telemetry: telemetry({ inFlight: true }) },
    { telemetry: telemetry({ lastDelivery: null }) },
    { telemetry: telemetry({ lastDelivery: { outcome: 'failed', attempts: 5, batchSize: 8, httpStatus: 503 } }) },
    { afterMove: { mode: 'playing', status: 'playing', score: 0, moves: 20 } },
    { paused: false },
    { resumed: false },
    { officialRuntimeRequests: 1 },
    { gameEventPostCount: 0 },
    { consoleErrorCount: 1 },
  ];

  for (const overrides of invalid) {
    assert.throws(
      () => capture(overrides),
      /Local telemetry capture evidence is invalid\./,
      JSON.stringify(overrides),
    );
  }
});

test('capture implementation uses CDP, exact controls and no raw sensitive evidence', async () => {
  const [source, packageSource] = await Promise.all([
    readFile(new URL('../scripts/capture-local-telemetry-evidence.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.match(source, /__CANYON_TELEMETRY_EVIDENCE__/);
  assert.match(source, /__CANYON_SANDBOX_DRIVER__/);
  assert.match(source, /button\[data-action="start"\]/);
  assert.match(source, /button\[data-action="pause"\]/);
  assert.match(source, /button\[data-action="resume"\]/);
  assert.match(source, /\.nextMove\(\)/);
  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.match(source, /Network\.requestWillBeSent/);
  assert.match(source, /Runtime\.exceptionThrown/);
  assert.match(source, /telemetryEvidence=1/);
  assert.match(source, /--expected-build-sha/);
  assert.match(source, /--output/);
  assert.match(
    packageJson.scripts['capture:telemetry'],
    /capture-local-telemetry-evidence\.mjs/,
  );
  assert.doesNotMatch(
    source,
    /document\.cookie|localStorage|sessionStorage|authorization\s*:|password\s*:|access[_-]?token\s*:/i,
  );
});
