import assert from 'node:assert/strict';
import test from 'node:test';

import { createCanyonIntegration } from '../src/integration/runtime.js';

const CAPABILITIES = Object.freeze({
  persistence: false,
  analytics: false,
  interstitialAds: false,
  rewardedAds: false,
  wallet: false,
  leaderboards: false,
});
const ok = (value = undefined) => ({ ok: true, value });

function recordingPlatform(overrides = {}) {
  const calls = [];
  const pauseHandlers = new Set();
  const resumeHandlers = new Set();
  return {
    calls,
    capabilities: CAPABILITIES,
    initialize: async () => {
      calls.push('initialize');
      return ok({
        userState: 'anonymous',
        locale: 'en-US',
        capabilities: CAPABILITIES,
      });
    },
    signalReady: async () => { calls.push('ready'); return ok(); },
    signalGameStart: async () => { calls.push('game-start'); return ok(); },
    signalLevelStart: async (id) => { calls.push(`level-start:${id}`); return ok(); },
    signalScore: async (score) => { calls.push(`score:${score}`); return ok(); },
    signalLevelEnd: async (id) => { calls.push(`level-end:${id}`); return ok(); },
    signalGameEnd: async (reason) => { calls.push(`game-end:${reason}`); return ok(); },
    onPause(handler) { pauseHandlers.add(handler); return () => pauseHandlers.delete(handler); },
    onResume(handler) { resumeHandlers.add(handler); return () => resumeHandlers.delete(handler); },
    emitPause() { for (const handler of pauseHandlers) handler(); },
    emitResume() { for (const handler of resumeHandlers) handler(); },
    async destroy() { calls.push('destroy'); },
    ...overrides,
  };
}

function deterministicIds() {
  let index = 0;
  return () => `11111111-2222-4333-8444-${String(555555555555 + index++).padStart(12, '0')}`;
}

function integration(platform, options = {}) {
  return createCanyonIntegration({
    platform,
    platformMode: 'standalone',
    now: () => '2026-08-10T12:00:00.000Z',
    createId: deterministicIds(),
    ...options,
  });
}

test('runtime emits one ordered canonical stream for a complete game session', async () => {
  const platform = recordingPlatform();
  const runtime = integration(platform);

  await runtime.boot();
  await runtime.startLevel('1');
  await runtime.moveRejected({ reason: 'no-match', movesRemaining: 20 });
  await runtime.moveAccepted({
    scoreDelta: 240,
    combo: 1,
    movesRemaining: 19,
    totalScore: 240,
  });
  await runtime.pause('player');
  await runtime.resume('player');
  await runtime.complete({
    levelId: '1',
    result: 'won',
    reason: 'completed',
    score: 5240,
    movesRemaining: 3,
  });

  assert.deepEqual(platform.calls, [
    'initialize',
    'ready',
    'game-start',
    'level-start:1',
    'score:240',
    'level-end:1',
    'game-end:completed',
  ]);

  const diagnostics = runtime.diagnostics();
  assert.deepEqual(diagnostics.events.map((event) => event.name), [
    'sdk_initialize_started',
    'sdk_initialize_succeeded',
    'sdk_ready',
    'game_start',
    'level_start',
    'move_rejected',
    'move_accepted',
    'score_changed',
    'pause',
    'resume',
    'level_end',
    'game_end',
  ]);
  assert.deepEqual(diagnostics.events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(diagnostics.events[6].properties, {
    scoreDelta: 240,
    combo: 1,
    movesRemaining: 19,
  });
  assert.deepEqual(diagnostics.events[10].properties, {
    levelId: '1',
    result: 'won',
    score: 5240,
    movesRemaining: 3,
  });
});

test('duplicate UI operations do not duplicate lifecycle or canonical events', async () => {
  const platform = recordingPlatform();
  const runtime = integration(platform);

  await Promise.all([runtime.boot(), runtime.boot()]);
  await Promise.all([runtime.startLevel('1'), runtime.startLevel('1')]);
  await Promise.all([runtime.pause('player'), runtime.pause('player')]);
  await Promise.all([runtime.resume('player'), runtime.resume('player')]);
  await Promise.all([
    runtime.complete({ levelId: '1', result: 'lost', reason: 'lost', score: 200, movesRemaining: 0 }),
    runtime.complete({ levelId: '1', result: 'lost', reason: 'lost', score: 200, movesRemaining: 0 }),
  ]);

  const names = runtime.diagnostics().events.map((event) => event.name);
  for (const name of [
    'sdk_initialize_started',
    'sdk_initialize_succeeded',
    'sdk_ready',
    'game_start',
    'level_start',
    'pause',
    'resume',
    'level_end',
    'game_end',
  ]) {
    assert.equal(names.filter((candidate) => candidate === name).length, 1, name);
  }
});

test('host pause and resume use the same runtime path with host source', async () => {
  const platform = recordingPlatform();
  const effects = [];
  const runtime = integration(platform, {
    setPaused: (paused) => effects.push(`view:${paused}`),
    suspendAudio: () => effects.push('audio:suspend'),
    resumeAudio: () => effects.push('audio:resume'),
  });

  await runtime.boot();
  await runtime.startLevel('1');
  platform.emitPause();
  platform.emitResume();
  await runtime.settled();

  const pauseEvents = runtime.diagnostics().events.filter(
    (event) => event.name === 'pause' || event.name === 'resume',
  );
  assert.deepEqual(pauseEvents.map((event) => event.properties.source), ['host', 'host']);
  assert.deepEqual(effects, ['view:true', 'audio:suspend', 'view:false', 'audio:resume']);
});

test('publisher failures emit a stable integration_error without upstream data', async () => {
  const platform = recordingPlatform({
    initialize: async () => ({
      ok: false,
      error: { code: 'SDK_FAILURE', message: 'credential=do-not-echo', retryable: false },
    }),
  });
  const reports = [];
  const runtime = integration(platform, {
    publisherMode: true,
    reportIntegrationError: (message) => reports.push(message),
  });

  const result = await runtime.boot();
  assert.equal(result.ok, false);
  const diagnostics = runtime.diagnostics();
  assert.deepEqual(diagnostics.events.map((event) => event.name), [
    'sdk_initialize_started',
    'integration_error',
  ]);
  assert.deepEqual(diagnostics.events[1].properties, {
    stage: 'initialize',
    code: 'PUBLISHER_INTEGRATION_FAILED',
  });
  assert.doesNotMatch(JSON.stringify({ diagnostics, reports }), /credential|do-not-echo/i);
});
