# Arkadium Submission Checklist

This checklist separates repository-owned work from publisher-owned approvals. Passing it does not claim acceptance by Arkadium.

**Current release state: `contract-ready`.** The repository does not claim Sandbox verification (`sandbox-verified`) or the optional `sandbox-telemetry-verified` promotion until the protected official workflow succeeds for one exact candidate and its evidence is reviewed.

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

- [x] Lifecycle, score and analytics calls pass through one typed adapter/runtime path.
- [x] Calls are bounded, ordered and fail closed at the publisher boundary.
- [x] Standalone play never imports the official SDK.
- [x] Exact `@arkadiuminc/sdk` version `2.66.2` and reviewed adapter snapshot are pinned and verified.
- [x] Official candidate build is bound to an exact commit and public runtime manifest.
- [x] Candidate output rejects source maps, external module URLs, bare imports, raw `node_modules` and TypeScript sources.
- [x] Game Eye delivery uses a reviewed schema, bounded queue/batch/retry limits and redacted structural diagnostics.
- [x] Protected Sandbox evidence verifier rejects stale, reordered, mismatched or sensitive evidence.
- [x] Manual workflow accepts an optional protected HTTPS Game Eye endpoint without weakening the telemetry-free candidate path.
- [x] Correlated verifier requires Ark Eye evidence for the same build, session and SDK plus exact persisted rows and acknowledgement state.
- [x] Protected retrieval is authenticated, bounded, redirect-free and uploads raw upstream evidence only after verifier success.
- [ ] Run the protected `arkadium-sandbox` workflow against the official host and retain a genuine `sandbox-verified` bundle.
- [ ] Configure all optional telemetry inputs and retain a genuine `sandbox-telemetry-verified` bundle for that same official run.
- [ ] Add the assigned DEV `gameId` and approved publisher configuration through deployment controls, never source control.
- [ ] Validate ads, wallet/Gems, authentication and leaderboard capabilities only when explicitly enabled for the title.

## Release-state progression

- [x] `contract-ready` — repository contracts, deterministic builds and local browser gates pass.
- [ ] `sandbox-verified` — exact candidate has official host lifecycle, pause/resume and sanitized RPC evidence.
- [ ] `sandbox-telemetry-verified` — exact official build/session also has privacy-minimal Ark Eye rows and durable ACK evidence.
- [ ] `arkadium-dev-ready` — assigned DEV game configuration and enabled capability set are approved.
- [ ] `production-approved` — production, legal, privacy, monetization and launch approvals are complete.

See `docs/ARKADIUM_SANDBOX_RUNBOOK.md` for the protected environment, automation JSON schema, optional telemetry inputs, evidence bundles and promotion procedure.

## Evidence still requiring external access

- [ ] Protected Arkadium developer/Sandbox access and reviewer approval.
- [ ] Official `ARKADIUM_SANDBOX_AUTOMATION_JSON` selectors and RPC diagnostics URL.
- [ ] Protected `GAME_EYE_ENDPOINT` reachable from the official browser session.
- [ ] Protected Ark Eye evidence URL and bearer token for exact same-session retrieval.
- [ ] Real assigned `gameId` and production credentials.
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
8. Protected official Sandbox evidence after a genuine successful run.
9. Correlated Ark Eye verifier report when the optional telemetry promotion has genuinely succeeded.
10. The Russian classroom handbook as supporting documentation for the reusable process.

## Clean-room statement

Canyon Charms is inspired by the broad match-3 genre. It does not copy Wild West Match 2 source code, branding, art, audio, screen composition, level data or proprietary behavior. Its symbols, rules implementation, visual effects and synthesized audio are repository-owned.
