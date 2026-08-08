# Canyon Charms

A compact, original match-3 reference game for the SwarmForge browser-game starter.

## Play locally

From the repository root:

```bash
npm run serve -- example/canyon-charms 4173
```

Open `http://127.0.0.1:4173`.

## Controls

- Pointer or touch: select two adjacent charms, or swipe from one charm toward another.
- Keyboard: arrow keys move focus, Enter or Space selects, Escape pauses, M toggles sound, R restarts.
- The game also supports reduced motion and persistent local preferences.

## Architecture

- `src/core/` contains deterministic, renderer-independent rules.
- `src/main.js` owns browser input, Canvas rendering, animation and synthesized sound.
- `src/platform/platform.js` owns persistence and the optional publisher bridge.
- `test/` exercises the pure rules with Node's built-in test runner.

All visuals and audio are generated at runtime. The example does not copy Wild West Match 2 code, assets, branding, layouts, audio or level data.
