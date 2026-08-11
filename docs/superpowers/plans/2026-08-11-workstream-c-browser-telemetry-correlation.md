# Browser Telemetry Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that one immutable Canyon Charms browser session reaches the reviewed Ark Eye `/v1/game-events` endpoint, real NATS JetStream, the app-owned durable consumer, and real ClickHouse, then bind the same correlation contract to official Arkadium Sandbox evidence.

**Architecture:** Land four independently mergeable slices. First expose a privacy-safe standalone browser evidence boundary. Second add an exact local telemetry candidate and deterministic Chrome driver. Third run that public candidate from the private Ark Eye CI stack and verify real rows. Fourth extend the protected official Sandbox gate so publisher evidence and Ark Eye evidence must share the same build SHA and session ID.

**Tech Stack:** Node.js 22, browser ES modules, Vite 8.1.5, headless Chrome/CDP, Bun, Docker, NATS JetStream 2.14.3, ClickHouse 25.8.28.1, GitHub Actions.

## Global Constraints

- Every task lands through its own short branch and pull request; merge immediately after all gates are green.
- The ordinary standalone release remains playable and does not send telemetry unless an explicit validated runtime manifest supplies `gameEyeEndpoint`.
- Official Arkadium modes never downgrade to standalone.
- `sdkVersion` is `null` for standalone telemetry and exactly `2.66.2` for official Arkadium modes.
- No credential, token, exact IP, cookie, profile, save payload, App Insights identifier, raw response body, arbitrary thrown message, or wallet transaction ID enters evidence.
- Browser evidence is structural and build-bound; ClickHouse evidence is queried from exact `game_event_v1` rows.
- The canonical envelope, event catalog, stream limits, durable policy, retry schedule, ClickHouse schema, `/imp`, and `/stats` remain unchanged.
- Each implementation slice starts with a failing test, records the RED workflow, implements the minimum code, and records the final GREEN workflow.

---

### Task 1: Standalone Browser Telemetry Evidence Boundary

**Files:**
- Create: `example/canyon-charms/src/integration/telemetry-evidence.js`
- Create: `example/canyon-charms/test/telemetry-evidence.test.js`
- Modify: `example/canyon-charms/src/integration/runtime.js`
- Modify: `example/canyon-charms/test/integration-runtime.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: a validated public runtime manifest, the existing `GameEyeSink`, and integration diagnostics.
- Produces: `installTelemetryEvidenceApi(options)` and non-enumerable `globalThis.__CANYON_TELEMETRY_EVIDENCE__()` in explicitly enabled non-PROD browser runs.

- [ ] **Step 1: Write the failing evidence-schema tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTelemetryEvidenceSnapshot,
  installTelemetryEvidenceApi,
} from '../src/integration/telemetry-evidence.js';

const SHA = '1111111111111111111111111111111111111111';
const SESSION = '01234567-89ab-4cde-8f01-23456789abcd';

const manifest = Object.freeze({
  mode: 'standalone',
  buildSha: SHA,
  gameVersion: '1.1.0',
});

test('local telemetry evidence is exact, frozen and privacy-minimal', () => {
  const snapshot = createTelemetryEvidenceSnapshot({
    runtimeManifest: manifest,
    sdkVersion: null,
    sessionId: SESSION,
    integrationDiagnostics: Object.freeze({
      phase: 'playing',
      events: Object.freeze([
        Object.freeze({ name: 'sdk_ready' }),
        Object.freeze({ name: 'level_start' }),
      ]),
    }),
    deliveryDiagnostics: Object.freeze({
      queueCount: 0,
      droppedCount: 0,
      inFlight: false,
      lastResult: Object.freeze({
        outcome: 'delivered',
        attempts: 1,
        batchSize: 2,
        httpStatus: 202,
      }),
    }),
  });

  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    source: 'local-browser-telemetry',
    sessionId: SESSION,
    buildSha: SHA,
    gameVersion: '1.1.0',
    platformMode: 'standalone',
    sdkVersion: null,
    phase: 'playing',
    eventCount: 2,
    lastEventName: 'level_start',
    queueCount: 0,
    droppedCount: 0,
    inFlight: false,
    lastDelivery: {
      outcome: 'delivered',
      attempts: 1,
      batchSize: 2,
      httpStatus: 202,
    },
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.lastDelivery), true);
  assert.doesNotMatch(JSON.stringify(snapshot), /endpoint|credential|token|cookie|profile|save|password|authorization/i);
});

test('API is absent without telemetryEvidence=1 and in arkadium-prod', () => {
  const globalImpl = {};
  assert.equal(installTelemetryEvidenceApi({
    runtimeManifest: manifest,
    sdkVersion: null,
    sessionId: SESSION,
    getIntegrationDiagnostics: () => ({ phase: 'ready', events: [] }),
    getDeliveryDiagnostics: () => ({ queueCount: 0, droppedCount: 0, inFlight: false, lastResult: null }),
    globalImpl,
    search: '',
  }), null);
  assert.equal(Object.hasOwn(globalImpl, '__CANYON_TELEMETRY_EVIDENCE__'), false);
});
```

