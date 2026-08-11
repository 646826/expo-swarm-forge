# Swarm Browser Game Starter

A dependency-free teaching repository for building browser games with a project-local [SwarmForge](https://github.com/unclebob/swarm-forge) team.

The project keeps deterministic game rules separate from Canvas presentation, DOM UI, Web Audio, persistence, and publisher adapters. Its history intentionally lands the reusable starter before the complete game example.

> Русская пошаговая инструкция для школьников: [`docs/START_HERE_RU.md`](docs/START_HERE_RU.md)

## Play Canyon Charms

**[Play the current browser-verified release](https://cdn.staticdelivr.com/gh/646826/expo-swarm-forge/709a1556fda3fa7a1506d46ec704cc654308775b/example/canyon-charms/index.html)**

Canyon Charms is an original 8 × 8 match-3 game:

- score **5,000 points in 20 moves**;
- match three charms to clear them;
- match four to forge a row or column firecracker;
- match five, a T, or an L to forge dynamite;
- wait eight quiet seconds when you need an automatic hint.

The preview is pinned to an exact merged commit. GitHub Actions checks its HTML, both CSS files, JavaScript-module MIME types, dynamic application state, hidden boot-error surface, onboarding copy, and a real Chrome screenshot.

## Repository status

| Surface | Status |
|---|---|
| deterministic game rules | covered by Node tests |
| starter and example static builds | checked by `npm run verify` |
| starter and game ZIP packages | generated and uploaded by CI |
| Russian student handbook | generated and uploaded by CI |
| current-branch browser boot | verified in headless Chrome |
| immutable public preview | verified through StaticDelivr |
| canonical GitHub Pages URL | requires the one-time repository setting documented in [`docs/CANYON_CHARMS_DELIVERY.md`](docs/CANYON_CHARMS_DELIVERY.md) |
| Arkadium production publication | requires external Sandbox access, identifiers, credentials, review, and approval |

## Arkadium runtime configuration

Publisher integration is selected explicitly through one public manifest. The validator supports four modes:

```text
standalone
arkadium-sandbox
arkadium-dev
arkadium-prod
```

Start from one of the committed public examples:

```text
config/runtime.standalone.json
config/runtime.sandbox.example.json
```

The validator rejects unknown fields, accessors, symbol keys, invalid mode combinations, unsafe telemetry URLs, malformed build identifiers, and placeholder DEV or PROD identifiers. Credentials and DEV login values are never accepted as manifest fields and therefore cannot be copied into the browser bundle accidentally.

`arkadium-sandbox` uses the official DEV environment and Console analytics. Real assigned game IDs, App Insights configuration, DEV credentials, and production endpoints are added later through protected deployment configuration; they are not fabricated in source control.

## Local browser telemetry evidence

The ordinary standalone release remains network-silent because its committed runtime manifest has no Game Eye endpoint. A separately built, validated non-production candidate may supply a reviewed `/v1/game-events` endpoint. In that explicit configuration, adding `telemetryEvidence=1` to the URL installs the non-enumerable browser function:

```text
globalThis.__CANYON_TELEMETRY_EVIDENCE__()
```

The function returns a frozen allowlisted snapshot containing only the session ID, exact build and game versions, platform mode, nullable SDK version, structural lifecycle counts, queue counters, and the latest bounded delivery result. It does not expose the endpoint, request bodies, credentials, tokens, cookies, publisher profile or save data. Standalone evidence uses `sdkVersion: null`; reviewed Arkadium Sandbox and DEV evidence use exact SDK `2.66.2`. The API is never installed for `arkadium-prod`, without the explicit query opt-in, or when no real Game Eye sink exists, and it is removed during runtime destruction.

This browser snapshot is a correlation boundary, not by itself proof of persistence. The subsequent Workstream C gates bind it to real Ark Eye, NATS JetStream, the app-owned durable consumer, and ClickHouse evidence.

## Five-minute start

Requirements: Node.js 22 or newer. No package installation is required.

```bash
npm run verify
npm run serve -- example/canyon-charms/dist 4173
```

Open `http://127.0.0.1:4173`.

`npm run verify` runs the complete local quality gate:

1. all Node tests;
2. static checks for the starter and game;
3. deterministic starter and game ZIP packages;
4. the Russian student-handbook generator.

Create a new game from the reusable template:

```bash
npm run create -- my-game "My Game"
npm run check -- --project games/my-game
npm run serve -- games/my-game 4173
```

## Repository map

```text
template/browser-game/       reusable dependency-free starter
example/canyon-charms/       complete original match-3 game
packages/                    reusable integration contracts and validators
config/                      public runtime configuration examples
scripts/                     create, check, build, package, serve and verify commands
swarmforge/                  local roles, constitution and topology
docs/                        architecture, QA, classroom and publishing guides
tools/                       deterministic handbook generator
.github/workflows/           CI, Pages and public-preview verification
```

## SwarmForge workflow

Install `zsh`, `git`, `tmux`, Babashka (`bb`), and at least one supported coding-agent CLI. Then run:

```bash
./swarm
```

| Role | Owns |
|---|---|
| director | specification, slicing, integration, and release truth |
| gameplay | deterministic rules and unit tests |
| presentation | Canvas, DOM, input, animation, audio, and accessibility |
| qa | browser verification, screenshots, packages, and deployment evidence |

Normal flow:

```text
director → gameplay → presentation → qa → director
```

See [`docs/SWARMFORGE_GUIDE.md`](docs/SWARMFORGE_GUIDE.md).

## Command reference

```bash
npm test                                      # all Node tests
npm run check                                 # every discovered game
npm run check -- --project path/to/game       # one game
npm run build -- --project path/to/game       # static dist + SHA-256 report
npm run package -- --project path/to/game     # deterministic ZIP
npm run serve -- path/to/static/files 4173    # local preview
npm run verify                                # complete repository quality gate
```
