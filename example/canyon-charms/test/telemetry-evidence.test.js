import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createTelemetryEvidenceSnapshot,
  installTelemetryEvidenceApi,
} from '../src/integration/telemetry-evidence.js';

const SHA = '1111111111111111111111111111111111111111';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const SDK_VERSION = '2.66.2';

function runtimeManifest(overrides = {}) {
  return Object.freeze({
    schemaVersion: 1,
    mode: 'standalone',
    arkadiumEnvironment: null,
    gameId: null,
    analyticsProvider: 'none',
    appInsightsId: null,
    gameEyeEndpoint: 'http://127.0.0.1:3001/v1/game-events',
    gameEyeProject: 'canyon-charms',
    gameVersion: '1.1.0',
    buildSha: SHA,
    ...overrides,
  });
}

function integrationDiagnostics(overrides = {}) {
  return Object.freeze({
    phase: 'playing',
    events: Object.freeze([
      Object.freeze({ name: 'sdk_ready' }),
      Object.freeze({ name: 'game_start' }),
      Object.freeze({ name: 'level_start' }),
    ]),
    deliveryFailures: Object.freeze([]),
    ...overrides,
  });
}

function deliveryDiagnostics(overrides = {}) {
  return Object.freeze({
    sessionId: SESSION_ID,
    queueCount: 0,
    droppedCount: 0,
    inFlight: false,
    lastResult: Object.freeze({
      outcome: 'delivered',
      attempts: 1,
      batchSize: 3,
      httpStatus: 202,
    }),
    ...overrides,
  });
}

function snapshot(overrides = {}) {
  return createTelemetryEvidenceSnapshot({
    runtimeManifest: runtimeManifest(),
    sdkVersion: null,
    sessionId: SESSION_ID,
    integrationDiagnostics: integrationDiagnostics(),
    deliveryDiagnostics: deliveryDiagnostics(),
    ...overrides,
  });
}

test('standalone telemetry evidence is exact, frozen and privacy-minimal', () => {
  const evidence = snapshot();

  assert.deepEqual(evidence, {
    schemaVersion: 1,
    source: 'local-browser-telemetry',
    sessionId: SESSION_ID,
    buildSha: SHA,
    gameVersion: '1.1.0',
    platformMode: 'standalone',
    sdkVersion: null,
    phase: 'playing',
    eventCount: 3,
    lastEventName: 'level_start',
    queueCount: 0,
    droppedCount: 0,
    inFlight: false,
    lastDelivery: {
      outcome: 'delivered',
      attempts: 1,
      batchSize: 3,
      httpStatus: 202,
    },
  });
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.lastDelivery), true);
  assert.deepEqual(Object.keys(evidence), [
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
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /endpoint|credential|access[_ -]?token|refresh[_ -]?token|authorization|password|cookie|profile|save[_ -]?payload|app[_ -]?insights|request[_ -]?id|transaction[_ -]?id/i,
  );
});

test('telemetry evidence binds runtime mode to the reviewed SDK version', () => {
  assert.throws(
    () => snapshot({ sdkVersion: SDK_VERSION }),
    /Telemetry evidence context is invalid\./,
  );

  const sandbox = snapshot({
    runtimeManifest: runtimeManifest({
      mode: 'arkadium-sandbox',
      arkadiumEnvironment: 'DEV',
      analyticsProvider: 'console',
    }),
    sdkVersion: SDK_VERSION,
  });
  assert.equal(sandbox.platformMode, 'arkadium-sandbox');
  assert.equal(sandbox.sdkVersion, SDK_VERSION);

  assert.throws(
    () => snapshot({
      runtimeManifest: runtimeManifest({
        mode: 'arkadium-sandbox',
        arkadiumEnvironment: 'DEV',
        analyticsProvider: 'console',
      }),
      sdkVersion: null,
    }),
    /Telemetry evidence context is invalid\./,
  );

  assert.throws(
    () => snapshot({
      runtimeManifest: runtimeManifest({
        mode: 'arkadium-prod',
        arkadiumEnvironment: 'PROD',
        gameId: 'canyon-charms-prod',
        analyticsProvider: 'app-insights',
        appInsightsId: 'canyon-charms-app-insights',
        gameEyeEndpoint: 'https://telemetry.example/v1/game-events',
      }),
      sdkVersion: SDK_VERSION,
    }),
    /Telemetry evidence context is invalid\./,
  );
});

