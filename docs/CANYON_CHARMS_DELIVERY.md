# Canyon Charms Delivery

## Repository milestones

The `main` history intentionally records four reviewable layers:

1. reusable SwarmForge browser-game starter;
2. complete `example/canyon-charms/` game;
3. architecture, QA, classroom documentation and GitHub Pages deployment;
4. clearer first-minute onboarding and a complete repository verification gate.

This order demonstrates that the reusable foundation existed before the reference game and that later presentation improvements did not rewrite deterministic game rules.

## Local verification

Run the complete repository gate:

```bash
npm run verify
```

It executes all Node tests, checks and builds every discovered game, creates deterministic starter and Canyon Charms ZIP packages, and generates the Russian student handbook.

For an interactive local preview:

```bash
npm run serve -- example/canyon-charms/dist 4173
```

Open `http://127.0.0.1:4173`.

## Public deployment

The workflow `.github/workflows/deploy-canyon-pages.yml` deploys from `main` using the official GitHub Pages actions.

Before the first deployment, a repository administrator must perform this one-time setup in GitHub:

1. Open **Settings**.
2. Open **Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open **Actions**, select **Deploy Canyon Charms to GitHub Pages**, and choose **Run workflow** on `main`.

The default `GITHUB_TOKEN` used by a workflow cannot perform this first-time Pages enablement. Until the source is selected, the public address returns `404` even though the game and deployment workflow are present in `main`.

The canonical expected repository URL is:

```text
https://646826.github.io/expo-swarm-forge/
```

Treat the URL as verified only after the deployment job succeeds and its final curl checks pass. After that successful deployment, the Russian PDF is available at:

```text
https://646826.github.io/expo-swarm-forge/student-handbook-ru.pdf
```

## Browser-verified immutable preview

While the one-time Pages setting remains external, the clarified game release is available immediately at this exact merged commit:

```text
https://cdn.staticdelivr.com/gh/646826/expo-swarm-forge/709a1556fda3fa7a1506d46ec704cc654308775b/example/canyon-charms/index.html
```

The workflow `.github/workflows/public-preview-smoke.yml` checks HTTP success and safe MIME types for the HTML, `styles.css`, `clarity.css`, the entry module, and every imported game module. It then loads the URL in a real headless Chrome session and verifies:

- the exact `<title>Canyon Charms</title>` marker;
- dynamic Canvas state containing `Canyon Charms board. Score 0 of 5,000.`;
- initialized reduced-motion state;
- visible onboarding copy including `Three in a row`;
- a hidden boot-error surface;
- a non-empty 1280 × 720 screenshot.

The preview-pin pull request is mergeable only after this browser workflow and the complete repository CI both pass. Its uploaded DOM, Chrome log, screenshot, release ZIPs, build report, and Russian handbook form the release evidence for the pinned commit.

This is a third-party CDN mirror of an exact Git commit, not the canonical publisher host. The URL is intentionally commit-pinned and therefore does not silently change when `main` advances.

## Publisher package

The root packaging command creates a deterministic ZIP from the verified game build. Before any external submission, record:

- exact game-release SHA;
- exact documentation and preview-pin merge SHA;
- successful CI and browser-smoke workflow run IDs;
- ZIP SHA-256 and build-report total bytes;
- desktop and phone screenshots;
- browser and real-device matrix;
- remaining Arkadium Sandbox, credentials, legal and publisher-review blockers.

## Clean-room provenance

All shipped game visuals are Canvas paths and gradients. Audio is synthesized in Web Audio after a user gesture. No Wild West Match 2 source code, branding, art, audio, layout or level data is included.
