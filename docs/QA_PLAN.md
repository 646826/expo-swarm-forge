# Canyon Charms QA Plan

## Automated verification

Run from a clean checkout:

```bash
npm test
npm run check -- --project example/canyon-charms
npm run build -- --project example/canyon-charms
npm run package -- --project example/canyon-charms
```

Expected results:

- every Node test passes;
- source and local references pass static validation;
- `example/canyon-charms/dist/index.html` exists;
- the uncompressed build remains below 750,000 bytes;
- the ZIP contains no source maps, credentials or remote runtime assets.

## Domain test matrix

- Same seed produces the same starting board.
- Starting boards have 64 unique tile IDs, no automatic match and at least one legal move.
- Only orthogonal neighbors can swap.
- Invalid swaps restore the board and preserve the move counter.
- Valid swaps spend one move, produce points and settle to a match-free playable board.
- Horizontal and vertical runs are detected.
- T/L intersections merge correctly.
- Four creates a directional firecracker.
- Five and T/L create dynamite.
- Existing specials expand the clear set and chain only once.
- Target completion wins; zero moves below target loses.
- Finished games reject additional input.
- Malformed storage and unavailable publisher APIs fail safely.

## Browser smoke route

Test at 1280 x 720 and 390 x 844:

1. Load the title screen with no console errors.
2. Open and close How to Play.
3. Start a game.
4. Select two non-matching neighbors; confirm the move count is unchanged.
5. Execute one legal move; confirm score increases and the board settles.
6. Use keyboard arrows and Enter.
7. Use a swipe gesture.
8. Pause and resume.
9. Toggle sound and reduced motion.
10. Hide the tab; confirm the game pauses.
11. Reload; confirm preferences and best score are normalized and restored.
12. Complete a session or temporarily use a one-point target in a test harness; verify result state and score submission are best effort.

## Visual review

- Board remains centered and each phone tile is roughly 42 CSS pixels or larger.
- Header and control bar do not overlap the board.
- Selection, focus and hint states are visually distinct.
- Charms remain distinguishable by shape, not color alone.
- Strong motion is reserved for matches, errors, combos and victory.
- Reduced motion removes parallax drift, dense particles and strong shake.
- HUD remains readable over the animated background.
- Title and modal screens feel like game surfaces rather than application dashboards.

## Release evidence

For every candidate record:

- exact Git commit SHA;
- test command outputs;
- build report and total bytes;
- ZIP SHA-256;
- desktop and portrait screenshots;
- browser versions used;
- Pages workflow run and verified page URL;
- unresolved external publisher blockers.

Never describe a candidate as Arkadium-approved without publisher evidence.
