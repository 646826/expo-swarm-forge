# Canyon Charms Delivery

## Repository milestones

The `main` history intentionally records three reviewable layers:

1. reusable SwarmForge browser-game starter;
2. complete `example/canyon-charms/` game;
3. architecture, QA, classroom documentation and GitHub Pages deployment.

This order demonstrates that the reusable foundation existed before the reference game.

## Local verification

```bash
npm test
npm run check -- --project example/canyon-charms
npm run build -- --project example/canyon-charms
npm run package -- --project example/canyon-charms
node tools/generate-canyon-handbook.mjs \
  --output example/canyon-charms/dist/student-handbook-ru.pdf
npm run serve -- example/canyon-charms/dist 4173
```

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

While the one-time Pages setting remains external, the exact merged game is available immediately at:

```text
https://cdn.staticdelivr.com/gh/646826/expo-swarm-forge/baf9e0f510b9434931673561603f1b9c5b994f2a/example/canyon-charms/index.html
```

The workflow `.github/workflows/public-preview-smoke.yml` first checks HTTP success and MIME types for the HTML, CSS, entry module and every imported game module. It then loads the selected URL in a real headless Chrome session, verifies that the ES modules changed the Canvas description to `Canyon Charms board. Score 0 of 5,000.`, confirms reduced-motion state was initialized, confirms the boot-error surface remains hidden, and captures a 1280×720 screenshot.

Workflow run `31287321962` selected `staticdelivr`, completed the Chrome boot, and uploaded the browser evidence artifact. jsDelivr was rejected because it serves `index.html` as `text/plain`; RawGitHack was rejected for direct use because normal browsers display an external-content confirmation page.

This is a third-party CDN mirror of an exact Git commit, not the canonical publisher host. The URL is intentionally commit-pinned and therefore does not silently change when `main` advances.

## Publisher package

The root packaging command creates a deterministic ZIP from the verified game build. Before any external submission, record:

- exact `main` SHA;
- Pages workflow run ID and resulting URL;
- ZIP SHA-256 and build-report total bytes;
- desktop and phone screenshots;
- browser and real-device matrix;
- remaining Arkadium Sandbox, credentials, legal and publisher-review blockers.

## Clean-room provenance

All shipped game visuals are Canvas paths and gradients. Audio is synthesized in Web Audio after a user gesture. No Wild West Match 2 source code, branding, art, audio, layout or level data is included.
