import assert from 'node:assert/strict';
import test from 'node:test';

import { createGameSessionController } from '../src/session/controller.js';
import * as platformModule from '../src/platform/platform.js';

const CAPABILITIES = Object.freeze({
  persistence: false,
  analytics: false,
  interstitialAds: false,
  rewardedAds: false,
  wallet: false,
  leaderboards: false,
});

const success = (value = undefined) => ({ ok: true, value });
const failure = (message = 'redacted platform failure') => ({
  ok: false,
  error: { code: 'SDK_FAILURE', message, retryable: false },
});

function recordingPlatform(overrides = {}) {
  const calls = [];
  const pauseHandlers = new Set();
  const resumeHandlers = new Set();
  let destroyed = 0;

  const platform = {
    calls,
    capabilities: CAPABILITIES,
    initialize: async () => {
      calls.push('initialize');
      return success({
        userState: 'anonymous',
        locale: 'en-US',
        capabilities: CAPABILITIES,
      });
    },
    signalReady: async () => {
      calls.push('ready');
      return success();
    },
    signalGameStart: async () => {
      calls.push('game-start');
      return success();
    },
    signalLevelStart: async (levelId) => {
      calls.push(`level-start:${levelId}`);
      return success();
    },
    signalScore: async (score) => {
      calls.push(`score:${score}`);
      return success();
    },
    signalLevelEnd: async (levelId) => {
      calls.push(`level-end:${levelId}`);
      return success();
    },
    signalGameEnd: async (reason) => {
      calls.push(`game-end:${reason}`);
      return success();
    },
    onPause(handler) {
      pauseHandlers.add(handler);
      return () => pauseHandlers.delete(handler);
    },
    onResume(handler) {
      resumeHandlers.add(handler);
      return () => resumeHandlers.delete(handler);
    },
    async destroy() {
      calls.push('destroy');
      destroyed += 1;
    },
    emitHostPause() {
      for (const handler of pauseHandlers) handler();
    },
    emitHostResume() {
      for (const handler of resumeHandlers) handler();
    },
    diagnostics() {
      return {
        pauseHandlers: pauseHandlers.size,
        resumeHandlers: resumeHandlers.size,
        destroyed,
      };
    },
    ...overrides,
  };

  return platform;
}

test('controller emits ordered lifecycle exactly once and never regresses score', async () => {
  const platform = recordingPlatform();
  const controller = createGameSessionController({ platform });

  await Promise.all([controller.boot(), controller.boot()]);
  await Promise.all([controller.startLevel('1'), controller.startLevel('1')]);
  await controller.score(100);
  await controller.score(50);
  await controller.score(100);
  await controller.score(240);
  await Promise.all([
    controller.endLevel('1', 'completed'),
    controller.endLevel('1', 'completed'),
  ]);

  assert.equal(controller.phase, 'ended');
  assert.deepEqual(platform.calls, [
    'initialize',
    'ready',
    'game-start',
    'level-start:1',
    'score:100',
    'score:240',
    'level-end:1',
    'game-end:completed',
  ]);
});

test('host and local pause paths share one idempotent audio and view transition', async () => {
  const platform = recordingPlatform();
  const effects = [];
  const controller = createGameSessionController({
    platform,
    setPaused: (paused) => effects.push(`view:${paused}`),
    suspendAudio: () => effects.push('audio:suspend'),
    resumeAudio: () => effects.push('audio:resume'),
  });

  await controller.boot();
  await controller.startLevel('1');

  platform.emitHostPause();
  platform.emitHostPause();
  await controller.settled();
  assert.equal(controller.phase, 'paused');

  await controller.pause();
  platform.emitHostResume();
  platform.emitHostResume();
  await controller.settled();
  assert.equal(controller.phase, 'playing');

  await controller.resume();
  assert.deepEqual(effects, [
    'view:true',
    'audio:suspend',
    'view:false',
    'audio:resume',
  ]);
});

test('destroy is idempotent and removes host subscriptions', async () => {
  const platform = recordingPlatform();
  const controller = createGameSessionController({ platform });

  await controller.boot();
  assert.deepEqual(platform.diagnostics(), {
    pauseHandlers: 1,
    resumeHandlers: 1,
    destroyed: 0,
  });

  await Promise.all([controller.destroy(), controller.destroy()]);
  assert.equal(controller.phase, 'destroyed');
  assert.deepEqual(platform.diagnostics(), {
    pauseHandlers: 0,
    resumeHandlers: 0,
    destroyed: 1,
  });

  await controller.startLevel('1');
  assert.deepEqual(platform.calls, ['initialize', 'ready', 'destroy']);
});

test('publisher boot failures are critical, stable, and do not signal ready', async () => {
  const platform = recordingPlatform({
    initialize: async () => {
      platform.calls.push('initialize');
      return failure('upstream token=do-not-echo');
    },
  });
  const reports = [];
  const controller = createGameSessionController({
    platform,
    publisherMode: true,
    reportIntegrationError: (message) => reports.push(message),
  });

  const result = await controller.boot();
  assert.equal(result.ok, false);
  assert.equal(controller.phase, 'ended');
  assert.deepEqual(platform.calls, ['initialize']);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /initialize/i);
  assert.doesNotMatch(reports[0], /token|do-not-echo/i);
});

test('guessed global discovery has one explicitly named legacy implementation', () => {
  assert.equal(typeof platformModule.createLegacyCompatibilityPlatform, 'function');
  assert.equal(
    platformModule.createPublisherPlatform,
    platformModule.createLegacyCompatibilityPlatform,
  );
});
