import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createIntegrationDebugModel,
  createIntegrationDebugPanel,
  shouldEnableIntegrationDebug,
} from '../src/integration/debug-panel.js';

const BUILD_SHA = '1111111111111111111111111111111111111111';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

const MANIFEST = Object.freeze({
  schemaVersion: 1,
  mode: 'arkadium-sandbox',
  arkadiumEnvironment: 'DEV',
  gameId: null,
  analyticsProvider: 'console',
  appInsightsId: null,
  gameEyeEndpoint: 'http://127.0.0.1:3001/v1/game-events',
  gameEyeProject: 'canyon-charms',
  gameVersion: '1.1.0',
  buildSha: BUILD_SHA,
});

function fakeDocument() {
  const createNode = (tagName) => ({
    tagName: tagName.toUpperCase(),
    dataset: {},
    children: [],
    textContent: '',
    className: '',
    hidden: false,
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {
      this.removed = true;
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
  });
  return {
    createElement: createNode,
    body: createNode('body'),
  };
}

function collectText(node) {
  return [node.textContent, ...node.children.map(collectText)].filter(Boolean).join(' ');
}

test('debug mode is explicit and unavailable in production', () => {
  assert.equal(shouldEnableIntegrationDebug({
    search: '?integrationDebug=1',
    platformMode: 'arkadium-sandbox',
  }), true);
  assert.equal(shouldEnableIntegrationDebug({
    search: '?seed=1',
    platformMode: 'arkadium-sandbox',
  }), false);
  assert.equal(shouldEnableIntegrationDebug({
    search: '?integrationDebug=1',
    platformMode: 'arkadium-prod',
  }), false);
});

test('debug model contains structural allowlisted fields only', () => {
  const model = createIntegrationDebugModel({
    runtimeManifest: MANIFEST,
    sdkVersion: '2.66.2',
    sessionId: SESSION_ID,
    capabilities: {
      persistence: true,
      analytics: true,
      interstitialAds: false,
      rewardedAds: false,
      wallet: false,
      leaderboards: false,
      credential: 'do-not-echo',
    },
    integrationDiagnostics: {
      phase: 'playing',
      events: [
        { name: 'sdk_ready', properties: { profile: 'do-not-echo' } },
        { name: 'game_start', properties: { savePayload: 'do-not-echo' } },
      ],
      deliveryFailures: [{ requestId: 'do-not-echo' }],
    },
    deliveryDiagnostics: {
      queueCount: 4,
      lastResult: {
        outcome: 'failed',
        attempts: 3,
        batchSize: 4,
        httpStatus: 503,
        responseBody: 'token=do-not-echo',
      },
    },
  });

  assert.deepEqual(model, {
    buildSha: BUILD_SHA,
    gameVersion: '1.1.0',
    platformMode: 'arkadium-sandbox',
    sdkVersion: '2.66.2',
    sessionId: SESSION_ID,
    capabilities: [
      'analytics',
      'persistence',
    ],
    lifecyclePhase: 'playing',
    lifecycleCalls: ['sdk_ready', 'game_start'],
    queueCount: 4,
    lastDelivery: 'failed · attempts 3 · batch 4 · HTTP 503',
  });
  assert.doesNotMatch(
    JSON.stringify(model),
    /credential|profile|savePayload|token|requestId|transactionId|appInsightsId|cookie|do-not-echo/i,
  );
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.capabilities), true);
  assert.equal(Object.isFrozen(model.lifecycleCalls), true);
});

test('debug panel renders with textContent and removes itself cleanly', () => {
  const documentImpl = fakeDocument();
  const panel = createIntegrationDebugPanel({
    documentImpl,
    mount: documentImpl.body,
    search: '?integrationDebug=1',
    runtimeManifest: MANIFEST,
    sdkVersion: '2.66.2',
  });
  assert.ok(panel);
  assert.equal(documentImpl.body.children.length, 1);

  panel.update({
    sessionId: SESSION_ID,
    capabilities: { analytics: true },
    integrationDiagnostics: {
      phase: 'ready',
      events: [{ name: 'sdk_ready', properties: { token: 'do-not-echo' } }],
      deliveryFailures: [],
    },
    deliveryDiagnostics: {
      queueCount: 0,
      lastResult: { outcome: 'delivered', attempts: 1, batchSize: 3, httpStatus: 204 },
    },
  });

  const text = collectText(documentImpl.body.children[0]);
  assert.match(text, /Arkadium integration/);
  assert.match(text, /arkadium-sandbox/);
  assert.match(text, /2\.66\.2/);
  assert.match(text, /sdk_ready/);
  assert.match(text, /delivered/);
  assert.doesNotMatch(text, /token|do-not-echo/i);

  panel.destroy();
  assert.equal(documentImpl.body.children[0].removed, true);
});

test('production mode never mounts the debug panel', () => {
  const documentImpl = fakeDocument();
  const panel = createIntegrationDebugPanel({
    documentImpl,
    mount: documentImpl.body,
    search: '?integrationDebug=1',
    runtimeManifest: { ...MANIFEST, mode: 'arkadium-prod', arkadiumEnvironment: 'PROD' },
    sdkVersion: '2.66.2',
  });
  assert.equal(panel, null);
  assert.equal(documentImpl.body.children.length, 0);
});

test('candidate runtime wires Game Eye and the debug panel without changing standalone main', async () => {
  const [runtimeSource, html, mainSource] = await Promise.all([
    readFile(new URL('../src/integration/runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  ]);

  assert.match(runtimeSource, /createGameEyeSink/);
  assert.match(runtimeSource, /createIntegrationDebugPanel/);
  assert.match(runtimeSource, /runtimeManifest\.gameEyeEndpoint/);
  assert.match(runtimeSource, /sinks:/);
  assert.match(runtimeSource, /flushOnUnload|destroy/);
  assert.match(html, /integration-debug\.css/);
  assert.doesNotMatch(mainSource, /gameEyeEndpoint|sendBeacon|integrationDebug/);
});
