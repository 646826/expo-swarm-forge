# Swarm Browser Game Starter - Design

## Purpose

Build a reusable, beginner-friendly browser-game starter that demonstrates a project-local SwarmForge team, then add a complete original match-3 example under `example/canyon-charms/`. The repository must be small enough to understand, polished enough to demonstrate a premium casual-game direction, and structured for an Arkadium-compatible static package.

The commit history must visibly preserve the requested order: the reusable starter reaches `main` before the example game is introduced.

## Success criteria

- `./swarm` launches a four-role project swarm after downloading SwarmForge shared scripts when they are missing.
- `npm run create -- my-game` copies a runnable project from `template/browser-game/`.
- `npm test`, `npm run check`, `npm run build`, and `npm run package` require Node.js 22 but no npm dependencies.
- `example/canyon-charms/` is a responsive, original, one-level match-3 game with deterministic rules, touch/mouse/keyboard input, procedural graphics, animation, synthesized sound, persistence, accessibility, reduced motion, and a thin Arkadium SDK boundary.
- GitHub Actions verifies pushes and pull requests, uploads a release ZIP, and deploys the example to GitHub Pages from `main`.
- A polished Russian PDF teaches school students how the starter, game architecture, SwarmForge handoffs, tests, and deployment work.

## Non-goals

- Do not copy source code, branding, art, audio, layouts, or level data from Wild West Match 2.
- Do not claim Arkadium acceptance or production publication. That requires platform access, metadata, credentials, review, and approval outside the repository.
- Do not add a backend, ads, accounts, payments, analytics credentials, proprietary SDK responses, or remote AI.
- Do not require Phaser, Vite, package installation, or external art/font/audio files.

## Approaches considered

### Phaser 4 + TypeScript + Vite

A strong production default for a larger 2D game and consistent with a broader Arkadium factory. It adds dependency installation and framework surface that would hide the small SwarmForge teaching example.

### Dependency-free Canvas 2D + ES modules (selected)

The smallest portable architecture that still supports a premium animated presentation. The domain remains pure and testable in Node, while Canvas 2D, CSS, DOM overlays, and Web Audio provide visual polish, accessibility, and a compact static package.

### DOM/CSS board

Fast to scaffold and naturally accessible, but less suitable for a high-impact animated board, particles, camera feedback, and compact rendering control.

## Repository shape

```text
.
├── swarm
├── swarmforge/
│   ├── swarmforge.conf
│   ├── constitution.prompt
│   ├── constitution/articles/
│   └── roles/
├── template/browser-game/
├── example/canyon-charms/
├── scripts/
├── docs/
├── artifacts/
└── .github/workflows/
```

Root scripts discover runnable projects by `game.config.json`, build static output, enforce release guardrails, package ZIP files, serve local previews, and scaffold copies of the template.

## SwarmForge topology

- `director` runs in the main checkout and owns user intent, specifications, sequencing, merges, and release decisions.
- `gameplay` runs in `.worktrees/gameplay` and owns deterministic rules, tests, scoring, and state transitions.
- `presentation` runs in `.worktrees/presentation` and owns rendering, animation, responsive input, sound, DOM UI, and accessibility without silently changing rules.
- `qa` runs in `.worktrees/qa` in batch mode and owns automated checks, browser smoke tests, release evidence, Arkadium packaging checks, and final feedback.

Normal handoff: `director -> gameplay -> presentation -> qa -> director`. Handoffs reference commits. Runtime handoff state remains untracked.

## Generic starter

The starter contains a fixed-step loop, a DPR-aware Canvas surface, explicit input actions, a small screen reducer (`title`, `playing`, `paused`, `result`), user-gesture Web Audio, local settings, an optional Arkadium lifecycle bridge with standalone fallback, tests, and a build config.

`npm run create -- <slug>` accepts only a safe lowercase slug, creates `games/<slug>/`, replaces title/slug tokens, and refuses an existing destination or path traversal.

## Example game: Canyon Charms

### Player fantasy and visual language

The player restores a frontier jeweler's display by matching glowing charms at sunset. The original procedural set contains turquoise rosettes, amber suns, garnet diamonds, silver stars, cactus blossoms, and horseshoes. The material language uses carved walnut, embossed leather, brass, desert light, dust, and jewel glow.

### Core loop

