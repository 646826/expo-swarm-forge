import assert from 'node:assert/strict';
import test from 'node:test';
import { createStandalonePlatformHarness } from '../src/standalone-harness.js';

test('standalone initializes without loading a publisher SDK', async () => {
  const { platform } = createStandalonePlatformHarness({ locale: 'en-US' });
  const initialized = await platform.initialize();
  assert.deepEqual(initialized, {
    ok: true,
    value: {
      userState: 'anonymous',
      locale: 'en-US',
      capabilities: platform.capabilities,
    },
  });
  assert.deepEqual(platform.capabilities, {
    persistence: false,
    analytics: false,
    interstitialAds: false,
    rewardedAds: false,
    wallet: false,
    leaderboards: false,
  });
});

test('lifecycle follows the factory contract exactly', async () => {
  const { platform } = createStandalonePlatformHarness();
  assert.deepEqual(await platform.signalReady(), {
    ok: false,
    error: {
      code: 'INVALID_LIFECYCLE',
      message: 'Lifecycle state new is not valid for this operation.',
      recoverable: false,
    },
  });
  assert.deepEqual(await platform.initialize(), {
    ok: true,
    value: {
      userState: 'anonymous',
      locale: 'en-US',
      capabilities: platform.capabilities,
    },
  });
  assert.deepEqual(await platform.signalReady(), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalGameStart(), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalLevelStart('1'), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalScore(240), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalLevelEnd('1'), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalGameEnd('completed'), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalGameEnd('completed'), {
    ok: false,
    error: {
      code: 'INVALID_LIFECYCLE',
      message: 'Lifecycle state ended is not valid for this operation.',
      recoverable: false,
    },
  });
});

test('unsupported capabilities fail explicitly after initialization', async () => {
  const { platform } = createStandalonePlatformHarness();
  await platform.initialize();
  for (const [operation, capability] of [
    [() => platform.loadSave(), 'persistence'],
    [() => platform.writeSave({ score: 1 }), 'persistence'],
    [() => platform.track({ name: 'game_start' }), 'analytics'],
    [() => platform.showInterstitial('level-end'), 'interstitialAds'],
    [() => platform.showRewarded('extra-moves'), 'rewardedAds'],
    [() => platform.getWalletBalance(), 'wallet'],
    [() => platform.consumeCurrency(1, 'tx-1'), 'wallet'],
    [() => platform.submitLeaderboard({ board: 'score', score: 1 }), 'leaderboards'],
  ]) {
    assert.deepEqual(await operation(), {
      ok: false,
      error: {
        code: 'UNSUPPORTED_CAPABILITY',
        message: `Capability ${capability} is unavailable.`,
        recoverable: true,
      },
    });
  }
});

test('capabilities before initialization report NOT_INITIALIZED', async () => {
  const { platform } = createStandalonePlatformHarness();
  assert.deepEqual(await platform.loadSave(), {
    ok: false,
    error: {
      code: 'NOT_INITIALIZED',
      message: 'Platform has not been initialized.',
      recoverable: true,
    },
  });
});

test('host pause and resume subscriptions unsubscribe cleanly', () => {
  const { platform, pause, resume } = createStandalonePlatformHarness();
  let pauses = 0;
  let resumes = 0;
  const stopPause = platform.onPause(() => { pauses += 1; });
  const stopResume = platform.onResume(() => { resumes += 1; });
  pause();
  resume();
  stopPause();
  stopResume();
  pause();
  resume();
  assert.equal(pauses, 1);
  assert.equal(resumes, 1);
});

test('destroy is idempotent and blocks later operations', async () => {
  const { platform, pause } = createStandalonePlatformHarness();
  let pauses = 0;
  platform.onPause(() => { pauses += 1; });
  await platform.initialize();
  await platform.destroy();
  await platform.destroy();
  pause();
  assert.equal(pauses, 0);
  assert.deepEqual(await platform.signalReady(), {
    ok: false,
    error: {
      code: 'DESTROYED',
      message: 'Platform has been destroyed.',
      recoverable: false,
    },
  });
});

test('invalid gameplay values fail without advancing lifecycle', async () => {
  const { platform } = createStandalonePlatformHarness();
  await platform.initialize();
  await platform.signalReady();
  await platform.signalGameStart();
  const invalidScore = {
    ok: false,
    error: {
      code: 'INVALID_ARGUMENT',
      message: 'Score must be a non-negative safe integer.',
      recoverable: false,
    },
  };
  assert.deepEqual(await platform.signalScore(-1), invalidScore);
  assert.deepEqual(await platform.signalScore(Number.NaN), invalidScore);
  assert.deepEqual(await platform.signalLevelStart(''), {
    ok: false,
    error: {
      code: 'INVALID_ARGUMENT',
      message: 'Level ID must be a non-empty string.',
      recoverable: false,
    },
  });
  assert.deepEqual(await platform.signalGameEnd('  '), {
    ok: false,
    error: {
      code: 'INVALID_ARGUMENT',
      message: 'Game-end reason must be a non-empty string.',
      recoverable: false,
    },
  });
  assert.deepEqual(await platform.signalGameEnd('completed'), { ok: true, value: undefined });
});
