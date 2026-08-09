# Real Arkadium and Ark Eye Integration Design

**Status:** Architecture approved in conversation; written specification awaiting final review before implementation planning.

**Primary repository:** `646826/expo-swarm-forge`

**Related repositories:**

- `646826/arkadium-game-factory` — canonical typed publisher contract and official Arkadium SDK adapter.
- `646826/ark-eye` — real browser-ingest, NATS, and ClickHouse telemetry service.
- `646826/ads-monorepo` — existing Ark Eye advertising client. Its `/imp` contract remains advertising-only.

## 1. Purpose

Make Canyon Charms and the reusable browser-game starter ready for a real Arkadium integration without pretending that local stubs are publisher certification.

The finished system must support this progression without changing game rules or rewriting the integration layer:

```text
standalone local development
  -> official Arkadium Sandbox
  -> credential-gated Arkadium DEV
  -> approved Arkadium PROD configuration
```

The same candidate must emit a reviewed, privacy-safe game telemetry stream through a real local or deployed stack:

```text
browser -> Ark Eye game endpoint -> NATS JetStream -> writer -> ClickHouse
```

Only environment, publisher-assigned identifiers, deployment endpoints, and secrets change between Sandbox, DEV, and PROD.

## 2. Non-negotiable distinction: real demo versus mock

A build may be called **real-demo verified** only when all of the following are true:

1. It bundles the exact pinned official `@arkadiuminc/sdk` package.
2. It runs inside the official Arkadium Sandbox or an assigned Arkadium DEV environment.
3. Lifecycle and host pause/resume behavior are observed through the real SDK/RPC boundary.
4. Its game telemetry traverses a real Ark Eye process, real NATS JetStream, and real ClickHouse.
5. Evidence is bound to an immutable build SHA and SDK version.

Mocks remain useful for deterministic unit tests, failure injection, and offline development. Mock results are labelled `contract-test` and never satisfy Sandbox, DEV, telemetry, or release certification gates.

No shared or fabricated Arkadium credentials, `gameId`, App Insights identifier, user profile, Gems balance, or leaderboard result will be committed to source control.

## 3. Current state and gap

### 3.1 Canyon Charms today

`example/canyon-charms/src/platform/platform.js` currently discovers possible global objects and guesses method names. It queues lifecycle, score, and analytics calls and fails open when no host exists. This is a useful standalone fallback but is not a typed or version-bound Arkadium integration.

The current repository-wide `npm run verify` proves game rules, static builds, release ZIPs, the handbook, and a normal Chrome boot. It does not prove official SDK loading, Arkadium lifecycle order, host callbacks, Arkadium capabilities, or ClickHouse delivery.

### 3.2 Reusable production-oriented code already exists

`arkadium-game-factory` already contains:

- a typed `PublisherPlatform` contract;
- an exact official SDK loader;
- runtime SDK-version verification;
- lifecycle, host pause/resume, persistence, analytics, advertising, leaderboards, wallet, and redacted RPC diagnostics;
- a deterministic platform mock used only for contract tests.

The current baseline is `@arkadiuminc/sdk` version `2.66.2`. The integration must pin an exact version and use a controlled upgrade process; it must never use a floating range.

### 3.3 Ark Eye today

`ark-eye` is a real Bun service. Its existing advertising flow is:

```text
POST /imp -> NATS subject imp -> ClickHouse impression tables
```

The `/imp` schema is advertising-specific (`kind`, `provider`, `cpm`, `meta`) and its reports calculate impression revenue. Game lifecycle and gameplay events must not be disguised as advertising impressions. `/imp` remains unchanged.

## 4. Repository ownership and source of truth

### 4.1 `expo-swarm-forge`

Owns:

- Canyon Charms game rules and presentation;
- the game session controller;
- canonical game-event definitions;
- the publisher-neutral `PublisherPlatform` usage boundary;
- runtime configuration validation;
- browser and publisher integration workflows;
- release evidence and publisher package assembly.

### 4.2 `arkadium-game-factory`

Remains the source of truth for:

- `PublisherPlatform` contract semantics;
- the official Arkadium adapter;
- service policies for persistence, advertising, analytics, wallet, leaderboard, and RPC diagnostics.

For a self-contained educational repository, `expo-swarm-forge` will carry a deterministic vendor snapshot of the required packages. Its manifest has this exact shape:

```ts
interface ArkadiumSnapshotManifest {
  readonly schemaVersion: 1;
  readonly sourceRepository: '646826/arkadium-game-factory';
  readonly sourceCommit: string;
  readonly sdkVersion: '2.66.2';
  readonly files: Readonly<Record<string, string>>;
}
```

`sourceCommit` must match `^[0-9a-f]{40}$`. Every value in `files` must be a lowercase SHA-256 digest. The sync command writes the actual source commit and hashes; developers do not hand-edit them.

The implementation provides two commands:

```text
npm run arkadium:sync -- --source ../arkadium-game-factory
npm run arkadium:verify-snapshot
```

The first command updates the committed snapshot from a local checkout. The second checks every recorded hash and fails on drift. CI does not download mutable source at build time.

### 4.3 `ark-eye`

Owns:

- public game-event ingestion;
- strict schema and event-catalog validation;
- server stamps and safe request enrichment;
- JetStream publication and acknowledgement;
- durable consumption and ClickHouse insertion;
- deduplication, rate limits, retention, and query evidence.

## 5. Runtime architecture

### 5.1 Session controller

Canyon Charms gains a controller with explicit phases:

```text
new -> initializing -> ready -> playing -> ended -> destroyed
                         |          |
                         +-> paused <-+
```

The controller, not DOM event handlers or Canvas rendering code, owns publisher lifecycle calls.

Required ordering for one page load:

```text
initialize
signalReady                 exactly once
signalGameStart             at most once
signalLevelStart("1")       once per started level
signalScore(totalScore)     monotonically non-decreasing
signalLevelEnd("1")         once when the level ends
signalGameEnd(reason)       at most once
destroy                     idempotent
```

Host pause and resume callbacks update controller state, stop gameplay input, and suspend or resume audio. Browser visibility loss uses the same pause path but cannot duplicate outgoing lifecycle state.

Initialization and `signalReady` failures are boot-critical in Arkadium modes. Optional capability failures are redacted, recorded in diagnostics, and must not corrupt deterministic game state.

### 5.2 Platform modes

The build supports four explicit modes:

| Mode | SDK | Host | Analytics | Persistence and services |
|---|---|---|---|---|
| `standalone` | not loaded | none | local diagnostic sink | local settings/save only |
| `arkadium-sandbox` | exact official package | official Sandbox | official Console provider plus Game Eye | capabilities reported by Sandbox |
| `arkadium-dev` | exact official package | assigned DEV environment | assigned provider plus Game Eye | real assigned DEV capabilities |
| `arkadium-prod` | exact official package | approved production Arena | assigned App Insights plus approved Game Eye endpoint | production capabilities only |

Mode selection is explicit. Runtime object discovery is retained only inside the legacy standalone compatibility adapter and cannot silently switch a release into Arkadium mode.

### 5.3 Runtime configuration

A build step validates environment input and writes a public runtime manifest. It contains no user credentials or private tokens.

```ts
interface PublicRuntimeManifest {
  readonly schemaVersion: 1;
  readonly mode: 'standalone' | 'arkadium-sandbox' | 'arkadium-dev' | 'arkadium-prod';
  readonly arkadiumEnvironment: 'DEV' | 'STAGING' | 'PROD' | null;
  readonly gameId: string | null;
  readonly analyticsProvider: 'none' | 'console' | 'app-insights';
  readonly appInsightsId: string | null;
  readonly gameEyeEndpoint: string | null;
  readonly gameEyeProject: 'canyon-charms';
  readonly gameVersion: string;
  readonly buildSha: string;
}
```

Validation rules:

- `standalone` rejects Arkadium-only fields.
- `arkadium-sandbox` requires `DEV`, uses `console`, and forbids production analytics configuration.
- `arkadium-dev` requires an assigned non-placeholder game ID.
- `arkadium-prod` requires `PROD`, an assigned game ID, approved analytics configuration, an HTTPS telemetry endpoint, and an immutable build SHA.
- `buildSha` must match `^[0-9a-f]{40}$`.
- `gameVersion` must be a canonical semantic version.
- Placeholder-like values such as `demo`, `test`, `changeme`, all-zero identifiers, and empty strings fail DEV and PROD builds.
- DEV user credentials exist only as protected CI environment secrets and are never written into the runtime manifest.

## 6. Publisher platform contract

The game consumes a typed interface equivalent to the factory contract:

```ts
interface PublisherPlatform {
  readonly capabilities: PlatformCapabilities;
  initialize(): Promise<Result<PlatformContext>>;
  signalReady(): Promise<Result<void>>;
  signalGameStart(): Promise<Result<void>>;
  signalScore(score: number): Promise<Result<void>>;
  signalLevelStart(levelId: string): Promise<Result<void>>;
  signalLevelEnd(levelId: string): Promise<Result<void>>;
  signalGameEnd(reason: string): Promise<Result<void>>;
  onPause(handler: () => void): () => void;
  onResume(handler: () => void): () => void;
  loadSave<T extends SerializableValue>(): Promise<Result<T | null>>;
  writeSave<T extends SerializableValue>(save: T): Promise<Result<void>>;
  track(event: AnalyticsEvent): Promise<Result<void>>;
  showInterstitial(placement: string): Promise<Result<AdResult>>;
  showRewarded(placement: string): Promise<Result<RewardedAdResult>>;
  getWalletBalance(): Promise<Result<number>>;
  consumeCurrency(amount: number, transactionId: string): Promise<Result<WalletResult>>;
  submitLeaderboard(entry: LeaderboardSubmission): Promise<Result<void>>;
  destroy(): Promise<void>;
}
```

Capabilities are false until the official bridge initializes and confirms support. A configured policy does not by itself prove a capability.

The official SDK may be imported only from its package root through one reviewed loader. The loader checks the runtime version against the committed snapshot before returning the SDK instance.

## 7. Canonical event model

The game creates one canonical event and sends it through a fan-out dispatcher. Individual sinks cannot invent names or reshape game facts independently.

```ts
interface CanonicalGameEvent {
  readonly name: GameEventName;
  readonly version: 1;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly properties: Readonly<Record<string, string | number | boolean | null>>;
}
```

Initial allowlisted catalog:

```text
sdk_initialize_started
sdk_initialize_succeeded
sdk_ready
game_start
level_start
move_rejected
move_accepted
score_changed
pause
resume
level_end
game_end
save_load
save_write
ad_request
ad_result
leaderboard_submit
wallet_balance
wallet_consume_result
integration_error
```

Each catalog entry defines:

- exact property names and primitive types;
- maximum string lengths and numeric ranges;
- whether it is sent to Arkadium Analytics;
- whether it is sent to Game Eye;
- whether it is allowed in PROD;
- whether sampling is permitted.

Raw save data, profiles, tokens, credentials, email addresses, usernames, cookie values, App Insights identifiers, raw SDK errors, and wallet transaction identifiers are forbidden event properties.

## 8. Dual telemetry sinks

### 8.1 Arkadium Analytics sink

Maps only publisher-approved gameplay events to the versioned Arkadium analytics policy. Sandbox uses the official Console provider. DEV and PROD use the assigned provider only when configuration succeeds.

Unknown events, unknown properties, sensitive dimensions, non-finite numbers, and oversized strings fail before an SDK call.

### 8.2 Game Eye sink

Batches canonical events and sends them with `fetch(..., { keepalive: true })` or `navigator.sendBeacon` during unload. Queue size and retry count are bounded. Failure never blocks gameplay, but the integration diagnostics panel and CI evidence report delivery state.

A valid example tied to the current clarified Canyon Charms release is:

```json
{
  "schema": "ark.game-events.v1",
  "project": "canyon-charms",
  "gameVersion": "1.0.0",
  "buildSha": "709a1556fda3fa7a1506d46ec704cc654308775b",
  "platformMode": "arkadium-sandbox",
  "sdkVersion": "2.66.2",
  "sessionId": "01234567-89ab-4cde-8f01-23456789abcd",
  "locale": "en-US",
  "userState": "anonymous",
  "events": [
    {
      "eventId": "11111111-2222-4333-8444-555555555555",
      "sequence": 1,
      "occurredAt": "2026-08-09T20:00:00.000Z",
      "name": "game_start",
      "version": 1,
      "properties": { "levelId": "1" }
    }
  ]
}
```

The public `project` value is routing metadata, not a secret or authentication credential.

## 9. Ark Eye game-events pipeline

### 9.1 New endpoint

`ark-eye` adds `POST /v1/game-events`. Existing `/imp` behavior and tables remain unchanged.

The endpoint:

- accepts `application/json` only;
- accepts 1 to 32 events per request;
- enforces a 64 KiB request limit;
- validates plain JSON data without invoking accessors;
- validates the exact event catalog and event version;
- verifies UUIDs, sequence ordering, timestamps, build SHA, game version, mode, locale, and user state;
- rejects identity and sensitive fields recursively;
- applies an explicit CORS origin allowlist;
- applies per-origin and per-IP rate limits while never storing the IP;
- stamps `receivedAt`, origin, user-agent-derived device category, browser, and country when available;
- publishes each event to JetStream and returns success only after every acknowledgement;
- returns stable redacted errors.

### 9.2 Durable transport

A dedicated JetStream stream is used:

```text
stream: GAME_EVENTS_V1
subject: game.events.v1
retention: limits
max age: 72 hours
message id: eventId
```

The collector sets the NATS message ID so JetStream duplicate suppression can reject retransmitted events.

A separate durable writer consumes acknowledged messages, validates them again, inserts bounded batches into ClickHouse, and acknowledges NATS messages only after a successful insert.

### 9.3 ClickHouse table

The initial table is append-oriented and privacy-minimal:

```sql
CREATE TABLE game_event_v1
(
    received_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    event_id UUID,
    session_id UUID,
    sequence UInt32,
    project LowCardinality(String),
    game_version LowCardinality(String),
    build_sha FixedString(40),
    platform_mode LowCardinality(String),
    sdk_version Nullable(LowCardinality(String)),
    locale LowCardinality(String),
    user_state LowCardinality(String),
    event_name LowCardinality(String),
    event_version UInt16,
    origin LowCardinality(String),
    country Nullable(LowCardinality(String)),
    device_category Nullable(LowCardinality(String)),
    browser_name Nullable(LowCardinality(String)),
    browser_version Nullable(LowCardinality(String)),
    properties_json String
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(received_at)
ORDER BY (project, toDate(received_at), session_id, sequence, event_id)
TTL received_at + INTERVAL 180 DAY DELETE;
```

No Arkadium account identifier, email, token, raw cookie, exact IP address, save payload, or wallet transaction identifier is stored.

Materialized views provide:

- lifecycle-order violations by session;
- first-session funnel (`sdk_ready -> game_start -> level_start -> level_end -> game_end`);
- move acceptance and rejection rates;
- score and completion distributions;
- SDK version and integration-error rates;
- browser/device performance evidence.

## 10. Diagnostics surface

Development and Sandbox builds may enable `?integrationDebug=1`. The panel displays only structural data:

- build SHA and game version;
- platform mode and exact SDK version;
- locale and coarse user state;
- capability flags;
- lifecycle phase and ordered call names;
- Game Eye queue count and last redacted outcome;
- evidence session ID.

The panel never displays credentials, SDK payloads, profiles, save contents, App Insights identifiers, cookies, raw request IDs, or wallet transaction IDs. It is unavailable in PROD builds.

## 11. Verification tiers

### Tier 0 — deterministic contract tests

Mocks are allowed. Tests cover controller phases, exactly-once lifecycle, monotonically increasing score, capability gating, event schemas, redaction, retry bounds, and failure behavior.

