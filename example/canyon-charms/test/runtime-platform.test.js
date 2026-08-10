import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimePlatform } from '../src/platform/runtime-platform.js';

const SHA = '1111111111111111111111111111111111111111';

function manifest(mode, overrides = {}) {
  const publisher = mode !== 'standalone';
  return {
    schemaVersion: 1,
    mode,
    arkadiumEnvironment: publisher ? (mode === 'arkadium-prod' ? 'PROD' : 'DEV') : null,
    gameId: mode === 'arkadium-dev' || mode === 'arkadium-prod' ? 'canyon-charms-live' : null,
    analyticsProvider: mode === 'arkadium-prod' ? 'app-insights' : publisher ? 'console' : 'none',
    appInsightsId: mode === 'arkadium-prod' ? 'canyon-insights-live' : null,
    gameEyeEndpoint: mode === 'arkadium-prod'
      ? 'https://telemetry.example.com/v1/game-events'
      : null,
    gameEyeProject: 'canyon-charms',
    gameVersion: '1.1.0',
    buildSha: SHA,
    ...overrides,
  };
}

test('standalone mode never loads the official Arkadium module', async () => {
  let officialLoads = 0;
  const platform = await createRuntimePlatform(manifest('standalone'), {
    loadOfficialPlatform: async () => {
      officialLoads += 1;
      throw new Error('must not load');
    },
  });

  assert.equal(officialLoads, 0);
  const initialized = await platform.initialize();
  assert.equal(initialized.ok, true);
  assert.equal(initialized.value.userState, 'anonymous');
  assert.equal(initialized.value.locale, 'en-US');
});

test('publisher mode loads one reviewed official factory with the validated manifest', async () => {
  const calls = [];
  const sentinel = Object.freeze({ initialize: async () => ({ ok: true, value: 'official' }) });
  const platform = await createRuntimePlatform(manifest('arkadium-sandbox'), {
    loadOfficialPlatform: async () => ({
      createOfficialPlatform(options) {
        calls.push(options);
        return sentinel;
      },
    }),
  });

  assert.equal(platform, sentinel);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].manifest.mode, 'arkadium-sandbox');
  assert.equal(calls[0].manifest.arkadiumEnvironment, 'DEV');
  assert.equal(Object.isFrozen(calls[0].manifest), true);
});

test('invalid publisher configuration fails before loading the SDK boundary', async () => {
  let officialLoads = 0;
  await assert.rejects(
    () => createRuntimePlatform(manifest('arkadium-prod', { gameId: 'test' }), {
      loadOfficialPlatform: async () => {
        officialLoads += 1;
        return { createOfficialPlatform: () => ({}) };
      },
    }),
    /runtime configuration/i,
  );
  assert.equal(officialLoads, 0);
});

test('official module load failures are redacted and never fall back to standalone', async () => {
  let standaloneCreates = 0;
  await assert.rejects(
    () => createRuntimePlatform(manifest('arkadium-sandbox'), {
      createStandalonePlatform: () => {
        standaloneCreates += 1;
        return {};
      },
      loadOfficialPlatform: async () => {
        throw new Error('credential=do-not-echo');
      },
    }),
    (error) => {
      assert.match(error.message, /official Arkadium platform module/i);
      assert.doesNotMatch(error.message, /credential|do-not-echo/i);
      return true;
    },
  );
  assert.equal(standaloneCreates, 0);
});

test('official factory failures are redacted and never fall back to standalone', async () => {
  let standaloneCreates = 0;
  await assert.rejects(
    () => createRuntimePlatform(manifest('arkadium-dev'), {
      createStandalonePlatform: () => {
        standaloneCreates += 1;
        return {};
      },
      loadOfficialPlatform: async () => ({
        createOfficialPlatform() {
          throw new Error('token=do-not-echo');
        },
      }),
    }),
    (error) => {
      assert.match(error.message, /official Arkadium platform/i);
      assert.doesNotMatch(error.message, /token|do-not-echo/i);
      return true;
    },
  );
  assert.equal(standaloneCreates, 0);
});

test('an invalid official module shape fails closed', async () => {
  await assert.rejects(
    () => createRuntimePlatform(manifest('arkadium-sandbox'), {
      loadOfficialPlatform: async () => ({}),
    }),
    /official Arkadium platform module/i,
  );
});