- [ ] **Step 2: Run the focused test and record RED**

Run:

```bash
node --test example/canyon-charms/test/telemetry-evidence.test.js
```

Expected: `ERR_MODULE_NOT_FOUND` for `telemetry-evidence.js` while all existing tests remain unchanged.

- [ ] **Step 3: Implement the exact evidence snapshot and API**

```js
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILD_SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const MODES = new Set(['standalone', 'arkadium-sandbox', 'arkadium-dev']);

export function createTelemetryEvidenceSnapshot({
  runtimeManifest,
  sdkVersion,
  sessionId,
  integrationDiagnostics,
  deliveryDiagnostics,
} = {}) {
  if (!runtimeManifest
    || !MODES.has(runtimeManifest.mode)
    || !BUILD_SHA.test(runtimeManifest.buildSha)
    || !SEMVER.test(runtimeManifest.gameVersion)
    || !UUID_V4.test(sessionId)
    || (sdkVersion !== null && sdkVersion !== '2.66.2')) {
    throw new Error('Telemetry evidence context is invalid.');
  }
  const events = Array.isArray(integrationDiagnostics?.events)
    ? integrationDiagnostics.events
    : [];
  const last = deliveryDiagnostics?.lastResult;
  const lastDelivery = last && typeof last === 'object'
    ? Object.freeze({
      outcome: last.outcome,
      attempts: last.attempts,
      batchSize: last.batchSize,
      httpStatus: last.httpStatus,
    })
    : null;
  return Object.freeze({
    schemaVersion: 1,
    source: 'local-browser-telemetry',
    sessionId,
    buildSha: runtimeManifest.buildSha,
    gameVersion: runtimeManifest.gameVersion,
    platformMode: runtimeManifest.mode,
    sdkVersion,
    phase: integrationDiagnostics?.phase ?? 'unknown',
    eventCount: events.length,
    lastEventName: events.at(-1)?.name ?? null,
    queueCount: deliveryDiagnostics?.queueCount ?? 0,
    droppedCount: deliveryDiagnostics?.droppedCount ?? 0,
    inFlight: deliveryDiagnostics?.inFlight === true,
    lastDelivery,
  });
}
```

`installTelemetryEvidenceApi` must require `telemetryEvidence=1`, reject PROD, define a configurable non-enumerable function, and delete it idempotently during destroy.

- [ ] **Step 4: Wire runtime instrumentation and correct standalone SDK context**

In `createCandidateGameEyeSink`, pass:

```js
sdkVersion: runtimeManifest.mode === 'standalone'
  ? null
  : EXPECTED_OFFICIAL_SDK_VERSION,
```

Install the telemetry API only when a real Game Eye sink exists. Its readers call `integration.diagnostics()` and `gameEyeSink.diagnostics()` at snapshot time. Destroy the API before destroying the sink.

- [ ] **Step 5: Run focused and complete verification**

```bash
node --test example/canyon-charms/test/telemetry-evidence.test.js
node --test example/canyon-charms/test/integration-runtime.test.js
npm run verify
```

Expected: all tests pass; ordinary standalone Chrome output still has no telemetry evidence API or debug panel.

- [ ] **Step 6: Commit and merge the slice**

```bash
git add example/canyon-charms/src/integration/telemetry-evidence.js \
  example/canyon-charms/src/integration/runtime.js \
  example/canyon-charms/test/telemetry-evidence.test.js \
  example/canyon-charms/test/integration-runtime.test.js README.md
git commit -m "feat: expose safe local browser telemetry evidence"
```

Open a short PR, attach RED/GREEN workflow IDs, and squash-merge after CI.

---

### Task 2: Exact Local Telemetry Candidate and Chrome Capture

