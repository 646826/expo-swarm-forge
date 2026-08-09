# Arkadium Publisher Integration Workstream A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, exact-version Arkadium publisher integration foundation to `expo-swarm-forge` while preserving standalone play and keeping every independently useful slice mergeable into `main`.

**Architecture:** Game rules remain publisher-neutral. A strict public runtime manifest selects `standalone`, `arkadium-sandbox`, `arkadium-dev`, or `arkadium-prod`; a typed `PublisherPlatform` boundary and explicit session controller own lifecycle ordering. The official adapter is imported from a deterministic snapshot of `arkadium-game-factory`, bundled only for Arkadium builds with the exact `@arkadiuminc/sdk` version, and verified independently from Game Eye telemetry.

**Tech Stack:** Node.js 22.23 or newer, browser ESM, JavaScript with JSDoc plus `.d.ts` declarations, Node `node:test`, TypeScript 6.0.3 for the vendored adapter, Vite 8.1.5 for Arkadium-mode bundles, exact `@arkadiuminc/sdk` 2.66.2, GitHub Actions, headless Chrome.

## Global Constraints

- Every task below lands as its own pull request and is squash-merged after fresh CI.
- `main` must remain playable and `npm run verify` must pass after every merge.
- The deterministic game core under `example/canyon-charms/src/core/` is unchanged unless a real rule defect is proven by a failing test.
- Publisher modes never discover or guess global method names.
- Standalone mode never loads the official Arkadium SDK.
- The official SDK version is exactly `2.66.2`; floating ranges are forbidden.
- No Arkadium credential, DEV login, App Insights secret, user profile, save payload, cookie value, wallet transaction identifier, or raw SDK error enters source control, browser manifests, logs, telemetry, or evidence.
- Placeholder publisher identifiers such as `demo`, `test`, `changeme`, empty strings, or all-zero identifiers are rejected in DEV and PROD modes.
- Mocks may prove contract behavior only; they never satisfy Sandbox, DEV, or release evidence tiers.
- Existing advertising endpoint `/imp` and its schema are outside this workstream and remain unchanged.

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
- Consumes: plain JSON or an environment-like object.
- Produces:
  - `validateRuntimeManifest(input): PublicRuntimeManifest`
  - `runtimeManifestFromEnv(env, defaults?): PublicRuntimeManifest`
  - `PLATFORM_MODES`
  - `ANALYTICS_PROVIDERS`

- [ ] **Step 1: Write failing runtime-manifest tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runtimeManifestFromEnv,
  validateRuntimeManifest,
} from '../src/index.js';

const SHA = '709a1556fda3fa7a1506d46ec704cc654308775b';

test('standalone accepts only public standalone fields', () => {
  assert.deepEqual(validateRuntimeManifest({
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
  }).mode, 'standalone');
});

test('sandbox requires DEV and console analytics', () => {
  const result = validateRuntimeManifest({
    schemaVersion: 1,
    mode: 'arkadium-sandbox',
    arkadiumEnvironment: 'DEV',
    gameId: null,
    analyticsProvider: 'console',
    appInsightsId: null,
    gameEyeEndpoint: 'http://127.0.0.1:3001/v1/game-events',
    gameEyeProject: 'canyon-charms',
    gameVersion: '1.0.0',
    buildSha: SHA,
  });
  assert.equal(result.analyticsProvider, 'console');
});

