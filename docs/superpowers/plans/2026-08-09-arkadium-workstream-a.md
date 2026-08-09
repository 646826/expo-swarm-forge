# Arkadium Publisher Integration Workstream A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, exact-version Arkadium publisher integration foundation to `expo-swarm-forge` while preserving standalone play and keeping every independently useful slice mergeable into `main`.

**Architecture:** Deterministic game rules remain publisher-neutral. A strict public runtime manifest selects `standalone`, `arkadium-sandbox`, `arkadium-dev`, or `arkadium-prod`; a typed `PublisherPlatform` boundary and explicit session controller own lifecycle ordering. The official adapter is imported from a deterministic snapshot of `arkadium-game-factory`, bundled only for Arkadium builds with the exact `@arkadiuminc/sdk` version, and verified independently from Game Eye telemetry.

**Tech Stack:** Node.js 22.23 or newer, browser ESM, JavaScript with JSDoc plus `.d.ts` declarations, Node `node:test`, TypeScript 6.0.3 for the vendored adapter, Vite 8.1.5 for Arkadium-mode bundles, exact `@arkadiuminc/sdk` 2.66.2, GitHub Actions, headless Chrome.

## Global Constraints

- Every task lands as its own pull request and is squash-merged after fresh CI.
- `main` remains playable and `npm run verify` passes after every merge.
- `example/canyon-charms/src/core/` is unchanged unless a failing test proves a real rule defect.
- Publisher modes never discover or guess global method names.
- Standalone mode never loads the official Arkadium SDK.
- The SDK dependency is exactly `2.66.2`; floating ranges are forbidden.
- No credential, DEV login, App Insights secret, profile, save payload, cookie, wallet transaction identifier, or raw SDK error enters source, browser manifests, logs, telemetry, or evidence.
- DEV and PROD reject publisher identifiers equal to `demo`, `test`, `changeme`, `none`, `null`, empty strings, or all-zero values.
- Mocks prove contract behavior only and never satisfy Sandbox, DEV, or release evidence tiers.
- The existing advertising endpoint `/imp` remains unchanged.

---

### Task 1: Strict Public Runtime Manifest

**PR title:** `feat: add strict Arkadium runtime configuration`

**Files:**
- Create: `packages/integration-config/src/index.js`
- Create: `packages/integration-config/src/index.d.ts`
- Create: `packages/integration-config/test/runtime-config.test.js`
- Create: `config/runtime.standalone.json`
- Create: `config/runtime.sandbox.example.json`
- Modify: `README.md`

**Interfaces:**
- `validateRuntimeManifest(input): PublicRuntimeManifest`
- `runtimeManifestFromEnv(env): PublicRuntimeManifest`
- `PLATFORM_MODES`
- `ANALYTICS_PROVIDERS`

- [ ] **Step 1: Write the failing tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeManifestFromEnv, validateRuntimeManifest } from '../src/index.js';

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
  assert.throws(() => validateRuntimeManifest({ ...standalone, password: 'secret' }), /Unknown runtime field/);
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
  assert.throws(() => validateRuntimeManifest({
    ...standalone,
    mode: 'arkadium-prod',
    arkadiumEnvironment: 'PROD',
    gameId: 'demo',
    analyticsProvider: 'app-insights',
    appInsightsId: 'changeme',
    gameEyeEndpoint: 'http://example.com/v1/game-events',
  }), /configuration/);
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
```

- [ ] **Step 2: Run RED**

```bash
node --test packages/integration-config/test/runtime-config.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement validation**

```js
export const PLATFORM_MODES = Object.freeze([
  'standalone', 'arkadium-sandbox', 'arkadium-dev', 'arkadium-prod',
]);
export const ANALYTICS_PROVIDERS = Object.freeze(['none', 'console', 'app-insights']);

const SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLACEHOLDER = /^(?:demo|test|changeme|none|null|0+)$/i;
const ALLOWED_KEYS = new Set([
  'schemaVersion', 'mode', 'arkadiumEnvironment', 'gameId', 'analyticsProvider',
  'appInsightsId', 'gameEyeEndpoint', 'gameEyeProject', 'gameVersion', 'buildSha',
]);
```