**Files:**
- Create: `scripts/telemetry-candidate-lib.mjs`
- Create: `scripts/build-telemetry-candidate.mjs`
- Create: `scripts/capture-local-telemetry-evidence.mjs`
- Create: `test/telemetry-candidate-build.test.js`
- Create: `test/local-telemetry-capture-contract.test.js`
- Modify: `example/canyon-charms/vite.config.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the Task 1 evidence API, public runtime-manifest validator, deterministic game seed, and existing sandbox driver geometry.
- Produces: `example/canyon-charms/telemetry-dist`, `runtime-manifest.json`, `telemetry-candidate-report.json`, and one browser evidence JSON file.

- [ ] **Step 1: Write failing build/capture contract tests**

Require the new builder to accept only `mode: 'standalone'`, a loopback `/v1/game-events` endpoint, exact game version `1.1.0`, and an exact 40-character source SHA. Require output to contain no source maps, external runtime assets, raw TypeScript, credentials, or Arkadium production configuration.

Require the capture script source to:

```js
assert.match(source, /__CANYON_TELEMETRY_EVIDENCE__/);
assert.match(source, /__CANYON_SANDBOX_DRIVER__/);
assert.match(source, /button\[data-action="start"\]/);
assert.match(source, /nextMove\(\)/);
assert.match(source, /telemetryEvidence=1/);
assert.doesNotMatch(source, /password|authorization|access[_-]?token|cookie/i);
```

- [ ] **Step 2: Run focused tests and record RED**

```bash
node --test test/telemetry-candidate-build.test.js test/local-telemetry-capture-contract.test.js
```

Expected: only the absent telemetry builder/capture modules fail.

- [ ] **Step 3: Implement the exact standalone telemetry builder**

The builder must reuse `validateRuntimeManifest`, Vite, output hashing, module-specifier checks, and external-asset checks, but it must not require or report the Arkadium SDK inventory. Output report:

```json
{
  "schemaVersion": 1,
  "source": "standalone-local-telemetry",
  "buildSha": "<exact game commit>",
  "gameVersion": "1.1.0",
  "runtimeMode": "standalone",
  "sdkVersion": null,
  "files": []
}
```

- [ ] **Step 4: Generalize the deterministic evidence driver without weakening Sandbox**

Keep `sandboxEvidence=1` behavior unchanged for `arkadium-sandbox`. Also install the same non-enumerable `__CANYON_SANDBOX_DRIVER__` when `telemetryEvidence=1` and runtime mode is `standalone`. Never install it for `arkadium-prod`.

- [ ] **Step 5: Implement Chrome capture**

The capture command accepts only:

```text
--url http://127.0.0.1:<port>/?seed=12345&telemetryEvidence=1
--expected-build-sha <40 lowercase hex>
--output <repository-local JSON path>
```

It launches headless Chrome/CDP, waits for `__CANYON_TELEMETRY_EVIDENCE__`, clicks the start button, performs one legal move through the driver, pauses and resumes through DOM buttons, waits until delivery reports HTTP `202` with queue `0`, and writes only the final evidence snapshot plus structural browser status.

- [ ] **Step 6: Add scripts and CI smoke**

```json
{
  "build:telemetry": "node scripts/build-telemetry-candidate.mjs",
  "capture:telemetry": "node scripts/capture-local-telemetry-evidence.mjs"
}
```

CI builds the candidate with a loopback endpoint, serves it, captures browser evidence against a small local HTTP fixture returning `202`, and validates the exact build SHA/session/event summary.

- [ ] **Step 7: Run complete verification, commit and merge**

```bash
npm run verify
npm run build:telemetry -- --config config/runtime.telemetry.example.json --build-sha "$(git rev-parse HEAD)"
```

Commit with:

```bash
git commit -m "build: add exact local telemetry candidate"
```

Merge immediately after the complete Node, deterministic build, Chrome, and artifact gates pass.

---

### Task 3: Real Browser → Ark Eye → JetStream → ClickHouse Workflow

**Repository:** `646826/ark-eye`

**Files:**
- Create: `.github/workflows/canyon-telemetry-integration.yml`
- Create: `scripts/verify-canyon-browser-telemetry.ts`
- Create: `src/canyon-browser-telemetry-contract.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: an exact public `expo-swarm-forge` commit containing Task 2, the existing Ark Eye production image, migration command, table verifier, app-owned durable consumer, and browser evidence JSON.
- Produces: `evidence/canyon-browser-telemetry.json`, exact queried rows, NATS consumer state, and one combined artifact bound to both repository SHAs.

- [ ] **Step 1: Write the failing workflow/script contracts**

Require the workflow to pin `CANYON_SHA` to 40 lowercase hex, check out that exact public commit into `canyon/`, build its telemetry candidate, and run the Ark Eye production image with:

```text
GAME_EVENTS_ALLOWED_ORIGINS=http://127.0.0.1:4173
GAME_EVENTS_CLICKHOUSE_ENABLED=true
GAME_EVENTS_CLICKHOUSE_URL=http://clickhouse:8123
GAME_EVENTS_CLICKHOUSE_ALLOW_HTTP=true
```