test('production rejects placeholders and non-HTTPS telemetry', () => {
  assert.throws(() => validateRuntimeManifest({
    schemaVersion: 1,
    mode: 'arkadium-prod',
    arkadiumEnvironment: 'PROD',
    gameId: 'demo',
    analyticsProvider: 'app-insights',
    appInsightsId: 'changeme',
    gameEyeEndpoint: 'http://example.com/v1/game-events',
    gameEyeProject: 'canyon-charms',
    gameVersion: '1.0.0',
    buildSha: SHA,
  }), /placeholder|HTTPS/);
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

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test packages/integration-config/test/runtime-config.test.js
```

Expected: failure because `packages/integration-config/src/index.js` does not exist.

- [ ] **Step 3: Implement exact validation**

```js
export const PLATFORM_MODES = Object.freeze([
  'standalone',
  'arkadium-sandbox',
  'arkadium-dev',
  'arkadium-prod',
]);
export const ANALYTICS_PROVIDERS = Object.freeze(['none', 'console', 'app-insights']);

const SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLACEHOLDER = /^(?:demo|test|changeme|none|null|0+)$/i;
const ALLOWED_KEYS = new Set([
  'schemaVersion', 'mode', 'arkadiumEnvironment', 'gameId', 'analyticsProvider',
  'appInsightsId', 'gameEyeEndpoint', 'gameEyeProject', 'gameVersion', 'buildSha',
]);

export function validateRuntimeManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Runtime manifest must be a plain object.');
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) throw new TypeError(`Unknown runtime field: ${key}`);
  }
  const manifest = Object.freeze({
    schemaVersion: input.schemaVersion,
    mode: input.mode,
    arkadiumEnvironment: input.arkadiumEnvironment ?? null,
    gameId: normalizeNullableString(input.gameId),
    analyticsProvider: input.analyticsProvider,
    appInsightsId: normalizeNullableString(input.appInsightsId),
    gameEyeEndpoint: normalizeNullableString(input.gameEyeEndpoint),
    gameEyeProject: input.gameEyeProject,
    gameVersion: input.gameVersion,
    buildSha: input.buildSha,
  });
  // Validate exact enums, SHA, SemVer and mode-specific combinations here.
  return manifest;
}
```

The completed implementation must reject accessors, symbol keys, non-finite values, unknown fields, invalid URLs, mode/environment mismatches, and production placeholders without including rejected values in the error message.

- [ ] **Step 4: Add public example manifests and declarations**

`config/runtime.standalone.json` contains a valid committed standalone manifest. `config/runtime.sandbox.example.json` contains `arkadium-sandbox`, `DEV`, `console`, no App Insights identifier, and a localhost Game Eye endpoint. The `.d.ts` file declares the exact `PublicRuntimeManifest` union and function signatures from the approved design.

- [ ] **Step 5: Verify GREEN and repository compatibility**

```bash
node --test packages/integration-config/test/runtime-config.test.js
npm run verify
```

Expected: all tests pass, both game packages build, both ZIPs are produced, and the handbook is generated.

- [ ] **Step 6: Commit and merge**

```bash
git add packages/integration-config config README.md
git commit -m "feat: add strict Arkadium runtime configuration"
```

Open a PR with only these files, wait for CI, squash-merge to `main`.

---

### Task 2: Publisher Platform Contract and Real Standalone Adapter

**PR title:** `feat: add typed publisher platform boundary`

**Files:**
- Create: `packages/publisher-platform/src/index.js`
- Create: `packages/publisher-platform/src/index.d.ts`
- Create: `packages/publisher-platform/src/standalone.js`
- Create: `packages/publisher-platform/test/standalone.test.js`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: locale and optional serializable local save store.
- Produces:
  - `ok(value)` and `failure(code, message)` result helpers.
  - `NO_CAPABILITIES`.
  - `createStandalonePublisherPlatform(options?): PublisherPlatform`.
  - `.d.ts` declarations matching the approved `PublisherPlatform` contract.

- [ ] **Step 1: Write failing contract tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStandalonePublisherPlatform } from '../src/standalone.js';

test('standalone initializes without loading a publisher SDK', async () => {
  const platform = createStandalonePublisherPlatform({ locale: 'en-US' });
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

test('pause subscriptions unsubscribe and destroy is idempotent', async () => {
  const platform = createStandalonePublisherPlatform();
  let calls = 0;
  const unsubscribe = platform.onPause(() => { calls += 1; });
  platform.__test?.pause();
  unsubscribe();
  platform.__test?.pause();
  await platform.destroy();
  await platform.destroy();
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test packages/publisher-platform/test/standalone.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the contract and standalone adapter**

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

The standalone adapter implements every contract method. Unsupported optional capabilities return stable `UNSUPPORTED_CAPABILITY` failures. Lifecycle methods return `ok(undefined)`. Pause/resume test hooks are exported only from a separate test harness object and are never present in production builds.

- [ ] **Step 4: Verify declarations and behavior**

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
- Create: `scripts/sync-arkadium-snapshot.mjs`
- Create: `scripts/verify-arkadium-snapshot.mjs`
- Create: `test/arkadium-snapshot.test.js`
- Create: `vendor/arkadium-platform/README.md`
- Modify: `package.json`
- Modify: `scripts/verify.mjs`

**Interfaces:**
- Consumes: a local checkout of `646826/arkadium-game-factory`.
- Produces:
  - `npm run arkadium:sync -- --source <path>`
  - `npm run arkadium:verify-snapshot`
  - `vendor/arkadium-platform/manifest.json` with schema version, source commit, SDK version and per-file SHA-256.

- [ ] **Step 1: Write failing snapshot tests with a temporary source repository**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncSnapshot, verifySnapshot } from '../scripts/arkadium-snapshot-lib.mjs';

test('snapshot records exact source commit and hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkadium-snapshot-'));
  const source = join(root, 'source');
  const destination = join(root, 'vendor');
  await mkdir(join(source, 'packages/platform-contract/src'), { recursive: true });
  await writeFile(join(source, 'packages/platform-contract/src/index.ts'), 'export const x = 1;\n');
  await writeFile(join(source, '.snapshot-source-commit'), '0123456789abcdef0123456789abcdef01234567\n');
  const manifest = await syncSnapshot({ source, destination, sourceCommitFile: '.snapshot-source-commit' });
  assert.equal(manifest.sourceCommit, '0123456789abcdef0123456789abcdef01234567');
  assert.equal((await verifySnapshot(destination)).ok, true);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test test/arkadium-snapshot.test.js
```

