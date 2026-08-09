# Arkadium Platform Snapshot

This directory will contain a deterministic, reviewed source snapshot from:

```text
646826/arkadium-game-factory
```

The snapshot is not downloaded during CI. A developer updates it from a clean local checkout:

```bash
npm run arkadium:sync -- --source ../arkadium-game-factory
```

The command copies only these allowlisted roots:

```text
packages/platform-contract/src
packages/platform-arkadium/src
packages/platform-arkadium/sdk
packages/platform-arkadium/package.json
```

It writes `manifest.json` with:

- the exact 40-character factory commit;
- the exact official Arkadium SDK version `2.66.2`;
- a SHA-256 digest for every copied file.

Verification is offline and fail-closed:

```bash
npm run arkadium:verify-snapshot
```

It rejects modified, missing, extra, or symbolic-link entries, a changed source repository, an SDK dependency range, and any disagreement between the adapter package and its committed SDK declaration snapshot.

This tooling intentionally lands before the actual snapshot. Until `manifest.json` exists, the normal repository verifier does not claim that an official Arkadium adapter is present.