Evidence label: `contract-test`.

### Tier 1 — real local telemetry integration

Docker Compose starts real instances of:

```text
NATS with JetStream
ClickHouse
Ark Eye collector
Ark Eye writer
Canyon Charms static server
Chromium
```

A browser scenario boots the game, performs one rejected move, performs accepted moves, pauses/resumes, and completes or ends a deterministic level. The test queries ClickHouse and verifies event IDs, order, properties, build SHA, and zero forbidden fields.

Evidence label: `real-local-telemetry`.

### Tier 2 — official Arkadium Sandbox

An immutable candidate is loaded into the official Sandbox. The workflow or controlled manual run verifies:

- the exact official SDK version;
- ready, game start, score, level start/end, and game end indicators;
- incoming host pause/resume;
- anonymous, registered, and subscriber Sandbox modes;
- supported and unsupported capability behavior;
- advertising paths when the Sandbox exposes them;
- Console analytics events;
- Game Eye delivery for the same evidence session.

Evidence label: `official-sandbox`.

### Tier 3 — credential-gated Arkadium DEV

A manual GitHub Environment workflow uses protected DEV credentials that are never bundled. It adds:

- real authenticated user classification;
- real remote persistence reconciliation;
- real leaderboard support and submission when assigned;
- real wallet support and a publisher-approved non-destructive test when assigned;
- assigned analytics provider initialization;
- immutable candidate and RPC diagnostics binding.

Evidence label: `arkadium-dev`.

### Tier 4 — release candidate

A release may be called `integration-ready` only when Tier 0 and Tier 1 pass and current Tier 2 evidence is attached. Capabilities that require assigned DEV access remain explicitly blocked until Tier 3 passes.

Production publication additionally requires publisher approval and cannot be asserted by repository CI alone.

## 12. CI workflows and commands

The implementation adds these commands:

```text
npm run verify
npm run verify:arkadium-contract
npm run arkadium:verify-snapshot
npm run verify:telemetry-integration
npm run verify:publisher-package
```

Workflows:

```text
.github/workflows/ci.yml
.github/workflows/telemetry-integration.yml
.github/workflows/arkadium-sandbox.yml
.github/workflows/arkadium-dev.yml
.github/workflows/publisher-package.yml
```

`arkadium-dev.yml` is manual and protected by a GitHub Environment. Fork pull requests cannot access its secrets.

## 13. Required evidence bundle

Every integration candidate produces:

```text
evidence/manifest.json
evidence/sdk-contract.json
evidence/lifecycle.json
evidence/canonical-events.json
evidence/clickhouse-query.json
evidence/telemetry-delivery.json
evidence/browser-desktop.png
evidence/browser-mobile.png
evidence/browser-console.log
evidence/performance.json
evidence/build-report.json
evidence/artifact-sha256.txt
```

Sandbox and DEV runs add:

```text
evidence/sandbox-status.json
evidence/sandbox-events.json
evidence/rpc-diagnostics.json
evidence/dev-capabilities.json
```

Each evidence file includes the exact build SHA, game version, SDK version, timestamp, workflow run ID, and evidence level. Evidence older than the configured release window cannot certify a newer candidate.

## 14. Performance and packaging gates

The publisher package gate verifies:

- no remote runtime art, fonts, or audio;
- no source maps or secrets;
- iframe boot without console errors;
- ready-to-interact within five seconds in the CI profile;
- sustained frame rate of at least 30 FPS in the supported CI profile;
- responsive layouts covering aspect ratios from 2:1 through 1:2;
- audio suspension on host pause and visibility loss;
- save envelopes below the stricter project limit, which remains below the publisher maximum;
- exact SDK package and license inventory;
- immutable artifact SHA-256.

## 15. Failure and fallback rules

- Standalone mode remains playable when no publisher is present.
- Arkadium modes never silently downgrade to standalone.
- Official SDK initialization or ready failure displays a redacted integration error and prevents a false-ready state.
- Analytics and Game Eye failures do not change game rules, score, or save state.
- Persistence keeps the safest available local copy when remote access fails.
- Advertising, wallet, and leaderboard buttons or flows are absent when the corresponding capability is false.
- Ambiguous wallet transactions are never retried automatically.
- Unknown events, unknown capabilities, unknown SDK versions, and unknown configuration fields fail closed.