- [ ] **Step 3: Implement snapshot sync and verification**

The sync command copies only allowlisted roots:

```js
const SNAPSHOT_ROOTS = Object.freeze([
  'packages/platform-contract/src',
  'packages/platform-arkadium/src',
  'packages/platform-arkadium/sdk',
  'packages/platform-arkadium/package.json',
]);
```

It obtains the source commit using `git -C <source> rev-parse HEAD`, rejects a dirty source checkout, normalizes paths, copies bytes, writes lowercase SHA-256 values, and records SDK version `2.66.2`. Verification recomputes every hash, rejects extra or missing files, and fails when the package dependency or SDK snapshot version differs.

- [ ] **Step 4: Add scripts to the complete quality gate**

```json
{
  "scripts": {
    "arkadium:sync": "node scripts/sync-arkadium-snapshot.mjs",
    "arkadium:verify-snapshot": "node scripts/verify-arkadium-snapshot.mjs"
  }
}
```

`scripts/verify.mjs` invokes snapshot verification only when a committed manifest exists, allowing this tooling PR to land before the actual snapshot PR.

- [ ] **Step 5: Verify and merge**

```bash
node --test test/arkadium-snapshot.test.js
npm run verify
```

Commit:

```bash
git commit -am "build: add Arkadium adapter snapshot verification"
```

---

### Task 4: Import the Exact Reviewed Adapter Snapshot

**PR title:** `build: vendor reviewed Arkadium adapter snapshot`

**Files:**
- Create: `vendor/arkadium-platform/manifest.json`
- Create: allowlisted files under `vendor/arkadium-platform/source/`
- Create: `vendor/arkadium-platform/LICENSES.md`
- Modify: `package.json`
- Create or modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: clean local `arkadium-game-factory` checkout and Task 3 commands.
- Produces: immutable source snapshot and exact dependency lock.

- [ ] **Step 1: Run the sync command against the reviewed factory checkout**

```bash
npm run arkadium:sync -- --source ../arkadium-game-factory
```

Expected manifest requirements:

```json
{
  "schemaVersion": 1,
  "sourceRepository": "646826/arkadium-game-factory",
  "sourceCommit": "<computed 40-character commit>",
  "sdkVersion": "2.66.2",
  "files": { "source/...": "<computed sha256>" }
}
```

The command writes actual values; no value is manually invented.

- [ ] **Step 2: Pin dependencies and create the lock file**

```json
{
  "dependencies": {
    "@arkadiuminc/sdk": "2.66.2"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vite": "8.1.5"
  }
}
```

Run:

```bash
npm install --package-lock-only
npm ci
```

- [ ] **Step 3: Make CI install the exact lock**