test('telemetry evidence API is explicit, live, non-enumerable and disposable', () => {
  const globalImpl = {};
  let integration = integrationDiagnostics({ phase: 'ready' });
  let delivery = deliveryDiagnostics({
    queueCount: 3,
    lastResult: null,
  });

  const installed = installTelemetryEvidenceApi({
    runtimeManifest: runtimeManifest(),
    sdkVersion: null,
    sessionId: SESSION_ID,
    getIntegrationDiagnostics: () => integration,
    getDeliveryDiagnostics: () => delivery,
    globalImpl,
    search: '?seed=12345&telemetryEvidence=1',
  });

  assert.ok(installed);
  assert.equal(Object.isFrozen(installed), true);
  const descriptor = Object.getOwnPropertyDescriptor(
    globalImpl,
    '__CANYON_TELEMETRY_EVIDENCE__',
  );
  assert.deepEqual({
    configurable: descriptor?.configurable,
    enumerable: descriptor?.enumerable,
    writable: descriptor?.writable,
    type: typeof descriptor?.value,
  }, {
    configurable: true,
    enumerable: false,
    writable: false,
    type: 'function',
  });
  assert.equal(Object.keys(globalImpl).includes('__CANYON_TELEMETRY_EVIDENCE__'), false);
  assert.equal(globalImpl.__CANYON_TELEMETRY_EVIDENCE__().queueCount, 3);

  integration = integrationDiagnostics({
    phase: 'playing',
    events: Object.freeze([
      Object.freeze({ name: 'sdk_ready' }),
      Object.freeze({ name: 'game_start' }),
      Object.freeze({ name: 'level_start' }),
      Object.freeze({ name: 'move_accepted' }),
    ]),
  });
  delivery = deliveryDiagnostics({
    queueCount: 0,
    lastResult: Object.freeze({
      outcome: 'delivered',
      attempts: 2,
      batchSize: 4,
      httpStatus: 202,
    }),
  });
  const live = installed.read();
  assert.equal(live.phase, 'playing');
  assert.equal(live.eventCount, 4);
  assert.equal(live.lastEventName, 'move_accepted');
  assert.equal(live.queueCount, 0);
  assert.equal(live.lastDelivery.attempts, 2);

  installed.destroy();
  installed.destroy();
  assert.equal(Object.hasOwn(globalImpl, '__CANYON_TELEMETRY_EVIDENCE__'), false);
});

test('telemetry evidence API stays absent without opt-in and in production', () => {
  for (const search of ['', '?telemetryEvidence=0', '?sandboxEvidence=1']) {
    const globalImpl = {};
    assert.equal(installTelemetryEvidenceApi({
      runtimeManifest: runtimeManifest(),
      sdkVersion: null,
      sessionId: SESSION_ID,
      getIntegrationDiagnostics: () => integrationDiagnostics(),
      getDeliveryDiagnostics: () => deliveryDiagnostics(),
      globalImpl,
      search,
    }), null);
    assert.equal(Object.hasOwn(globalImpl, '__CANYON_TELEMETRY_EVIDENCE__'), false);
  }

  const globalImpl = {};
  assert.equal(installTelemetryEvidenceApi({
    runtimeManifest: runtimeManifest({
      mode: 'arkadium-prod',
      arkadiumEnvironment: 'PROD',
      gameId: 'canyon-charms-prod',
      analyticsProvider: 'app-insights',
      appInsightsId: 'canyon-charms-app-insights',
      gameEyeEndpoint: 'https://telemetry.example/v1/game-events',
    }),
    sdkVersion: SDK_VERSION,
    sessionId: SESSION_ID,
    getIntegrationDiagnostics: () => integrationDiagnostics(),
    getDeliveryDiagnostics: () => deliveryDiagnostics(),
    globalImpl,
    search: '?telemetryEvidence=1',
  }), null);
  assert.equal(Object.hasOwn(globalImpl, '__CANYON_TELEMETRY_EVIDENCE__'), false);
});

test('unsafe evidence structures fail closed without invoking accessors', () => {
  let reads = 0;
  const unsafeOptions = {};
  Object.defineProperty(unsafeOptions, 'runtimeManifest', {
    enumerable: true,
    get() {
      reads += 1;
      return runtimeManifest();
    },
  });

  assert.throws(
    () => createTelemetryEvidenceSnapshot(unsafeOptions),
    /Telemetry evidence options are invalid\./,
  );
  assert.equal(reads, 0);

  const unsafeManifest = { ...runtimeManifest() };
  Object.defineProperty(unsafeManifest, 'buildSha', {
    enumerable: true,
    get() {
      reads += 1;
      return SHA;
    },
  });
  assert.throws(
    () => snapshot({ runtimeManifest: unsafeManifest }),
    /Telemetry evidence context is invalid\./,
  );
  assert.equal(reads, 0);

  const event = {};
  Object.defineProperty(event, 'name', {
    enumerable: true,
    get() {
      reads += 1;
      return 'sdk_ready';
    },
  });
  assert.throws(
    () => snapshot({
      integrationDiagnostics: integrationDiagnostics({
        events: Object.freeze([event]),
      }),
    }),
    /Telemetry evidence diagnostics are invalid\./,
  );
  assert.equal(reads, 0);
});

test('candidate runtime owns nullable standalone SDK and evidence lifecycle wiring', async () => {
  const source = await readFile(
    new URL('../src/integration/runtime.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /installTelemetryEvidenceApi/);
  assert.match(source, /runtimeManifest\.mode\s*===\s*['"]standalone['"]/);
  assert.match(source, /\?\s*null\s*:\s*EXPECTED_OFFICIAL_SDK_VERSION/);
  assert.match(source, /getIntegrationDiagnostics:\s*\(\)\s*=>\s*integration\.diagnostics\(\)/);
  assert.match(source, /getDeliveryDiagnostics:\s*\(\)\s*=>\s*gameEyeSink\.diagnostics\(\)/);
  assert.match(source, /telemetryEvidenceApi\?\.destroy\(\)/);

  const createSink = source.slice(
    source.indexOf('function createCandidateGameEyeSink'),
    source.indexOf('\n}\n\nfunction instrumentCandidateIntegration'),
  );
  assert.match(createSink, /sdkVersion/);
  assert.doesNotMatch(createSink, /sdkVersion:\s*EXPECTED_OFFICIAL_SDK_VERSION\s*[,}]/);
});
