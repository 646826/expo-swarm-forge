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

test('lifecycle requires initialization and becomes available afterward', async () => {
  const { platform } = createStandalonePlatformHarness();
  assert.deepEqual(await platform.signalReady(), {
    ok: false,
    error: {
      code: 'NOT_INITIALIZED',
      message: 'Publisher platform is not initialized.',
    },
  });
  await platform.initialize();
  assert.deepEqual(await platform.signalReady(), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalGameStart(), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalLevelStart('1'), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalScore(240), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalLevelEnd('1'), { ok: true, value: undefined });
  assert.deepEqual(await platform.signalGameEnd('completed'), { ok: true, value: undefined });
});

test('unsupported capabilities fail explicitly', async () => {
  const { platform } = createStandalonePlatformHarness();
  await platform.initialize();
  const expected = {
    ok: false,
    error: {
      code: 'UNSUPPORTED_CAPABILITY',
      message: 'Publisher capability is not available.',
    },
  };
  assert.deepEqual(await platform.loadSave(), expected);
  assert.deepEqual(await platform.writeSave({ score: 1 }), expected);
  assert.deepEqual(await platform.track({ name: 'game_start' }), expected);
  assert.deepEqual(await platform.showInterstitial('level-end'), expected);
  assert.deepEqual(await platform.showRewarded('extra-moves'), expected);
  assert.deepEqual(await platform.getWalletBalance(), expected);
  assert.deepEqual(await platform.consumeCurrency(1, 'tx-1'), expected);
  assert.deepEqual(await platform.submitLeaderboard({ board: 'score', score: 1 }), expected);
});

test('host pause and resume subscriptions unsubscribe cleanly', async () => {
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
      code: 'PLATFORM_DESTROYED',
      message: 'Publisher platform has been destroyed.',
    },
  });
});

test('invalid score and level values fail before lifecycle success', async () => {
  const { platform } = createStandalonePlatformHarness();
  await platform.initialize();
  const invalid = {
    ok: false,
    error: {
      code: 'INVALID_ARGUMENT',
      message: 'Publisher operation received an invalid argument.',
    },
  };
  assert.deepEqual(await platform.signalScore(-1), invalid);
  assert.deepEqual(await platform.signalScore(Number.NaN), invalid);
  assert.deepEqual(await platform.signalLevelStart(''), invalid);
  assert.deepEqual(await platform.signalGameEnd('  '), invalid);
});
