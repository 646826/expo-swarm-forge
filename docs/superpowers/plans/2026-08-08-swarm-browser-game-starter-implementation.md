# Swarm Browser Game Starter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free SwarmForge browser-game starter, a polished original match-3 example named Canyon Charms, a tested release pipeline, and a Russian student handbook.

**Architecture:** Pure ES-module domain code owns deterministic game state. Canvas/Web Audio/input modules own presentation. DOM overlays own text-heavy UI and accessibility. A guarded platform adapter owns optional Arkadium lifecycle calls. Node.js root scripts create, check, test, build, package, serve, and smoke-test projects.

**Tech Stack:** JavaScript ES2023 modules, HTML5 Canvas 2D, DOM/CSS, Web Audio, Node.js 22 built-ins, `node:test`, Chromium/Playwright, GitHub Actions, ReportLab.

## Global Constraints

- Runtime dependencies: zero.
- Node.js version: 22 or newer.
- Do not copy Wild West Match 2 code, branding, art, audio, layouts, or level data.
- Do not commit credentials, proprietary SDK responses, generated SwarmForge state, worktrees, or `dist/` folders.
- All game visuals and sound are procedural and repository-owned.
- The template commit must precede every commit that introduces `example/canyon-charms/`.
- The production game build budget is 750,000 bytes uncompressed.
- Standalone play must continue when the Arkadium SDK is missing, slow, or rejects a call.

---

## File map

### Root

- `package.json`: command surface.
- `scripts/project-lib.mjs`: discovery, config, copy, hashing, MIME, and process helpers.
- `scripts/create-game.mjs`: safe scaffold generator.
- `scripts/check.mjs`: syntax, imports, HTML, remote-asset, secret, and budget checks.
- `scripts/run-tests.mjs`: discovers all `test/*.test.js` files and invokes `node --test`.
- `scripts/build.mjs`: deterministic copy build and SHA-256 report.
- `scripts/package.mjs`: deterministic release ZIP.
- `scripts/serve.mjs`: local static server.
- `scripts/smoke.mjs`: Chromium/Playwright smoke and screenshot evidence.

### SwarmForge

- `swarm`: upstream-compatible bootstrap wrapper.
- `swarmforge/swarmforge.conf`: director/gameplay/presentation/qa topology.
- `swarmforge/constitution.prompt`: article loader.
- `swarmforge/constitution/articles/*.prompt`: project, engineering, workflow rules.
- `swarmforge/roles/*.prompt`: role contracts.

### Template

- `template/browser-game/index.html`, `styles.css`, `game.config.json`.
- `template/browser-game/src/state.js`: pure screen/settings reducer.
- `template/browser-game/src/loop.js`: fixed-step loop.
- `template/browser-game/src/canvas.js`: DPR-aware surface.
- `template/browser-game/src/audio.js`: user-gesture synthesized sound.
- `template/browser-game/src/platform.js`: guarded standalone/Arkadium bridge.
- `template/browser-game/src/main.js`: composition and boot error boundary.
- `template/browser-game/test/state.test.js`: reducer tests.

### Canyon Charms

- `src/core/random.js`: deterministic PRNG.
- `src/core/board.js`: board creation/access/swap/legal-move/gravity/refill.
- `src/core/matches.js`: match groups, merged intersections, specials.
- `src/core/game-state.js`: turn resolution, cascades, scoring, result.
- `src/game/layout.js`: responsive geometry.
- `src/game/controller.js`: animation phases and input lock.
- `src/game/input.js`: pointer/swipe/keyboard action map.
- `src/game/particles.js`: bounded particle pool.
- `src/game/renderer.js`: procedural Canvas presentation.
- `src/game/audio.js`: synthesized effects/ambience.
- `src/platform/storage.js`: schema-checked settings/best score.
- `src/platform/arkadium.js`: bounded late-connection lifecycle queue.
- `src/ui/strings.js`: visible and accessibility copy.
- `src/main.js`: app composition and error boundary.
- `test/*.test.js`: domain/layout/storage/platform tests.

---

### Task 1: Create and commit the reusable starter

**Files:** root scripts, SwarmForge files, and `template/browser-game/**`.

**Interfaces:**
- `readProjectConfig(projectDir) -> Promise<ProjectConfig>`.
- `discoverProjects() -> Promise<string[]>`.
- `buildProject(projectDir) -> Promise<BuildReport>`.
- `createInitialState() -> StarterState`.
- `reduceState(state, action) -> StarterState`.

- [ ] **Step 1: Write the failing starter reducer test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduceState } from '../src/state.js';