Insert after Node setup:

```yaml
- name: Install exact dependencies
  run: npm ci
```

- [ ] **Step 4: Verify the snapshot and full repository**

```bash
npm run arkadium:verify-snapshot
npm run verify
```

Expected: manifest hashes pass, exact SDK version matches, existing game remains unchanged, and CI uses the lock file.

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

**Interfaces:**
- Consumes:
  - `PublisherPlatform`.
  - callbacks `{ setPaused, suspendAudio, resumeAudio, reportIntegrationError }`.
- Produces `createGameSessionController(options)` with:
  - `boot()`
  - `startLevel(levelId)`
  - `score(totalScore)`
  - `pause(source)`
  - `resume(source)`
  - `endLevel(levelId, reason)`
  - `destroy()`
  - `phase`

- [ ] **Step 1: Write failing lifecycle tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameSessionController } from '../src/session/controller.js';

function recordingPlatform() {
  const calls = [];
  return {
    calls,
    capabilities: Object.freeze({ persistence: false, analytics: false, interstitialAds: false, rewardedAds: false, wallet: false, leaderboards: false }),
    initialize: async () => ({ ok: true, value: { userState: 'anonymous', locale: 'en-US', capabilities: this?.capabilities } }),
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

The controller serializes lifecycle operations through one promise chain, registers host pause/resume once, suppresses duplicate outgoing calls, rejects score regression, and makes `destroy()` idempotent. Initialization and ready failures are boot-critical in Arkadium modes but become stable redacted failures.

- [ ] **Step 4: Adapt the legacy standalone boundary**

`example/canyon-charms/src/platform/platform.js` exports a compatibility wrapper matching `PublisherPlatform`; guessed global discovery remains accessible only through an explicitly named `createLegacyCompatibilityPlatform()` and is not selected by publisher modes.

- [ ] **Step 5: Verify and merge**

```bash
node --test example/canyon-charms/test/session-controller.test.js
npm run verify
```

---

### Task 6: Canonical Events and Controller Wiring

**PR title:** `feat: route Canyon Charms through canonical integration events`

**Files:**
- Create: `packages/game-events/src/catalog.js`
- Create: `packages/game-events/src/dispatcher.js`
- Create: `packages/game-events/src/index.d.ts`
- Create: `packages/game-events/test/events.test.js`
- Modify: `example/canyon-charms/src/main.js`
- Modify: `example/canyon-charms/test/game.test.js`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes game facts and ordered sinks.
- Produces:
  - `createCanonicalEventFactory(context)`
  - `validateCanonicalEvent(event)`
  - `createEventDispatcher(sinks)`
  - immutable allowlisted event catalog.

- [ ] **Step 1: Write failing event-schema tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalEventFactory, validateCanonicalEvent } from '../src/catalog.js';

test('canonical events receive ordered sequence and primitive properties', () => {
  const createEvent = createCanonicalEventFactory({ now: () => '2026-08-09T20:00:00.000Z' });
  const first = createEvent('game_start', { levelId: '1' });
  const second = createEvent('move_accepted', { scoreDelta: 240, combo: 1 });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(validateCanonicalEvent(second).name, 'move_accepted');
});

test('sensitive and unknown properties fail closed', () => {
  const createEvent = createCanonicalEventFactory();
  assert.throws(() => createEvent('game_start', { token: 'secret' }), /property/);
  assert.throws(() => createEvent('unknown_event', {}), /event/);
});
```

- [ ] **Step 2: Implement the initial event catalog**

Catalog entries define exact properties and sink routing for:

```text
sdk_initialize_started sdk_initialize_succeeded sdk_ready game_start level_start
move_rejected move_accepted score_changed pause resume level_end game_end
save_load save_write ad_request ad_result leaderboard_submit wallet_balance
wallet_consume_result integration_error
```

Only primitive property values are accepted. String length, integer bounds, non-finite numbers, unknown fields and recursive sensitive-name patterns fail before dispatch.

- [ ] **Step 3: Wire `main.js` through the controller**

Direct calls such as `platform.started()`, `platform.submitScore()` and `platform.completed()` are removed. The UI invokes the controller, and the controller publishes one canonical event per accepted game fact. Rendering and deterministic game-state transitions remain unchanged.

- [ ] **Step 4: Extend Chrome evidence**

CI verifies the title state, starts a deterministic game through a query-controlled test route, and asserts that the integration diagnostics DOM contains an ordered lifecycle prefix without exposing payload values.

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
- Create: `example/canyon-charms/test/official-platform.test.js`
- Create: `scripts/build-arkadium-candidate.mjs`
- Modify: `example/canyon-charms/index.html`
- Modify: `package.json`
- Modify: `scripts/verify.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes validated `PublicRuntimeManifest` and the vendored factory adapter.
- Produces:
  - `createRuntimePlatform(manifest)`.
  - `npm run build:arkadium -- --config <manifest.json>`.
  - `release/canyon-charms-arkadium-sandbox.zip`.

- [ ] **Step 1: Write failing injected-loader tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfficialPlatform } from '../src/platform/official-platform.ts';

