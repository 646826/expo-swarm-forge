# Arkadium SDK public API snapshot

This directory contains the reviewed, reproducible TypeScript declaration surface for the exact public npm package pinned by `packages/platform-arkadium/package.json`.

## Reviewed package

- package: `@arkadiuminc/sdk`
- exact version: `2.66.2`
- types entry: `dist/pkg/loader.d.ts`
- declaration files: `68`
- normalized declaration bytes: `82765`
- registry integrity: `sha512-CAGoz2gi0Db3mIDUThrp27LXpo+TYdrrLhJ4lScYg7MKtbC5VNoPU+7YBo6ng9e9oJzqKdiPOiVcpXwJvrzktw==`
- registry tarball: `https://registry.npmjs.org/@arkadiuminc/sdk/-/sdk-2.66.2.tgz`
- combined declaration SHA-256: `fbca385a575e4b8cab8023a06b81f25424cae433d64b9941b523d78d994c9f83`
- snapshot SHA-256: `c23711eaa4b35b3161e91d8ea9f08d7d55ebc10785fc389de05495a1522806f4`

## Required CI verification

Normal CI runs the frozen install and then executes:

```bash
pnpm sdk:snapshot:check
```

The check resolves the installed package from the adapter package, rebuilds the normalized declaration surface, and fails when the dependency version, registry provenance, declaration bytes, per-file hashes, combined hash, or committed snapshot text drift.

Repository validation also fails when:

- `@arkadiuminc/sdk` is not an exact v2 dependency;
- either committed snapshot artifact is missing;
- manifest versions disagree with the adapter dependency;
- `verify:bootstrap` omits `pnpm sdk:snapshot:check`;
- executable source imports the SDK outside `packages/platform-arkadium`.

## Regeneration contract

Updating this snapshot requires an explicit exact-version regeneration task, review of the declaration diff, and a separate commit referencing Issue #2. Run the writer only with reviewed official npm registry metadata:

```bash
pnpm sdk:snapshot -- \
  --registry-metadata /path/to/arkadium-sdk-registry.json
```

`public-api.snapshot.txt` contains normalized declaration text only. No credentials, Sandbox responses, user data, or private publisher payloads belong here.
