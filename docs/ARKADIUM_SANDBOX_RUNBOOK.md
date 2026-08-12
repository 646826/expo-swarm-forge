# Arkadium Sandbox Evidence Runbook

This runbook defines the repository-supported path from `contract-ready` through official `sandbox-verified` evidence and the optional `sandbox-telemetry-verified` promotion for one exact Canyon Charms candidate. It does not replace Arkadium approval, production credentials, legal review or publisher acceptance.

## Release states

The repository uses five monotonic release states:

1. `contract-ready` — repository-owned contracts, builds and local browser gates pass. No official Sandbox success is claimed.
2. `sandbox-verified` — the protected workflow has captured and verified official Sandbox lifecycle, host pause/resume and sanitized RPC evidence for one exact build.
3. `sandbox-telemetry-verified` — the same official Sandbox build and session also have exact privacy-minimal Ark Eye rows and durable acknowledgement evidence. Only exact correlated evidence can produce this state.
4. `arkadium-dev-ready` — the assigned Arkadium DEV game configuration and publisher-owned capability set have also been approved.
5. `production-approved` — Arkadium production, legal, privacy, monetization and release approvals are complete.

A later state must not be inferred from an earlier one. The current repository state remains `contract-ready` until a successful protected workflow run produces evidence that is reviewed and tied to its exact candidate SHA.

## Repository prerequisites

Before configuring the protected environment:

- GitHub Pages must use **GitHub Actions** as its deployment source.
- The exact candidate must contain `.github/workflows/arkadium-sandbox.yml` and the evidence scripts.
- `npm ci --ignore-scripts --no-audit --no-fund` and `npm run verify` must pass for that candidate.
- The Vite candidate must report the exact commit SHA and reviewed SDK version `2.66.2`.
- No source map, external module URL, raw `node_modules` tree or uncompiled TypeScript may appear in the candidate output.

## Protected environment

Create a GitHub environment named **`arkadium-sandbox`**.

Recommended protection:

- require one or more reviewers who control Arkadium Sandbox access;
- prevent self-approval when organization policy supports it;
- restrict deployment branches to the default branch;
- keep protected values available only to this environment;
- retain evidence artifacts according to the publisher review policy.

### Required Sandbox automation secret

Add the environment secret `ARKADIUM_SANDBOX_AUTOMATION_JSON`. It is declarative configuration, not executable JavaScript, browser storage or an SDK credential dump.

The value must be a JSON object with exactly these fields:

```json
{
  "launchUrlTemplate": "https://official-sandbox.example/launch?gameUrl={{PREVIEW_URL}}",
  "gameFrameSelector": "iframe[data-role='game-frame']",
  "pauseSelector": "button[data-action='pause-game']",
  "resumeSelector": "button[data-action='resume-game']",
  "rpcDiagnosticsUrl": "https://official-sandbox.example/api/rpc-diagnostics"
}
```

Rules:

- `launchUrlTemplate` must be HTTPS and contain `{{PREVIEW_URL}}` exactly as the candidate insertion point.
- `gameFrameSelector` must select the iframe containing the SHA-addressed candidate.
- `pauseSelector` and `resumeSelector` must select official host controls whose actions reach the SDK callback path.
- `rpcDiagnosticsUrl` must be HTTPS and use the same origin as the official Sandbox launch URL.
- URLs must not contain username/password components. Do not put access tokens, cookies, user profiles, save payloads or App Insights identifiers in the JSON.

### Optional protected telemetry inputs

Configure all three values below to enable the additional telemetry promotion. Configure none of them to keep the established telemetry-free path.

- `GAME_EYE_ENDPOINT` — the protected HTTPS endpoint built into the exact Sandbox candidate. The browser must be able to reach it. Because a browser client uses this URL, the deployed runtime manifest necessarily exposes the URL; the environment protection controls who can select it for an official run rather than treating the URL itself as a durable credential.
- `ARK_EYE_CORRELATION_EVIDENCE_URL` — the protected HTTPS endpoint that returns one privacy-minimal normalized evidence object for the requested official session.
- `ARK_EYE_CORRELATION_EVIDENCE_TOKEN` — the bearer token accepted by the evidence endpoint. This token is confidential and must never be embedded in the game, automation JSON or artifacts.

Both endpoints must be HTTPS, must not contain username/password components or fragments, and must be supplied without surrounding whitespace. The evidence request is bound through query parameters in this order: `buildSha`, `sessionId`, `sdkVersion`. The evidence service must return `application/json` for that exact identity.

The workflow uses bearer authentication, refuses redirects, applies a 30-second timeout and reads at most 256 KiB through a bounded stream. The workflow must never log the endpoint, token or response body. Configure the evidence service so its normalized response contains only the fields accepted by `scripts/correlated-telemetry-evidence-lib.mjs`.

