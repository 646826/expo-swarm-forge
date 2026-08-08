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

The workflow `.github/workflows/deploy-canyon-pages.yml` deploys from `main` using the official GitHub Pages actions. The canonical expected repository URL is:

```text
https://646826.github.io/expo-swarm-forge/
```

Treat the URL as verified only after the deployment job succeeds and its final curl checks pass. The Russian PDF is published at:

```text
https://646826.github.io/expo-swarm-forge/student-handbook-ru.pdf
```

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