## 16. Security and privacy

- No credentials are committed or placed in browser bundles.
- No browser-visible value is treated as a secret.
- DEV credentials are restricted to protected manual CI jobs.
- CORS uses an allowlist, not reflected arbitrary origins.
- Request sizes, batch sizes, queue sizes, retries, and diagnostic retention are bounded.
- Logs and evidence use stable redacted errors.
- Game Eye stores no exact IP address or direct Arkadium identity.
- Production analytics fields require an allowlisted schema review.
- Dependency and SDK upgrades require a manifest update, snapshot refresh, tests, and new Sandbox evidence.

## 17. Implementation workstreams

The system design is intentionally cross-repository, but implementation planning is split into three independently reviewable plans.

### Workstream A — publisher platform in `expo-swarm-forge`

Delivers the vendor snapshot, exact SDK build, runtime configuration, session controller, canonical events, Arkadium adapter, Sandbox diagnostics, and contract tests. It can land before Ark Eye changes by using a bounded in-memory Game Eye test sink.

### Workstream B — game telemetry in `ark-eye`

Delivers the game-event schema, `/v1/game-events`, JetStream stream, durable writer, ClickHouse migration, materialized views, rate limits, redaction, and service-level tests. It does not modify `/imp`.

### Workstream C — cross-repository evidence and release gates

Delivers Docker Compose integration, browser scenarios, ClickHouse assertions, official Sandbox evidence, protected DEV workflow, publisher package, and release manifest. It begins only after Workstreams A and B expose their reviewed interfaces.

Each workstream receives its own implementation plan. Changes land as small ordered pull requests; no single pull request spans all three workstreams.

## 18. Rollout sequence

1. Import and verify the typed platform snapshot and exact official SDK.
2. Refactor Canyon Charms lifecycle into the session controller without changing game rules.
3. Add canonical event definitions and dual-sink dispatch.
4. Add `/v1/game-events`, JetStream transport, writer, and ClickHouse migration in `ark-eye`.
5. Add the real local telemetry integration environment and evidence queries.
6. Add official Sandbox verification and evidence capture.
7. Add protected Arkadium DEV verification.
8. Assemble the publisher package and update the classroom and delivery documentation.

The game-core tests remain unchanged unless a genuine game-rule defect is discovered.

## 19. Acceptance criteria

The implementation is accepted when:

1. Canyon Charms has no guessed-method Arkadium path in publisher modes.
2. The official SDK is pinned, bundled, and runtime-version checked.
3. Lifecycle ordering and exactly-once rules are enforced by a controller and tests.
4. Host pause/resume controls gameplay and audio.
5. Capabilities are runtime-confirmed and unavailable features stay hidden.
6. Canonical events feed Arkadium Analytics and Game Eye without divergent names or values.
7. `/imp` remains advertising-only.
8. A real local browser scenario reaches ClickHouse through Ark Eye and JetStream.
9. The official Sandbox produces build-bound lifecycle and browser evidence.
10. DEV-only capabilities are honestly marked blocked until protected DEV evidence exists.
11. One publisher-package command produces the game, manifests, evidence, hashes, and integration report.
12. No credential, identity, save payload, or sensitive SDK data appears in source, logs, ClickHouse, or downloadable evidence.

## 20. External dependencies that remain real blockers

The repository can fully prepare and verify the integration architecture without publisher secrets. The following cannot be manufactured and remain external release inputs:

- Arkadium-assigned DEV and PROD game identifiers;
- protected DEV user credentials;
- assigned analytics/App Insights configuration;
- title-specific ads, Gems, wallet, leaderboard, and remote-persistence enablement;
- legal, privacy, monetization, publisher review, and production approval.

The absence of these values blocks only their corresponding DEV or production evidence tier. It does not justify replacing them with fake success responses.