test('starter follows title, play, pause, resume, and result', () => {
  let state = createInitialState();
  state = reduceState(state, { type: 'START' });
  state = reduceState(state, { type: 'PAUSE' });
  assert.equal(state.screen, 'paused');
  state = reduceState(state, { type: 'RESUME' });
  state = reduceState(state, { type: 'FINISH', score: 1200 });
  assert.deepEqual({ screen: state.screen, score: state.score }, { screen: 'result', score: 1200 });
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test template/browser-game/test/state.test.js`

Expected: failure because `src/state.js` does not exist.

- [ ] **Step 3: Implement the minimal reducer**

```js
export const createInitialState = () => ({
  screen: 'title', score: 0, elapsed: 0, sound: true, reducedMotion: false,
});

export function reduceState(state, action) {
  switch (action.type) {
    case 'START': return { ...state, screen: 'playing', score: 0, elapsed: 0 };
    case 'PAUSE': return state.screen === 'playing' ? { ...state, screen: 'paused' } : state;
    case 'RESUME': return state.screen === 'paused' ? { ...state, screen: 'playing' } : state;
    case 'FINISH': return { ...state, screen: 'result', score: Math.max(0, Math.round(action.score)) };
    case 'TOGGLE_SOUND': return { ...state, sound: !state.sound };
    case 'TOGGLE_MOTION': return { ...state, reducedMotion: !state.reducedMotion };
    default: return state;
  }
}
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test template/browser-game/test/state.test.js`

Expected: one passing test, zero failures.

- [ ] **Step 5: Implement root tooling and shell**

`game.config.json` must contain `slug`, `title`, `entry`, `output`, and `buildBudgetBytes`. The create script accepts `/^[a-z][a-z0-9-]{1,39}$/`, writes under `games/<slug>/`, replaces `__GAME_SLUG__` and `__GAME_TITLE__`, and refuses existing paths. The build copies only required static files and writes SHA-256 hashes to `build-report.json`.

- [ ] **Step 6: Implement SwarmForge configuration**

Use:

```conf
window director codex master
window gameplay codex gameplay
window presentation codex presentation
window qa codex qa batch
```

The wrapper downloads upstream `main` scripts only when missing, copies shared constitution articles, and executes `swarmforge/scripts/swarmforge.sh`.

- [ ] **Step 7: Verify starter commands**

Run:

```bash
npm run check -- --project template/browser-game
npm test
npm run build -- --project template/browser-game
npm run package -- --project template/browser-game
```

Expected: all commands exit 0, with `template/browser-game/dist/build-report.json` and `release/browser-game-starter.zip`.

- [ ] **Step 8: Commit starter before example**

```bash
git add .
git commit -m "feat: add SwarmForge browser game starter"
```

Verify: `git ls-tree -r --name-only HEAD | grep '^example/'` returns no output.

---

### Task 2: Implement deterministic board primitives with TDD

**Files:** `example/canyon-charms/src/core/random.js`, `board.js`, `matches.js`; tests for each.

**Interfaces:**
- `createRng(seed) -> () => number`.
- `createBoard({ rows, cols, kinds, rng }) -> Board`.
- `findMatches(board) -> MatchGroup[]`.
- `hasLegalMove(board) -> boolean`.
- Tile: `{ id, kind, special: null | 'row' | 'column' | 'dynamite' }`.

- [ ] **Step 1: Write and run failing PRNG reproducibility test**

```js
const a = createRng(12345);
const b = createRng(12345);
assert.deepEqual(Array.from({ length: 8 }, a), Array.from({ length: 8 }, b));
```

Run: `node --test example/canyon-charms/test/random.test.js`

Expected: missing module failure.

- [ ] **Step 2: Implement Mulberry32 and verify GREEN**

```js
export function createRng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 3: Write failing board/match tests**

Assert: 8 x 8 length, no initial matches, at least one legal move, orthogonal adjacency only, horizontal/vertical runs, five-cell runs, and a merged T/L group.

- [ ] **Step 4: Implement board/match primitives and verify**

The generator avoids matching two left or two above while filling, then regenerates until `hasLegalMove` is true. Run `node --test example/canyon-charms/test/random.test.js example/canyon-charms/test/board.test.js example/canyon-charms/test/matches.test.js` and expect all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add example/canyon-charms
git commit -m "feat: add deterministic Canyon Charms board"
```

---

### Task 3: Implement turns, cascades, specials, and scoring with TDD

**Files:** `src/core/game-state.js`, updates to board/matches, `test/game-state.test.js`, `test/specials.test.js`.

**Interfaces:**
- `createGame(seed, options) -> GameState`.
- `attemptSwap(state, from, to) -> TurnResult`.
- `resolveCascade(board, rng, preferredCell) -> CascadeResult`.
- `TurnResult.phases` contains `swap`, `swap-back`, `clear`, `drop`, `refill`, and `settle` records.

- [ ] **Step 1: Write invalid-swap RED test**

Assert that a non-matching adjacent swap returns `accepted: false`, restores the original kinds, emits `swap` and `swap-back`, and preserves moves.

- [ ] **Step 2: Implement minimal swap acceptance and verify GREEN**

A valid swap must create a match involving at least one swapped cell. Spend one move exactly once, then resolve until stable.

- [ ] **Step 3: Write special RED tests**

Assert: horizontal four creates `row`, vertical four creates `column`, five/T/L creates `dynamite`, row/column activation expands the clear set, dynamite expands to in-bounds 3 x 3, and chained specials activate once.

- [ ] **Step 4: Implement specials and score**

Use `base = normalClears * 80 + activatedSpecials * 240`; award `base * comboDepth`. Initial moves: 20. Target: 5,000. Result is `won` at target or `lost` after a stable cascade with zero moves.

- [ ] **Step 5: Verify and commit**

Run: `node --test example/canyon-charms/test/*.test.js`.

Commit: `feat: add cascades specials and scoring`.

---

### Task 4: Add layout, animation controller, and input

**Files:** `src/game/layout.js`, `controller.js`, `input.js`; layout/controller tests.

**Interfaces:**
- `computeLayout(width, height, dpr) -> Layout`.
- `GameController.start()`, `update(dt)`, `handle(action)`, `snapshot()`.
- Normalized actions: `BOARD_SELECT`, `BOARD_SWAP`, `PAUSE_TOGGLE`, `SOUND_TOGGLE`, `MOTION_TOGGLE`, `RESTART`, `SHOW_HELP`.

- [ ] **Step 1: Write RED tests**

Assert animation input locking, invalid swap-back order, final-state commit after phases, landscape geometry at 1280 x 720, portrait geometry at 390 x 844, minimum 42 CSS-pixel tile hit area, and no viewport overflow.

- [ ] **Step 2: Implement controller/layout/input**

Durations: swap 160 ms, swap-back 140 ms, clear 220 ms, drop 260 ms, refill 240 ms. Reduced motion clamps non-zero phase duration to 60 ms. Swipe threshold: 18 CSS pixels with dominant orthogonal direction.

- [ ] **Step 3: Verify and commit**

Run focused tests, then commit `feat: add controller and responsive input`.

---

### Task 5: Build the original premium presentation

**Files:** `index.html`, `styles.css`, `src/game/renderer.js`, `particles.js`, `src/ui/strings.js`.

**Interfaces:**
- `Renderer.render(snapshot, now)`.
- `ParticlePool.emit(effect)`, `update(dt)`, `draw(ctx)`.

- [ ] **Step 1: Implement accessible DOM shell**

Include Canvas, loading/error panel, title/menu controls, pause/result overlays, help dialog, ARIA live region, dynamic Canvas description, version meta, and empty Arkadium App Insights meta. Do not load external art, fonts, styles, or audio.

- [ ] **Step 2: Implement renderer**

Draw cached sky/mesa/rock layers, sun bloom, dust, heat shimmer, walnut/brass/leather frame, six jewel symbols, score cards, selection/focus, swap/drop/refill easing, match flashes, firecracker beam, dynamite shockwave, combo banners, score flyups, shake, and victory fireworks.

- [ ] **Step 3: Implement reduced motion and bounded particles**

Normal pool limit: 320. Reduced motion: at most 40, static parallax, no shake/heat shimmer/fireworks, one victory glow.

- [ ] **Step 4: Run static check and commit**

Run `npm run check -- --project example/canyon-charms`; commit `feat: add premium procedural presentation`.

---

### Task 6: Add sound, persistence, Arkadium bridge, and boot composition

**Files:** `src/game/audio.js`, `src/platform/storage.js`, `arkadium.js`, `src/main.js`; storage/bridge tests.

**Interfaces:**
- `AudioDirector.unlock()`, `setMuted()`, `play(name, intensity)`, `suspend()`, `resume()`.
- `loadProgress(storage)`, `saveProgress(storage, progress)`.
- `ArkadiumBridge.initialize()`, `markReady()`, `gameStart()`, `levelStart()`, `scoreChanged()`, `levelEnd()`, `gameEnd()`, `bindPauseHandlers()`.

- [ ] **Step 1: Write persistence RED tests**

Invalid JSON, wrong types, out-of-range scores, and unknown schema versions must return defaults. Valid settings and best score survive round-trip.

- [ ] **Step 2: Implement storage and synthesized audio**

Create short oscillator/noise envelopes for select, invalid, swap, match, cascade, firecracker, dynamite, win, and lose. Unlock only on interaction; suspend on hidden document.

- [ ] **Step 3: Write late-SDK RED test**

Queue lifecycle calls before a fake loader resolves. Assert ordered flush of `onTestReady`, `onGameStart`, `onLevelStart`, score, level end, and game end. Queue maximum: 64.

- [ ] **Step 4: Implement Arkadium adapter**

Use `https://developers.arkadium.com/cdn/sdk/v2/sdk.js`, support `?standalone=1`, initial timeout 1,800 ms, late connection, guarded method lookup, and no gameplay blocking.

- [ ] **Step 5: Compose boot and verify**

Announce state/score/moves/invalid/combo/result/settings changes. Reveal error panel on exception and report best-effort. Run all example tests/check/build and commit `feat: complete Canyon Charms vertical slice`.

---

### Task 7: Add release checks, CI, Pages, and browser smoke evidence

**Files:** `.github/workflows/ci-pages.yml`, `scripts/smoke.mjs`, `docs/QA_PLAN.md`, `docs/ARKADIUM_CHECKLIST.md`, README updates.

- [ ] **Step 1: Expand release guardrails**

Fail for missing Canvas/live region/meta, `eval`, secret-like keys, remote image/font/audio URLs, unresolved local references, source maps in ZIP, files above budget, or absolute local paths.

- [ ] **Step 2: Implement Playwright smoke**

Launch local server and Chromium, load `?standalone=1&seed=424242`, click Play, perform a deterministic legal swap through a debug-safe query action, pause/resume, toggle motion, capture desktop/portrait screenshots, and assert no console/page errors.

- [ ] **Step 3: Add CI/Pages workflow**

`quality` uses checkout, Node 22, Chromium, `npm run ci`, and uploads release/evidence artifacts. `deploy` runs only on `main`, uses official Pages actions, and deploys `example/canyon-charms/dist`.

- [ ] **Step 4: Verify and commit**

Run `npm run ci`; commit `ci: verify package and deploy game preview`.

---

### Task 8: Write documentation and generate the Russian student PDF

**Files:** `README.md`, `docs/SWARMFORGE_GUIDE.md`, `docs/GAME_ARCHITECTURE.md`, `docs/ARKADIUM_CHECKLIST.md`, `docs/QA_PLAN.md`, `docs/STUDENT_HANDBOOK_RU.pdf`, `artifacts/*.png`, `scripts/make-handbook.py`.

- [ ] **Step 1: Write complete Markdown guides**

Include exact prerequisites, five-minute start, scaffold command, role responsibilities, handoff examples, architecture/data flow, testing, build/package, Pages, Arkadium submission limits, and extension exercises.

- [ ] **Step 2: Generate PDF with ReportLab**

Use game screenshots and original diagrams. Required sections: cover, what we build, repository map, SwarmForge roles, handoff flow, core loop, board algorithm, rendering layers, accessibility, tests, CI/CD, Arkadium checklist, exercises, glossary. Use a Cyrillic-capable system font but never copy font files into the deliverables.

- [ ] **Step 3: Render and inspect the PDF**

Run `/home/oai/skills/pdfs/scripts/render_pdf.py docs/STUDENT_HANDBOOK_RU.pdf --out_dir /mnt/data/handbook-renders --dpi 160`. Inspect every page for clipping, overlap, black squares, broken Cyrillic, and unreadable screenshots. Correct and re-render until clean.

- [ ] **Step 4: Verify docs links and commit**

Run `npm run check`, then commit `docs: add complete guides and student handbook`.

---

### Task 9: Final verification, main history, remote publication

- [ ] **Step 1: Run fresh full verification**

```bash
npm run ci
npm run package -- --project example/canyon-charms
git status --short
git log --oneline --reverse
```

Expected: zero failures, clean tree, and starter commit before first example commit.

- [ ] **Step 2: Fast-forward local main**

Merge the implementation branch with `--ff-only`; no squashing, so history order is preserved.

- [ ] **Step 3: Push snapshots to `646826/expo-swarm-forge` main**

Create remote commits in local order using Git data objects. Verify each remote commit SHA and final file contents.

- [ ] **Step 4: Verify GitHub Actions and preview**

Inspect final commit checks/workflow runs. Open `https://646826.github.io/expo-swarm-forge/` and verify a successful game response and title. If Pages is repository-disabled, report the exact enablement requirement and provide the committed workflow plus a fallback raw.githack preview URL only after verifying it.

- [ ] **Step 5: Deliver artifacts**

Provide repository, playable preview, PDF, screenshots, ZIP, verification summary, commit sequence, and the honest Arkadium submission status.
