import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createOfficialPlatformWithDependencies } from '../src/platform/official-platform-core.js';

const SHA = '1111111111111111111111111111111111111111';

function manifest(mode = 'arkadium-sandbox', overrides = {}) {
  return {
    schemaVersion: 1,
    mode,
    arkadiumEnvironment: mode === 'arkadium-prod' ? 'PROD' : 'DEV',
    gameId: mode === 'arkadium-dev' || mode === 'arkadium-prod' ? 'canyon-charms-live' : null,
    analyticsProvider: mode === 'arkadium-prod' ? 'app-insights' : 'console',
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

function dependencies({ sdkVersion = '2.66.2' } = {}) {
  const bridgeOptions = [];
  const platformInputs = [];

  class Bridge {
    constructor(options) {
      bridgeOptions.push(options);
      this.options = options;
      this.capabilities = Object.freeze({
        persistence: false,
        analytics: false,
        interstitialAds: false,
        rewardedAds: false,
        wallet: false,
        leaderboards: false,
      });
    }
  }

  class Platform {
    constructor(bridge, options) {
      platformInputs.push({ bridge, options });
      this.bridge = bridge;
      this.options = options;
    }
  }

  return {
    dependencies: {
      OfficialArkadiumSdkBridge: Bridge,
      ArkadiumPublisherPlatform: Platform,
      officialSdkVersion: sdkVersion,
    },
    bridgeOptions,
    platformInputs,
  };
}

test('factory creates one reviewed bridge and publisher wrapper for Sandbox DEV', () => {
  const fixture = dependencies();
  const platform = createOfficialPlatformWithDependencies(
    { manifest: manifest() },
    fixture.dependencies,
  );

  assert.equal(fixture.bridgeOptions.length, 1);
  assert.deepEqual(fixture.bridgeOptions[0], {
    environment: 'DEV',
    fallbackLocale: 'en-US',
    levelNumberForId: fixture.bridgeOptions[0].levelNumberForId,
  });
  assert.equal(fixture.bridgeOptions[0].levelNumberForId('1'), 1);
  assert.equal(fixture.bridgeOptions[0].levelNumberForId('42'), 42);
  assert.throws(() => fixture.bridgeOptions[0].levelNumberForId('zero'), /level/i);

  assert.equal(fixture.platformInputs.length, 1);
  assert.equal(fixture.platformInputs[0].bridge, platform.bridge);
  assert.deepEqual(fixture.platformInputs[0].options, { saveLimitBytes: 262_144 });
});

test('factory maps production manifest to the PROD official environment', () => {
  const fixture = dependencies();
  createOfficialPlatformWithDependencies(
    { manifest: manifest('arkadium-prod') },
    fixture.dependencies,
  );
  assert.equal(fixture.bridgeOptions[0].environment, 'PROD');
});

test('factory does not manufacture optional service policies or capabilities', () => {
  const fixture = dependencies();
  const platform = createOfficialPlatformWithDependencies(
    { manifest: manifest('arkadium-dev') },
    fixture.dependencies,
  );
  const options = fixture.bridgeOptions[0];
  for (const key of [
    'persistencePolicy',
    'advertisingPolicy',
    'analyticsPolicy',
    'leaderboardPolicy',
    'walletPolicy',
    'rpcDiagnosticsPolicy',
  ]) {
    assert.equal(key in options, false, key);
  }
  assert.deepEqual(platform.bridge.capabilities, {
    persistence: false,
    analytics: false,
    interstitialAds: false,
    rewardedAds: false,
    wallet: false,
    leaderboards: false,
  });
});

test('factory rejects standalone mode before constructing official objects', () => {
  const fixture = dependencies();
  assert.throws(
    () => createOfficialPlatformWithDependencies(
      { manifest: manifest('standalone', {
        arkadiumEnvironment: null,
        analyticsProvider: 'none',
      }) },
      fixture.dependencies,
    ),
    /publisher mode/i,
  );
  assert.equal(fixture.bridgeOptions.length, 0);
  assert.equal(fixture.platformInputs.length, 0);
});

test('factory fails closed when the vendored SDK version drifts', () => {
  const fixture = dependencies({ sdkVersion: '2.66.3' });
  assert.throws(
    () => createOfficialPlatformWithDependencies(
      { manifest: manifest() },
      fixture.dependencies,
    ),
    /version/i,
  );
  assert.equal(fixture.bridgeOptions.length, 0);
});

test('constructor failures are redacted', () => {
  const fixture = dependencies();
  fixture.dependencies.OfficialArkadiumSdkBridge = class {
    constructor() {
      throw new Error('credential=do-not-echo');
    }
  };
  assert.throws(
    () => createOfficialPlatformWithDependencies(
      { manifest: manifest() },
      fixture.dependencies,
    ),
    (error) => {
      assert.match(error.message, /official Arkadium platform/i);
      assert.doesNotMatch(error.message, /credential|do-not-echo/i);
      return true;
    },
  );
});

test('runtime wrapper imports only the reviewed vendored package root', async () => {
  const source = await readFile(new URL('../src/platform/official-platform.ts', import.meta.url), 'utf8');
  assert.match(source, /vendor\/arkadium-platform\/source\/packages\/platform-arkadium\/src\/index\.ts/);
  assert.match(source, /OfficialArkadiumSdkBridge/);
  assert.match(source, /ArkadiumPublisherPlatform/);
  assert.match(source, /OFFICIAL_ARKADIUM_SDK_VERSION/);
  assert.doesNotMatch(source, /@arkadiuminc\/sdk\//);
  assert.doesNotMatch(source, /new Proxy|globalThis\.Arkadium|publisherPlatform/);
});
