# Arkadium Sandbox Evidence Runbook

This runbook defines the only repository-supported path from an exact Canyon Charms candidate to the release state `sandbox-verified`. It does not replace Arkadium approval, production credentials, legal review or publisher acceptance.

## Release states

The repository uses four monotonic release states:

1. `contract-ready` — repository-owned contracts, builds and local browser gates pass. No official Sandbox success is claimed.
2. `sandbox-verified` — the protected workflow has captured and verified official Sandbox lifecycle, host pause/resume and sanitized RPC evidence for one exact build.
3. `arkadium-dev-ready` — the assigned Arkadium DEV game configuration and publisher-owned capability set have also been approved.
4. `production-approved` — Arkadium production, legal, privacy, monetization and release approvals are complete.

A later state must not be inferred from an earlier one. The current repository state remains `contract-ready` until a successful protected workflow run produces the required evidence bundle.

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
- keep the environment secret available only to this environment;
- retain evidence artifacts according to the publisher review policy.

Add one environment secret named `ARKADIUM_SANDBOX_AUTOMATION_JSON`. It is declarative configuration, not executable JavaScript, browser storage or an SDK credential dump.

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

## Running the protected workflow

1. Open **Actions → Verify exact Arkadium Sandbox candidate**.
2. Choose **Run workflow** from the default branch.
3. Enter the exact lowercase 40-character candidate commit as `candidate_sha`.
4. A reviewer approves the `arkadium-sandbox` environment deployment.

The workflow then performs these fail-closed stages:

1. checks out the exact commit;
2. installs the lockfile exactly;
3. runs complete repository verification;
4. rebuilds the Arkadium candidate for the same SHA;
5. deploys the standalone game at the Pages root and the candidate beneath `sandbox-candidates/<candidate_sha>/`;
6. verifies the deployed runtime manifest before opening Sandbox;
7. launches the official Sandbox in headless Chrome;
8. starts the game, observes official host pause and resume callbacks, and completes one game through canvas input;
9. reads the non-PROD structural lifecycle evidence API;
10. retrieves sanitized RPC diagnostics from the official Sandbox origin with the active browser session;
11. verifies status, lifecycle and RPC files against the same build, SDK, session and time window;
12. uploads the complete evidence bundle.

There is no local success fallback. A missing selector, missing API, incomplete game, boot error, console error, stale timestamp, SDK/build mismatch, unknown RPC operation, missing host callback or forbidden evidence field fails the job.

## Required evidence bundle

A successful run uploads:

- `sandbox-status.json` — exact build/SDK/session/timestamps, host pause/resume observations, boot-error state and console error count;
- `sandbox-events.json` — ordered structural calls from `ready` through `gameEnd`, including monotonic score calls;
- `rpc-diagnostics.json` — sanitized official request/response/callback traces with payload item counts only;
- `sandbox-console.log` — structural hashes, levels and lengths rather than raw console text;
- `sandbox-page.png` — final official Sandbox screenshot;
- `sandbox-verification.json` — verifier result with `releaseState: "sandbox-verified"`.

The three JSON evidence sources must agree on the exact candidate and reviewed SDK. Status and lifecycle files must share one UUID session and generation timestamp. RPC traces must stay inside the session window and contain all required host/lifecycle operations with no violations.

## Interpreting failure

A failed protected run leaves the repository at `contract-ready`.

Use the structural verifier messages to locate the class of failure. The evidence tooling intentionally does not echo rejected tokens, credentials, profiles, raw payloads or response bodies. Review protected logs and official Arkadium tooling under the applicable access policy rather than weakening the verifier.

Do not edit an evidence JSON file to make it pass. Re-run the exact candidate after correcting the candidate, official configuration or Sandbox automation selectors.

## Promotion after success

After a genuine successful run:

- preserve the workflow run URL, candidate SHA and artifact digest in the release record;
- review the screenshot, structural console log and sanitized RPC traces;
- update release documentation to `sandbox-verified` in a separate reviewed change tied to that exact evidence;
- keep `arkadium-dev-ready` and `production-approved` unchecked until their publisher-owned requirements are independently complete.