`validateRuntimeManifest` rejects non-plain objects, accessors, symbol keys, unknown fields, invalid enums, invalid SHA/SemVer, unsafe URLs, mode/environment mismatches, and DEV/PROD placeholders. Error messages name the invalid field but never echo its value. `runtimeManifestFromEnv` reads only allowlisted public environment keys.

- [ ] **Step 4: Add declarations and examples**

`index.d.ts` declares the exact `PublicRuntimeManifest` union from the approved design. The standalone example uses build SHA `709a1556fda3fa7a1506d46ec704cc654308775b`; the Sandbox example uses `DEV`, Console analytics, no App Insights ID, and `http://127.0.0.1:3001/v1/game-events`.

- [ ] **Step 5: Verify GREEN**

```bash
node --test packages/integration-config/test/runtime-config.test.js
npm run verify
```

- [ ] **Step 6: Commit and merge**

```bash
git add packages/integration-config config README.md
git commit -m "feat: add strict Arkadium runtime configuration"
```

---

### Task 2: Typed Publisher Platform Boundary

**PR title:** `feat: add typed publisher platform boundary`

**Files:**
- Create: `packages/publisher-platform/src/index.js`
- Create: `packages/publisher-platform/src/index.d.ts`
- Create: `packages/publisher-platform/src/standalone.js`
- Create: `packages/publisher-platform/src/standalone-harness.js`
- Create: `packages/publisher-platform/test/standalone.test.js`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- `ok(value)` and `failure(code, message)`
- `NO_CAPABILITIES`
- `createStandalonePublisherPlatform(options)`
- `createStandalonePlatformHarness(options)` for tests only

- [ ] **Step 1: Write the failing tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStandalonePlatformHarness } from '../src/standalone-harness.js';

test('standalone initializes without an SDK', async () => {
  const { platform } = createStandalonePlatformHarness({ locale: 'en-US' });
  const initialized = await platform.initialize();
  assert.equal(initialized.ok, true);
  assert.equal(initialized.value.userState, 'anonymous');
  assert.deepEqual(platform.capabilities, {
    persistence: false,
    analytics: false,
    interstitialAds: false,
    rewardedAds: false,
    wallet: false,
    leaderboards: false,
  });
});