- 8 x 8 board with six normal tile kinds.
- A generated board begins with no automatic match and at least one legal move.
- Orthogonally adjacent tiles can be swapped by click/tap selection, swipe, or keyboard.
- Invalid swaps animate back and do not spend a move.
- Valid swaps spend one move and resolve simultaneous matches, gravity, refill, and cascades until stable.
- Four in a row creates a directional firecracker that clears its row or column when triggered.
- Five in a row or a merged T/L match creates dynamite that clears a 3 x 3 area.
- Cascades raise a combo multiplier and produce escalating visual/audio feedback.
- One level provides 20 moves and a 5,000-point target. Reaching the target wins; reaching zero moves below target loses.

### Screens and controls

- Title screen: Play, How to Play, Sound, Reduced Motion.
- Playing HUD: target, score, moves, combo, pause.
- Pause overlay and result overlay with Replay.
- Pointer/touch: tap two adjacent tiles or swipe.
- Keyboard: arrows move focus, Enter/Space select, Escape pauses, M toggles sound, R restarts after a result.
- An ARIA live region announces major state changes and a dynamic description summarizes the Canvas state.

### Presentation

- DPR-capped Canvas 2D and responsive portrait/landscape layouts.
- Multi-layer desert background, sun bloom, drifting dust, heat shimmer, board shadow, and vignette.
- Cached procedural tile art with bevels, highlights, symbol paths, shadows, hover/selection glows, squash/stretch, swap/drop easing, match flashes, trails, particles, combo banners, screen shake, and victory fireworks.
- Reduced-motion mode disables shake, animated parallax, heat shimmer, and dense particles while preserving readable feedback.
- Synthesized Web Audio starts only after interaction and suspends while hidden.

## Boundaries

`src/core/` owns serializable game state, board rules, match resolution, scoring, and deterministic randomness. It contains no DOM, Canvas, audio, storage, or Arkadium access.

`src/game/` owns animation phases, input translation, rendering, particles, and audio. It consumes core commands and presentation events.

`src/platform/` owns local persistence and the optional Arkadium connection. Missing or late platform APIs never block play.

DOM overlays own text-heavy menus/settings/accessibility; Canvas owns the playfield and visual effects.

## Error handling and release safety

- Boot failures reveal a readable error panel and normalize the stack.
- Invalid persisted data falls back to defaults.
- Arkadium calls are guarded, best-effort, ordered through a bounded queue, and have a standalone timeout.
- Visibility loss pauses simulation and audio.
- Build checks reject path traversal, absent entrypoints, unresolved local references, remote art/font/audio URLs, credential-like strings, `eval`, source maps in release packages, and output above the configured budget.

## Testing

Node unit tests cover seeded randomness, board generation, legal swaps, match groups, T/L merging, invalid rollback, gravity/refill, specials, cascades, scoring, reducer transitions, storage normalization, responsive layout, and the late-SDK lifecycle queue.

Static checks run `node --check`, resolve imports and HTML references, validate Canvas/ARIA/meta requirements, scan release safety rules, and enforce size budgets.

A Chromium smoke test verifies title -> play -> valid swap -> pause/resume -> settings -> restart, desktop and portrait screenshots, keyboard input, reduced motion, sound toggle, hidden-tab safety, and standalone SDK behavior.

## CI/CD and publication

GitHub Actions runs quality checks, tests, build, package, and Chromium smoke checks. On `main`, official GitHub Pages actions deploy `example/canyon-charms/dist` and upload the ZIP artifact. The expected public URL is `https://646826.github.io/expo-swarm-forge/` after Pages is enabled for GitHub Actions.

## Documentation

- `README.md`: five-minute start, live link, commands, structure, SwarmForge workflow, publication status.
- `docs/SWARMFORGE_GUIDE.md`: prerequisites, roles, handoffs, examples, troubleshooting.
- `docs/GAME_ARCHITECTURE.md`: core/presentation/platform boundaries and extension points.
- `docs/ARKADIUM_CHECKLIST.md`: submission-oriented checklist without credentials.
- `docs/QA_PLAN.md`: automated/manual verification.
- `docs/STUDENT_HANDBOOK_RU.pdf`: visual Russian handbook for students.

## Acceptance definition

A clean checkout must pass the complete CI command, produce a playable static build and ZIP, render the PDF without clipping, preserve the requested commit ordering on `main`, and expose either a verified public preview URL or an exact, honest repository-level Pages enablement blocker.