Require the verifier to compare browser `sessionId`, `buildSha`, and `sdkVersion: null` with exact ClickHouse rows and the `GAME_EVENTS_CLICKHOUSE_V1` ACK floor.

- [ ] **Step 2: Record RED**

Run the Docker build. Expected: all prior Ark Eye tests pass and only the new absent workflow/verifier contract fails.

- [ ] **Step 3: Implement the real integration topology**

Start digest-pinned NATS before ClickHouse, apply the canonical migration, verify the exact table, start the enabled Ark Eye app, serve `canyon/telemetry-dist` on `127.0.0.1:4173`, and run the public capture script. The verifier then requires:

```text
browser delivery status = 202
browser queue = 0
browser dropped = 0
ClickHouse rows >= browser event count
all rows share browser session_id and build_sha
platform_mode = standalone
sdk_version IS NULL
durable pending = 0
durable ack_pending = 0
durable redelivered = 0
ack_floor.stream_seq = delivered.stream_seq
```

- [ ] **Step 4: Write privacy-minimal evidence**

Evidence includes only repository SHAs, session ID, event IDs/names/sequences, structural browser delivery, ClickHouse row hashes/counts, stream/durable names and counters. Scan every JSON/log artifact for the shared sensitive-field denylist before upload.

- [ ] **Step 5: Run final CI, commit and merge**

Commit with:

```bash
git commit -m "ci: verify real Canyon browser telemetry round trip"
```

Merge after Bun tests, TypeScript, Docker, real NATS, real ClickHouse, real Chrome, correlation assertions, and artifact upload all pass.

---

### Task 4: Official Sandbox and Ark Eye Correlation Gate

**Repository:** `646826/expo-swarm-forge`

**Files:**
- Create: `scripts/correlated-telemetry-evidence-lib.mjs`
- Create: `scripts/verify-correlated-telemetry-evidence.mjs`
- Create: `test/correlated-telemetry-evidence.test.js`
- Modify: `.github/workflows/arkadium-sandbox.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: current `sandbox-verification.json`, browser telemetry evidence from a configured Ark Eye evidence endpoint or protected artifact handoff, expected candidate SHA, and exact SDK `2.66.2`.
- Produces: `evidence/arkadium-sandbox/correlated-telemetry-verification.json` with release state `sandbox-telemetry-verified` only when both independent evidence bundles match.

- [ ] **Step 1: Write failing cross-bundle verifier tests**

Require exact equality for `buildSha`, `sessionId`, `sdkVersion`, event ordering, freshness window, and source labels. Reject accessors, symbols, hidden fields, extra keys, stale timestamps, mismatched sessions, mismatched builds, missing ACK floor, forbidden fields, and evidence produced before the app-owned consumer existed.

- [ ] **Step 2: Record RED and implement the pure verifier**

The verifier must return one frozen fail-closed report and never echo rejected values. Successful summary contains only build/session binding, lifecycle call count, telemetry event count, ClickHouse row count, ACK floor, and hashes.

- [ ] **Step 3: Extend the protected workflow**

Build the official Sandbox candidate with a protected HTTPS `GAME_EYE_ENDPOINT`, run the existing official Sandbox capture, retrieve the corresponding privacy-minimal Ark Eye evidence for the same session, verify correlation, and upload both original and correlated reports. Absence of endpoint, evidence, or exact correlation leaves the repository at `sandbox-verified`; it must never claim telemetry verification.

- [ ] **Step 4: Run complete verification, commit and merge**

```bash
node --test test/correlated-telemetry-evidence.test.js
npm run verify
```

Commit with:

```bash
git commit -m "ci: correlate official Sandbox and Ark Eye evidence"
```

Merge after ordinary CI. The protected workflow remains the only path to `sandbox-telemetry-verified`.

---

## Plan Self-Review

- Spec coverage: Task 1 creates the browser evidence boundary; Task 2 creates deterministic local browser production; Task 3 satisfies Tier 1 real telemetry; Task 4 binds Tier 2 official Sandbox to the same real telemetry path.
- Scope: each task is an independently reviewable and independently mergeable PR; no PR spans both repositories.
- Type consistency: browser evidence uses `sessionId`, `buildSha`, `gameVersion`, `platformMode`, and nullable `sdkVersion` consistently across all tasks.
- Security: all evidence outputs are allowlisted summaries; no endpoint, auth value, arbitrary upstream body, or raw SDK payload is stored.
- No placeholders or deferred implementation steps remain in this plan.