test('official platform rejects runtime SDK version drift', async () => {
  const platform = createOfficialPlatform({
    manifest: validSandboxManifest,
    loadSdk: async () => ({ version: '9.9.9' }),
  });
  const result = await platform.initialize();
  assert.equal(result.ok, false);
  assert.match(result.error.message, /version/);
  assert.equal(result.error.message.includes('9.9.9'), false);
});
```

Run with Node type stripping:

```bash
node --experimental-strip-types --test example/canyon-charms/test/official-platform.test.js
```

- [ ] **Step 2: Implement explicit mode selection**

```js
export async function createRuntimePlatform(manifest) {
  if (manifest.mode === 'standalone') return createStandalonePublisherPlatform();
  const { createOfficialPlatform } = await import('./official-platform.ts');
  return createOfficialPlatform({ manifest });
}
```

Publisher modes never fall back to standalone on load or initialization failure.

- [ ] **Step 3: Bundle with Vite using exact versions**

The Vite config uses `root: example/canyon-charms`, writes to an isolated candidate directory, disables source maps, and injects the validated runtime manifest as a generated asset. The bundle imports `@arkadiuminc/sdk` only from its package root through the reviewed loader. No remote CDN dependency is allowed.

- [ ] **Step 4: Add candidate build verification**

```bash
npm run build:arkadium -- --config config/runtime.sandbox.example.json
```

The verifier checks:

- exact SDK version `2.66.2` in manifest and bundle inventory;
- no source maps;
- no credentials or placeholder DEV/PROD identifiers;
- no bare module specifiers in output;
- no runtime network dependency except configured Arkadium and Game Eye endpoints;
- successful Chrome boot in a test host that exercises real bundled SDK loading with an injected Arena boundary.

- [ ] **Step 5: Keep standalone output working**

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

**Interfaces:**
- Consumes validated canonical events and public runtime context.
- Produces:
  - `createGameEyeSink(options)`.
  - `createIntegrationDebugPanel(options)` for non-PROD builds.

- [ ] **Step 1: Write failing bounded-delivery tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameEyeSink } from '../src/game-eye-sink.js';

test('sink batches at most 32 events and retries a bounded number of times', async () => {
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
  for (let index = 0; index < 40; index += 1) await sink.enqueue(event(index + 1));
  await sink.flush();
  assert.equal(requests.every((request) => request.events.length <= 32), true);
  assert.equal(requests.length <= 3, true);
});
```

- [ ] **Step 2: Implement the exact browser envelope**

The sink creates schema `ark.game-events.v1`, UUID-v4 session and event identifiers, ordered sequences, exact build and SDK versions, and a 1..32 event batch. Queue size is bounded, retries are bounded, unload uses `sendBeacon` only for already validated payloads, and delivery failure never changes score or game state.

- [ ] **Step 3: Add safe debug panel**

The panel is available only when `mode !== 'arkadium-prod'` and `integrationDebug=1`. It shows build SHA, game version, platform mode, exact SDK version, capability flags, lifecycle call names, queue count, and the last redacted delivery status. It never renders credentials, profiles, save content, App Insights identifiers, cookies, raw request IDs, or wallet transaction IDs.

- [ ] **Step 4: Verify browser behavior and merge**

```bash
node --test packages/game-events/test/game-eye-sink.test.js
npm run verify
```

