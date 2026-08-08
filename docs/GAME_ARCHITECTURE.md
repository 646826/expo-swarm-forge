# Canyon Charms Architecture

Canyon Charms is deliberately split into three boundaries so a student can change graphics without changing rules, test rules without a browser, and replace the publishing host without rewriting the game.

## 1. Deterministic domain

`example/canyon-charms/src/core/` owns the complete match-3 policy:

- seeded random number generation;
- 8 x 8 board construction without starting matches;
- proof that at least one legal move exists;
- orthogonal swaps and honest rollback of invalid swaps;
- horizontal and vertical run discovery;
- merged T/L groups;
- row and column firecrackers;
- dynamite and chained special activation;
- gravity, refill, cascade depth, score, move count and win/loss state.

The domain imports no DOM, Canvas, audio, storage or publisher API. `createGame(seed)` followed by the same sequence of swaps always produces the same state.

## 2. Browser presentation

`example/canyon-charms/src/main.js` translates player actions into domain commands and translates domain events into presentation:

- DPR-aware Canvas rendering;
- procedural western jewel art;
- responsive board geometry;
- pointer, swipe, touch and keyboard input;
- particles, flashes, score flyups, shake and victory effects;
- synthesized Web Audio after a user gesture;
- DOM title, pause, result and help surfaces;
- screen-reader announcements and a live Canvas description;
- reduced-motion behavior.

The renderer treats the domain state as the source of truth. Canvas objects are disposable view state.

## 3. Platform adapters

`example/canyon-charms/src/platform/platform.js` owns effects outside the game rules:

- schema-normalized local settings and best score;
- storage failure fallback;
- a bounded, ordered publisher event queue;
- guarded capability discovery for lifecycle, analytics and score submission;
- standalone play when no SDK exists.

No credentials or proprietary SDK payloads are committed. A real publisher integration replaces only this adapter.

## Data flow

```text
Pointer / keyboard / touch
          |
          v
Browser action mapping
          |
          v
attemptSwap(pure state, cells)
          |
          +--> next serializable state
          +--> semantic phases: swap, clear, drop, refill, settle
                         |
                         v
Canvas / DOM / audio presentation
                         |
                         v
Best-effort publisher events
```

## Extension points

- Add a tile kind in `DEFAULT_KINDS`, then add its procedural symbol in `main.js`.
- Add a level by passing different `moves` and `target` values to `createGame`.
- Add a special by extending clear-set expansion in `game-state.js` and first writing a failing test.
- Replace Canvas with Phaser by keeping the same core commands and semantic phases.
- Replace local publisher discovery with an exact Arkadium SDK bridge once the real SDK version and game credentials are available.

## Architecture checks

The root test runner discovers Node tests in every `test/` directory. The static checker validates imports, local references, release size and unsafe output. The Pages workflow builds from source and publishes only verified static files.