test('subscriptions unsubscribe and destroy is idempotent', async () => {
  const { platform, pause } = createStandalonePlatformHarness();
  let calls = 0;
  const unsubscribe = platform.onPause(() => { calls += 1; });
  pause();
  unsubscribe();
  pause();
  await platform.destroy();
  await platform.destroy();
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test packages/publisher-platform/test/standalone.test.js
```

- [ ] **Step 3: Implement the result and capability primitives**

```js
export const NO_CAPABILITIES = Object.freeze({
  persistence: false,
  analytics: false,
  interstitialAds: false,
  rewardedAds: false,
  wallet: false,
  leaderboards: false,
});
export const ok = (value) => Object.freeze({ ok: true, value });
export const failure = (code, message) => Object.freeze({
  ok: false,
  error: Object.freeze({ code, message }),
});
```

The standalone adapter implements every approved contract method. Lifecycle methods return `ok(undefined)`. Unsupported persistence, analytics, ads, wallet, and leaderboard calls return `UNSUPPORTED_CAPABILITY`. `destroy()` is idempotent and clears subscriptions.

- [ ] **Step 4: Verify**

```bash
node --test packages/publisher-platform/test/standalone.test.js
npm run verify
```

- [ ] **Step 5: Commit and merge**

```bash
git add packages/publisher-platform docs/ARCHITECTURE.md
git commit -m "feat: add typed publisher platform boundary"
```

---

### Task 3: Deterministic Factory Snapshot Tooling

**PR title:** `build: add Arkadium adapter snapshot verification`

**Files:**
- Create: `scripts/arkadium-snapshot-lib.mjs`
- Create: `scripts/sync-arkadium-snapshot.mjs`
- Create: `scripts/verify-arkadium-snapshot.mjs`
- Create: `test/arkadium-snapshot.test.js`
- Create: `vendor/arkadium-platform/README.md`
- Modify: `package.json`
- Modify: `scripts/verify.mjs`

**Interfaces:**
- `npm run arkadium:sync -- --source ../arkadium-game-factory`
- `npm run arkadium:verify-snapshot`
- `syncSnapshot(options)` and `verifySnapshot(destination)`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncSnapshot, verifySnapshot } from '../scripts/arkadium-snapshot-lib.mjs';

test('snapshot records exact source commit and hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkadium-snapshot-'));
  const source = join(root, 'source');
  const destination = join(root, 'vendor');
  await mkdir(join(source, 'packages/platform-contract/src'), { recursive: true });
  await writeFile(join(source, 'packages/platform-contract/src/index.ts'), 'export const x = 1;\n');
  const manifest = await syncSnapshot({
    source,
    destination,
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    roots: ['packages/platform-contract/src'],
  });
  assert.equal(manifest.sourceCommit, '0123456789abcdef0123456789abcdef01234567');
  assert.equal((await verifySnapshot(destination)).ok, true);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test test/arkadium-snapshot.test.js
```

- [ ] **Step 3: Implement allowlisted copying and hashing**

```js
const SNAPSHOT_ROOTS = Object.freeze([
  'packages/platform-contract/src',
  'packages/platform-arkadium/src',
  'packages/platform-arkadium/sdk',
  'packages/platform-arkadium/package.json',
]);
```

The CLI obtains the source commit with `git -C ../arkadium-game-factory rev-parse HEAD`, rejects a dirty source checkout, copies only the roots above, records lowercase SHA-256 values, and records SDK version `2.66.2`. Verification rejects missing, modified, or extra files and a package/manifest SDK mismatch.

- [ ] **Step 4: Wire commands into verification**

```json
{
  "scripts": {
    "arkadium:sync": "node scripts/sync-arkadium-snapshot.mjs",
    "arkadium:verify-snapshot": "node scripts/verify-arkadium-snapshot.mjs"
  }
}
```

`scripts/verify.mjs` runs snapshot verification only when `vendor/arkadium-platform/manifest.json` exists, so the tooling can merge before the snapshot.

- [ ] **Step 5: Verify and merge**

```bash
node --test test/arkadium-snapshot.test.js
npm run verify
```

---

### Task 4: Import the Reviewed Adapter and Exact Dependency Lock

**PR title:** `build: vendor reviewed Arkadium adapter snapshot`

**Files:**
- Create: `vendor/arkadium-platform/manifest.json`
- Create: files under `vendor/arkadium-platform/source/`
- Create: `vendor/arkadium-platform/LICENSES.md`
- Modify: `package.json`
- Create: `package-lock.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Synchronize from a clean factory checkout**

```bash
npm run arkadium:sync -- --source ../arkadium-game-factory
```

The command writes the actual `git rev-parse HEAD` commit and actual SHA-256 digests into the manifest. No commit or hash is hand-edited.

- [ ] **Step 2: Pin and lock exact packages**

```json
{
  "dependencies": { "@arkadiuminc/sdk": "2.66.2" },
  "devDependencies": { "typescript": "6.0.3", "vite": "8.1.5" }
}
```

```bash
npm install --package-lock-only
npm ci
```

- [ ] **Step 3: Update CI**

```yaml
- name: Install exact dependencies
  run: npm ci
```

- [ ] **Step 4: Verify**

```bash
npm run arkadium:verify-snapshot
npm run verify
```

- [ ] **Step 5: Commit and merge**

```bash
git add vendor package.json package-lock.json .github/workflows/ci.yml
git commit -m "build: vendor reviewed Arkadium adapter snapshot"
```

---

### Task 5: Exactly-Once Game Session Controller

**PR title:** `feat: add publisher-aware Canyon Charms session controller`

**Files:**
- Create: `example/canyon-charms/src/session/controller.js`
- Create: `example/canyon-charms/test/session-controller.test.js`
- Modify: `example/canyon-charms/src/platform/platform.js`

**Interface:** `createGameSessionController({ platform, setPaused, suspendAudio, resumeAudio, reportIntegrationError })` returning `boot`, `startLevel`, `score`, `pause`, `resume`, `endLevel`, `destroy`, and read-only `phase`.

- [ ] **Step 1: Write the failing lifecycle test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameSessionController } from '../src/session/controller.js';

function recordingPlatform() {
  const calls = [];
  const capabilities = Object.freeze({
    persistence: false, analytics: false, interstitialAds: false,
    rewardedAds: false, wallet: false, leaderboards: false,
  });
  return {
    calls,
    capabilities,
    initialize: async () => ({ ok: true, value: { userState: 'anonymous', locale: 'en-US', capabilities } }),
    signalReady: async () => { calls.push('ready'); return { ok: true, value: undefined }; },
    signalGameStart: async () => { calls.push('game-start'); return { ok: true, value: undefined }; },
    signalLevelStart: async (id) => { calls.push(`level-start:${id}`); return { ok: true, value: undefined }; },
    signalScore: async (score) => { calls.push(`score:${score}`); return { ok: true, value: undefined }; },
    signalLevelEnd: async (id) => { calls.push(`level-end:${id}`); return { ok: true, value: undefined }; },
    signalGameEnd: async (reason) => { calls.push(`game-end:${reason}`); return { ok: true, value: undefined }; },
    onPause: () => () => {}, onResume: () => () => {}, destroy: async () => {},
  };
}

test('controller emits ordered lifecycle exactly once', async () => {
  const platform = recordingPlatform();
  const controller = createGameSessionController({ platform });
  await controller.boot();
  await controller.boot();
  await controller.startLevel('1');
  await controller.startLevel('1');
  await controller.score(100);
  await controller.score(50);
  await controller.endLevel('1', 'completed');
  await controller.endLevel('1', 'completed');
  assert.deepEqual(platform.calls, [
    'ready', 'game-start', 'level-start:1', 'score:100', 'level-end:1', 'game-end:completed',
  ]);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test example/canyon-charms/test/session-controller.test.js
```

- [ ] **Step 3: Implement the state machine**

```js
const PHASES = Object.freeze({
  NEW: 'new', INITIALIZING: 'initializing', READY: 'ready',
  PLAYING: 'playing', PAUSED: 'paused', ENDED: 'ended', DESTROYED: 'destroyed',
});
```

Operations are serialized through one promise chain. Ready, game-start, level-start, level-end, and game-end are deduplicated. Scores never regress. Host pause/resume subscriptions are registered once. `destroy()` is idempotent. Publisher-mode initialization and ready failures are boot-critical and redacted.

- [ ] **Step 4: Isolate legacy compatibility**

`platform.js` exposes guessed-global behavior only as `createLegacyCompatibilityPlatform()`. Publisher modes cannot select it.

- [ ] **Step 5: Verify and merge**

```bash
node --test example/canyon-charms/test/session-controller.test.js
npm run verify
```

---

### Task 6: Canonical Events and UI Wiring

**PR title:** `feat: route Canyon Charms through canonical integration events`

**Files:**
- Create: `packages/game-events/src/catalog.js`
- Create: `packages/game-events/src/dispatcher.js`
- Create: `packages/game-events/src/index.d.ts`
- Create: `packages/game-events/test/events.test.js`
- Modify: `example/canyon-charms/src/main.js`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- `createCanonicalEventFactory({ now, createId })`
- `validateCanonicalEvent(event)`
- `createEventDispatcher(sinks)`

- [ ] **Step 1: Write failing schema tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalEventFactory, validateCanonicalEvent } from '../src/catalog.js';

test('events have ordered sequence and reviewed properties', () => {
  const createEvent = createCanonicalEventFactory({
    now: () => '2026-08-09T20:00:00.000Z',
    createId: () => '11111111-2222-4333-8444-555555555555',
  });
  const first = createEvent('game_start', { levelId: '1' });
  const second = createEvent('move_accepted', { scoreDelta: 240, combo: 1 });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(validateCanonicalEvent(second).name, 'move_accepted');
  assert.throws(() => createEvent('game_start', { token: 'secret' }), /property/);
});
```

- [ ] **Step 2: Implement the allowlisted catalog**

Include the exact names approved in the design. Each entry defines permitted primitive properties, bounds, Arkadium routing, Game Eye routing, PROD permission, and sampling permission. Unknown events, sensitive property names, oversized strings, and non-finite numbers fail before dispatch.

- [ ] **Step 3: Wire `main.js` through the controller**

Remove direct calls to `started`, `submitScore`, `completed`, and free-form `track`. UI actions call the session controller; controller/game facts produce one canonical event each. Rendering and deterministic state transitions remain unchanged.

- [ ] **Step 4: Extend Chrome evidence**

CI boots a deterministic test route and asserts an ordered structural lifecycle prefix without storing payload values.

- [ ] **Step 5: Verify and merge**

```bash
node --test packages/game-events/test/events.test.js example/canyon-charms/test/session-controller.test.js
npm run verify
```

---

### Task 7: Exact Official SDK Sandbox Bundle

**PR title:** `feat: build Canyon Charms with the official Arkadium SDK`

**Files:**
- Create: `example/canyon-charms/vite.config.ts`
- Create: `example/canyon-charms/src/platform/runtime-platform.js`
- Create: `example/canyon-charms/src/platform/official-platform.ts`
- Create: `example/canyon-charms/test/official-platform.test.ts`
- Create: `scripts/build-arkadium-candidate.mjs`
- Modify: `example/canyon-charms/index.html`
- Modify: `package.json`
- Modify: `scripts/verify.mjs`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing injected-loader test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfficialPlatform } from '../src/platform/official-platform.ts';

test('runtime SDK version drift fails with a redacted error', async () => {
  const platform = createOfficialPlatform({
    manifest: validSandboxManifest,
    loadSdk: async () => ({ version: '9.9.9' } as never),
  });
  const result = await platform.initialize();
  assert.equal(result.ok, false);
  assert.match(result.error.message, /version/);
  assert.equal(result.error.message.includes('9.9.9'), false);
});
```

```bash
node --experimental-strip-types --test example/canyon-charms/test/official-platform.test.ts
```

- [ ] **Step 2: Implement explicit mode selection**

```js
export async function createRuntimePlatform(manifest) {
  if (manifest.mode === 'standalone') return createStandalonePublisherPlatform();
  const { createOfficialPlatform } = await import('./official-platform.ts');
  return createOfficialPlatform({ manifest });
}
```

Publisher modes never fall back to standalone after load or initialization failure.

- [ ] **Step 3: Add the Vite candidate build**

Vite uses root `example/canyon-charms`, writes to `example/canyon-charms/arkadium-dist`, disables source maps, and emits the validated runtime manifest. The official package is imported only from `@arkadiuminc/sdk`. No CDN runtime dependency is permitted.

- [ ] **Step 4: Add verification**

```bash
npm run build:arkadium -- --config config/runtime.sandbox.example.json
```

Verify exact SDK inventory, no source maps, no secrets, no bare output imports, no placeholder DEV/PROD IDs, and successful headless-Chrome boot with an injected Arena boundary.

- [ ] **Step 5: Verify both build tracks**

```bash
npm run build -- --project example/canyon-charms
npm run build:arkadium -- --config config/runtime.sandbox.example.json
npm run verify
```

- [ ] **Step 6: Commit and merge**

```bash
git add example/canyon-charms scripts package.json package-lock.json .github/workflows/ci.yml
git commit -m "feat: build Canyon Charms with the official Arkadium SDK"
```

---

### Task 8: Bounded Game Eye Sink and Safe Diagnostics

**PR title:** `feat: add Game Eye event delivery and integration diagnostics`

**Files:**
- Create: `packages/game-events/src/game-eye-sink.js`
- Create: `packages/game-events/test/game-eye-sink.test.js`
- Create: `example/canyon-charms/src/integration/debug-panel.js`
- Create: `example/canyon-charms/integration-debug.css`
- Modify: `example/canyon-charms/index.html`
- Modify: `example/canyon-charms/src/main.js`

- [ ] **Step 1: Write the failing bounded-delivery test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameEyeSink } from '../src/game-eye-sink.js';