Chrome evidence must show the panel when requested and prove it is absent in a PROD candidate.

---

### Task 9: Official Sandbox Candidate and Evidence Gate

**PR title:** `ci: add official Arkadium Sandbox evidence gate`

**Files:**
- Create: `.github/workflows/arkadium-sandbox.yml`
- Create: `scripts/verify-arkadium-sandbox-evidence.mjs`
- Create: `test/arkadium-sandbox-evidence.test.js`
- Create: `docs/ARKADIUM_SANDBOX_RUNBOOK.md`
- Modify: `scripts/verify.mjs`
- Modify: `docs/ARKADIUM_CHECKLIST.md`

**Interfaces:**
- Consumes immutable Sandbox candidate URL and official Sandbox browser evidence.
- Produces:
  - `npm run verify:arkadium-sandbox-evidence -- --evidence <path>`.
  - build-bound `evidence/sandbox-status.json`, `evidence/sandbox-events.json`, `evidence/rpc-diagnostics.json`, screenshots and console log.

- [ ] **Step 1: Write failing evidence-verifier tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifySandboxEvidence } from '../scripts/arkadium-sandbox-evidence-lib.mjs';

test('evidence requires exact build, SDK and lifecycle ordering', () => {
  const report = verifySandboxEvidence({
    buildSha: '709a1556fda3fa7a1506d46ec704cc654308775b',
    sdkVersion: '2.66.2',
    observedCalls: ['ready', 'gameStart', 'levelStart:1', 'score:240', 'levelEnd:1', 'gameEnd'],
    hostPauseObserved: true,
    hostResumeObserved: true,
    bootErrorVisible: false,
  }, {
    expectedBuildSha: '709a1556fda3fa7a1506d46ec704cc654308775b',
    expectedSdkVersion: '2.66.2',
  });
  assert.equal(report.ok, true);
});
```

- [ ] **Step 2: Implement fail-closed evidence validation**

The verifier rejects stale timestamps, another build SHA, another SDK version, missing ready/start/end calls, duplicate game start/end, score regression, absent host pause/resume, visible boot error, unknown operations, raw payload values, and sensitive field names.

- [ ] **Step 3: Add a protected manual Sandbox workflow**

The workflow:

1. checks out the exact commit;
2. runs `npm ci` and `npm run verify`;
3. builds the exact Sandbox candidate;
4. deploys it to an immutable preview URL;
5. opens the official Arkadium Sandbox in Chrome using the documented runbook;
6. records lifecycle indicators, host pause/resume, browser console and screenshots;
7. runs the evidence verifier;
8. uploads the evidence bundle.

When official Sandbox UI automation cannot proceed because of an upstream UI change, the job fails rather than emitting synthetic success. A manual artifact upload path is permitted only when the same verifier binds evidence to the exact workflow candidate.

- [ ] **Step 4: Update release truth**

`docs/ARKADIUM_CHECKLIST.md` distinguishes:

```text
contract-ready       Tasks 1-8 and normal CI pass
sandbox-verified     current Task 9 evidence passes
arkadium-dev-ready   protected DEV workflow passes later
production-approved  Arkadium publisher approval exists
```

- [ ] **Step 5: Verify and merge**

```bash
node --test test/arkadium-sandbox-evidence.test.js
npm run verify
```

---

## Plan Self-Review

- **Spec coverage:** runtime modes, exact SDK, snapshot provenance, typed platform boundary, exactly-once lifecycle, canonical events, Game Eye client, diagnostics, Sandbox evidence and release truth are each assigned to a task.
- **Intentionally deferred:** Ark Eye `/v1/game-events`, JetStream writer and ClickHouse schema belong to Workstream B; cross-repository Docker Compose and protected Arkadium DEV belong to Workstream C.
- **Placeholders:** no implementation step depends on fabricated credentials or identifiers. Computed source commits and hashes are produced by commands, not manually substituted.
- **Type consistency:** `PublicRuntimeManifest`, `PublisherPlatform`, canonical event names and SDK version `2.66.2` match the approved design.
- **Merge strategy:** every task is independently useful, keeps `main` playable, and ends with `npm run verify` plus its focused tests before squash merge.
