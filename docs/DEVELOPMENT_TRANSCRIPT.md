# Development Transcript

This is the durable, reviewable record of how the starter and reference game were delivered. Runtime SwarmForge inboxes and tmux state remain local and are never committed.

## Milestone 0 — design

**Director**

- Interpreted the request as a reusable SwarmForge game starter plus one original casual match-3 example.
- Compared Phaser and a dependency-free Canvas lane.
- Chose Canvas for the teaching example while preserving a renderer-independent domain that can later move to Phaser.
- Wrote the design specification and requested review before implementation.

**Approved constraints**

- Starter must enter `main` before the example.
- No copied Wild West Match 2 assets or implementation.
- No credentials or fabricated Arkadium claims.
- Node 22, zero runtime dependencies and a 750,000-byte build budget.

## Milestone 1 — reusable starter

**Gameplay handoff**

```text
type: git_handoff
to: presentation
priority: 20
task: reusable-browser-game-starter
commit: <starter-commit>
```

**Presentation**

- Added the fixed-step loop, DPR Canvas, DOM shell, user-gesture audio and optional platform bridge.
- Kept state transitions outside the renderer.

**QA**

- Verified scaffold creation, path traversal rejection, static checks, test discovery, deterministic build reports and ZIP integrity.
- Confirmed the milestone contained no `example/` files.

**Director**

- Opened a focused pull request and merged the starter to `main` before beginning the game example.

## Milestone 2 — Canyon Charms

**Gameplay**

- Wrote failing tests for seeded randomness, board construction, legal moves, matches and honest invalid swaps.
- Implemented only enough rule code to pass each slice.
- Added cascades, score, firecrackers, dynamite, chained activation and result states.

**Presentation**

- Consumed semantic turn phases rather than changing game rules.
- Added a western jewel visual language using runtime Canvas paths and gradients.
- Added pointer, swipe, keyboard, DOM overlays, synthesized audio, particles, responsive layouts and reduced motion.

**QA**

- Exercised desktop and phone routes.
- Checked invalid and valid swaps, pause/resume, keyboard navigation, touch geometry, visibility pause and standalone SDK behavior.
- Required the final board to be stable and playable after every accepted turn.

**Director**

- Kept all game files under `example/canyon-charms/` and merged them as the second independent milestone.

## Milestone 3 — documentation and publication

**Architect**

- Documented dependency direction and replacement seams.
- Kept publisher integration in one best-effort adapter.

**QA**

- Wrote the automated and browser test matrices.
- Marked external Arkadium access, credentials, legal approval and publisher acceptance as explicit blockers rather than simulated evidence.

**Teacher/documentarian**

- Wrote a Russian classroom guide from player intent through tests, implementation, review, build and deployment.
- Added a deterministic PDF generator so the handbook can be rebuilt in CI.

**Release**

- Added a Pages workflow that runs tests, checks the game, builds a static bundle, generates the handbook and deploys the verified artifact.

## Example review conversation

```text
Director: What is the smallest player-visible behavior for this slice?
Gameplay: A neighboring swap that creates no match must return and spend no move.
QA: I will first demonstrate the wrong implementation by writing a failing test.
Presentation: I will animate swap-back from the semantic phase; I will not duplicate legality rules.
Architect: The core still has no browser import, so the boundary is preserved.
Director: Commit the green slice and hand it to the next role.
```

## Why this record matters

A useful transcript does not paste hidden reasoning. It records decisions, observable evidence, commit boundaries, ownership and handoffs. A student can reproduce the process without needing access to an agent's private scratchpad.
