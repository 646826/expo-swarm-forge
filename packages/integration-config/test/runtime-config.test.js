import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runtimeManifestFromEnv,
  validateRuntimeManifest,
} from '../src/index.js';

const SHA = '709a1556fda3fa7a1506d46ec704cc654308775b';

const standalone = {
  schemaVersion: 1,
  mode: 'standalone',
  arkadiumEnvironment: null,
  gameId: null,
  analyticsProvider: 'none',
  appInsightsId: null,
  gameEyeEndpoint: null,
  gameEyeProject: 'canyon-charms',
  gameVersion: '1.0.0',
  buildSha: SHA,
};

test('standalone accepts only public standalone fields', () => {
  assert.equal(validateRuntimeManifest(standalone).mode, 'standalone');
  assert.throws(
    () => validateRuntimeManifest({ ...standalone, password: 'secret' }),
    /Unknown runtime field/,
  );
});

test('sandbox requires DEV and console analytics', () => {
  const value = validateRuntimeManifest({
    ...standalone,
    mode: 'arkadium-sandbox',
    arkadiumEnvironment: 'DEV',
    analyticsProvider: 'console',
    gameEyeEndpoint: 'http://127.0.0.1:3001/v1/game-events',
  });
  assert.equal(value.analyticsProvider, 'console');
});

test('production rejects placeholders and non-HTTPS telemetry', () => {
  assert.throws(
    () => validateRuntimeManifest({
      ...standalone,
      mode: 'arkadium-prod',
      arkadiumEnvironment: 'PROD',
      gameId: 'demo',
      analyticsProvider: 'app-insights',
      appInsightsId: 'changeme',
      gameEyeEndpoint: 'http://example.com/v1/game-events',
    }),
    /configuration/,
  );
});

test('development rejects placeholder identifiers', () => {
  assert.throws(
    () => validateRuntimeManifest({
      ...standalone,
      mode: 'arkadium-dev',
      arkadiumEnvironment: 'DEV',
      gameId: 'test',
      analyticsProvider: 'console',
    }),
    /configuration/,
  );
});

test('environment conversion never serializes credentials', () => {
  const manifest = runtimeManifestFromEnv({
    GAME_MODE: 'standalone',
    GAME_VERSION: '1.0.0',
    BUILD_SHA: SHA,
    ARKADIUM_DEV_PASSWORD: 'secret',
  });
  assert.equal(JSON.stringify(manifest).includes('secret'), false);
});

test('accessors and symbol keys are rejected without invoking getters', () => {
  let invoked = false;
  const input = { ...standalone };
  Object.defineProperty(input, 'gameId', {
    enumerable: true,
    get() {
      invoked = true;
      return 'real-id';
    },
  });
  assert.throws(() => validateRuntimeManifest(input), /plain data properties/);
  assert.equal(invoked, false);

  const symbolInput = { ...standalone, [Symbol('secret')]: 'value' };
  assert.throws(() => validateRuntimeManifest(symbolInput), /symbol/);
});

test('errors do not echo rejected identifier values', () => {
  const sensitive = 'sensitive-production-identifier';
  assert.throws(
    () => validateRuntimeManifest({
      ...standalone,
      mode: 'arkadium-prod',
      arkadiumEnvironment: 'PROD',
      gameId: sensitive,
      analyticsProvider: 'app-insights',
      appInsightsId: 'real-app-id',
      gameEyeEndpoint: 'https://telemetry.example.com/not-game-events',
    }),
    (error) => {
      assert.equal(String(error).includes(sensitive), false);
      return true;
    },
  );
});