If any optional protected input is absent, the workflow prints **Retaining `sandbox-verified`** and skips telemetry retrieval. This is an explicit non-promotion path, not a synthetic telemetry success.

## Running the protected workflow

1. Open **Actions → Verify exact Arkadium Sandbox candidate**.
2. Choose **Run workflow** from the default branch.
3. Enter the exact lowercase 40-character candidate commit as `candidate_sha`.
4. Approve each protected `arkadium-sandbox` job when prompted by the environment policy.

The workflow then performs these fail-closed stages:

1. checks out the exact commit and proves it is already reachable from `main`;
2. installs the lockfile exactly;
3. runs complete repository verification;
4. writes either a telemetry-free runtime config or the selected protected HTTPS Game Eye endpoint;
5. rebuilds the Arkadium candidate for the same SHA;
6. deploys the standalone game at the Pages root and the candidate beneath `sandbox-candidates/<candidate_sha>/`;
7. verifies the deployed runtime manifest before opening Sandbox;
8. launches the official Sandbox in headless Chrome;
9. starts the game, observes official host pause and resume callbacks, and completes one game through canvas input;
10. reads the non-PROD structural lifecycle evidence API;
11. retrieves sanitized RPC diagnostics from the official Sandbox origin with the active browser session;
12. verifies status, lifecycle and RPC files against the same build, SDK, session and time window;
13. when all optional telemetry inputs are present, requests Ark Eye evidence for the verified `buildSha`, `sessionId` and `sdkVersion`;
14. verifies exact event count, ClickHouse row count, stream sequence span, acknowledgement floor and zero pending/redelivered work;
15. uploads the official evidence bundle and any privacy-safe correlated report.

There is no local success fallback. A missing selector, missing API, incomplete game, boot error, console error, stale timestamp, SDK/build mismatch, unknown RPC operation, missing host callback or forbidden evidence field fails the official Sandbox stage.

## Required evidence bundle

Every official Sandbox attempt can upload these allowlisted files:

- `sandbox-status.json` — exact build/SDK/session/timestamps, host pause/resume observations, boot-error state and console error count;
- `sandbox-events.json` — ordered structural calls from `ready` through `gameEnd`, including monotonic score calls;
- `rpc-diagnostics.json` — sanitized official request/response/callback traces with payload item counts only;
- `sandbox-console.log` — structural hashes, levels and lengths rather than raw console text;
- `sandbox-page.png` — final official Sandbox screenshot;
- `sandbox-verification.json` — verifier result with `releaseState: "sandbox-verified"` after an exact official run.

The three official JSON evidence sources must agree on the exact candidate and reviewed SDK. Status and lifecycle files must share one UUID session and generation timestamp. RPC traces must stay inside the session window and contain all required host/lifecycle operations with no violations.

When telemetry correlation is enabled, the bundle can additionally contain:

- `correlated-telemetry-verification.json` — the privacy-safe verifier report. Success has `releaseState: "sandbox-telemetry-verified"`; a mismatch retains `sandbox-verified` and an empty summary.
- `ark-eye-correlation.json` — the normalized upstream response. It is copied into the evidence directory only after the correlated verifier reports success, so rejected upstream data is never uploaded as raw evidence.

The correlated verifier requires the official Sandbox report, status and lifecycle files plus Ark Eye evidence for one identical build SHA, UUID session and SDK `2.66.2`. It also requires the app-owned consumer to be ready before the session, browser capture inside the official session window, correlation after Sandbox completion, exact event/row and stream spans, acknowledgement through the last correlated stream sequence, and zero pending, ACK-pending or redelivered messages.

## Interpreting failure

Failure before `sandbox-verification.json` succeeds leaves the candidate at `contract-ready`.

A successful official stage without complete optional telemetry inputs ends honestly at `sandbox-verified`. A configured telemetry retrieval or correlation failure fails the workflow and never promotes the candidate. The original official evidence remains available for review, and a safe correlated failure report may be present, but raw rejected Ark Eye evidence is not copied into the artifact.

Use the structural verifier messages to locate the class of failure. The evidence tooling intentionally does not echo rejected tokens, credentials, profiles, raw payloads or response bodies. Review protected logs and official Arkadium or Ark Eye tooling under the applicable access policy rather than weakening the verifier.

Do not edit an evidence JSON file to make it pass. Re-run the exact candidate after correcting the candidate, official configuration, Sandbox automation selectors or Ark Eye evidence service.

## Promotion after success

After a genuine successful run:

- preserve the workflow run URL, candidate SHA and artifact digest in the release record;
- review the screenshot, structural console log and sanitized RPC traces;
- record `sandbox-verified` only for the exact official evidence bundle;
- record `sandbox-telemetry-verified` only when the correlated report succeeds for the same build, session and SDK;
- keep `arkadium-dev-ready` and `production-approved` unchecked until their publisher-owned requirements are independently complete.
