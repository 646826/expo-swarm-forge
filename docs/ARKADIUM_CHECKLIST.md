# Arkadium Submission Checklist

This checklist separates repository-owned work from publisher-owned approvals. Passing it does not claim acceptance by Arkadium.

## Playable package

- [x] Static HTML, CSS and JavaScript package.
- [x] No remote runtime art, font or audio dependency.
- [x] Responsive desktop, tablet and phone layout.
- [x] Pointer, touch and keyboard routes.
- [x] Pause on visibility loss.
- [x] Local standalone fallback when a publisher SDK is absent.
- [x] Deterministic rules covered by Node tests.
- [x] Uncompressed build budget below 750,000 bytes.

## Experience

- [x] Original game identity and procedural clean-room visuals.
- [x] Immediate core loop with a short casual session.
- [x] Honest invalid swaps that do not spend a move.
- [x] Cascades, combo feedback and build-up through special charms.
- [x] Sound toggle and reduced-motion mode.
- [x] Readable DOM menus and screen-reader announcements.

## Integration boundary

- [x] Lifecycle, score and analytics calls pass through one adapter.
- [x] Calls are bounded, ordered and best effort.
- [x] Missing or rejected SDK calls cannot block play.
- [ ] Pin the exact publisher SDK version supplied for the assigned game.
- [ ] Replace capability discovery with the confirmed typed SDK surface.
- [ ] Add the assigned game identifier and approved analytics configuration through deployment secrets, never source control.
- [ ] Validate lifecycle order in the publisher Sandbox.
- [ ] Validate ads, wallet/Gems, authentication and leaderboard capabilities only when enabled for the title.

## Evidence still requiring external access

- [ ] Arkadium developer/Sandbox access.
- [ ] Real `gameId` and production credentials.
- [ ] Publisher metadata approval.
- [ ] Legal, privacy and content review.
- [ ] Real-device performance measurements on the required matrix.
- [ ] Advertising and monetization review.
- [ ] Publisher acceptance and production launch.

## Suggested submission package

1. Public playable URL from the Pages deployment.
2. One-paragraph pitch and feature list.
3. Desktop and portrait screenshots.
4. Technical stack and build-size report.
5. Input, accessibility and browser support matrix.
6. Asset provenance statement.
7. Test and playtest evidence tied to an exact commit SHA.
8. The Russian classroom handbook as supporting documentation for the reusable process.

## Clean-room statement

Canyon Charms is inspired by the broad match-3 genre. It does not copy Wild West Match 2 source code, branding, art, audio, screen composition, level data or proprietary behavior. Its symbols, rules implementation, visual effects and synthesized audio are repository-owned.
