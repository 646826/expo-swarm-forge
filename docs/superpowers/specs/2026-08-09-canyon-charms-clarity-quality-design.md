# Canyon Charms Clarity and Quality Design

## Goal

Make Canyon Charms easier to understand during the first minute and make the repository's main quality command verify the complete starter, reference game, packages, handbook, and browser boot.

## Scope

The match-3 rules, scoring, seed behavior, publisher adapter, and art-generation approach remain unchanged.

The change adds:

- an explicit 5,000-point / 20-move goal on the title screen;
- a compact visual explanation of match-3, match-4, and match-5/T/L recipes;
- a non-blocking rule reminder over the playfield;
- clearer help copy for invalid swaps, cascades, automatic hints, and keyboard control;
- a Russian start-here guide;
- one `npm run verify` quality gate;
- current-branch headless-Chrome evidence in CI.

## Approaches considered

### Documentation only

Lowest implementation risk, but it would not help a player who opens the game without reading the repository.

### Clarity and verification pass — selected

Improve static DOM/CSS surfaces without changing deterministic rules, and strengthen CI around the existing architecture. This gives visible value with a small behavioral risk.

### Full presentation refactor

Split the large browser composition file into renderer, controller, audio, and UI modules. This may be valuable later, but it is not required to make the current game understandable and would broaden the regression surface.

## Architecture

`index.html` owns semantic instructional content. `clarity.css` owns only the new onboarding and rule-reminder presentation. Existing `styles.css` remains the visual foundation.

`scripts/verify.mjs` composes existing commands instead of duplicating build, check, packaging, or PDF logic. CI invokes the same command used locally and adds a browser-only smoke step.

## Accessibility

All instructional text remains real DOM text. Visual patterns have accompanying labels. The playfield reminder is not interactive and does not cover the center of the board. Existing Canvas description, live region, keyboard routes, dialog semantics, and reduced-motion behavior remain intact.

## Testing

A static contract test proves the title, help, Russian guide, verify command, and CI browser step exist. Existing domain tests continue to own game rules. CI must produce a Chrome screenshot and reject a visible boot-error surface.

## Delivery

Land the clarity/quality change as one reviewable PR. After merge, update the immutable public-preview commit pin in a second PR and rerun its real-Chrome workflow.