test('sink batches at most 32 events and retries twice', async () => {
  const requests = [];
  const sink = createGameEyeSink({
    endpoint: 'http://127.0.0.1:3001/v1/game-events',
    context: validContext,
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response('unavailable', { status: 503 });
    },
    retryDelaysMs: [0, 0],
  });
  for (let index = 1; index <= 40; index += 1) await sink.enqueue(event(index));
  await sink.flush();
  assert.equal(requests.every((request) => request.events.length <= 32), true);
  assert.equal(requests.length <= 3, true);
});
```

- [ ] **Step 2: Implement the exact envelope**

Use schema `ark.game-events.v1`, UUID-v4 session/event IDs, ordered sequences, exact build and SDK versions, and batches of 1..32. Queue length and retries are bounded. Unload uses `sendBeacon` only for already validated payloads. Delivery failure never changes game rules, score, or save state.

- [ ] **Step 3: Add the non-PROD debug panel**

With `integrationDebug=1`, show build SHA, game version, platform mode, SDK version, capabilities, lifecycle call names, queue count, and the last redacted delivery result. Never show credentials, profiles, saves, App Insights IDs, cookies, raw request IDs, or wallet transaction IDs. PROD does not include the panel.

- [ ] **Step 4: Verify and merge**

```bash
node --test packages/game-events/test/game-eye-sink.test.js
npm run verify
```

---

### Task 9: Official Sandbox Evidence Gate

**PR title:** `ci: add official Arkadium Sandbox evidence gate`

**Files:**
- Create: `.github/workflows/arkadium-sandbox.yml`
- Create: `scripts/arkadium-sandbox-evidence-lib.mjs`
- Create: `scripts/verify-arkadium-sandbox-evidence.mjs`
- Create: `test/arkadium-sandbox-evidence.test.js`
- Create: `docs/ARKADIUM_SANDBOX_RUNBOOK.md`
- Modify: `docs/ARKADIUM_CHECKLIST.md`

- [ ] **Step 1: Write the failing evidence test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifySandboxEvidence } from '../scripts/arkadium-sandbox-evidence-lib.mjs';

const SHA = '709a1556fda3fa7a1506d46ec704cc654308775b';

test('evidence requires exact build, SDK and lifecycle ordering', () => {
  const report = verifySandboxEvidence({
    buildSha: SHA,
    sdkVersion: '2.66.2',
    observedCalls: ['ready', 'gameStart', 'levelStart:1', 'score:240', 'levelEnd:1', 'gameEnd'],
    hostPauseObserved: true,
    hostResumeObserved: true,
    bootErrorVisible: false,
  }, { expectedBuildSha: SHA, expectedSdkVersion: '2.66.2' });
  assert.equal(report.ok, true);
});
```

- [ ] **Step 2: Implement fail-closed evidence validation**

Reject another build SHA, another SDK version, stale timestamps, missing or duplicate lifecycle calls, score regression, absent host pause/resume, visible boot errors, unknown operations, raw payload values, and sensitive field names.

- [ ] **Step 3: Add a protected manual Sandbox workflow**

The workflow runs `npm ci`, `npm run verify`, builds the exact candidate, publishes an immutable preview, opens the official Sandbox in headless Chrome, captures lifecycle indicators and host pause/resume, verifies evidence, and uploads screenshots, console log, `sandbox-status.json`, `sandbox-events.json`, and `rpc-diagnostics.json`. An upstream Sandbox UI change causes a failed job rather than synthetic success.

- [ ] **Step 4: Update release truth**

Document four distinct states: `contract-ready`, `sandbox-verified`, `arkadium-dev-ready`, and `production-approved`.

- [ ] **Step 5: Verify and merge**

```bash
node --test test/arkadium-sandbox-evidence.test.js
npm run verify
```

---

## Plan Self-Review

- **Spec coverage:** runtime modes, exact SDK, snapshot provenance, typed platform boundary, exactly-once lifecycle, canonical events, Game Eye client, diagnostics, Sandbox evidence, and release truth each have an implementation task.
- **Intentionally deferred:** Ark Eye `/v1/game-events`, JetStream writer, and ClickHouse schema are Workstream B. Cross-repository Docker Compose and protected Arkadium DEV are Workstream C.
- **Placeholder scan:** no implementation step uses fabricated credentials, identifiers, commits, or hashes. Commands compute snapshot provenance and digests from real repositories.
- **Type consistency:** `PublicRuntimeManifest`, `PublisherPlatform`, canonical event names, and SDK version `2.66.2` match the approved design.
- **Merge strategy:** every task is independently useful, leaves `main` playable, and ends with focused tests plus `npm run verify` before squash merge.
