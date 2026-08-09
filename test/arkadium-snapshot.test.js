import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  resolveGitSourceCommit,
  syncSnapshot,
  verifySnapshot,
} from '../scripts/arkadium-snapshot-lib.mjs';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

async function createFactoryFixture() {
  const root = await mkdtemp(join(tmpdir(), 'arkadium-snapshot-'));
  const source = join(root, 'factory');
  const destination = join(root, 'vendor');

  await mkdir(join(source, 'packages/platform-contract/src'), { recursive: true });
  await mkdir(join(source, 'packages/platform-arkadium/src'), { recursive: true });
  await mkdir(join(source, 'packages/platform-arkadium/sdk'), { recursive: true });
  await writeFile(
    join(source, 'packages/platform-contract/src/index.ts'),
    "export const contract = 'publisher';\n",
  );
  await writeFile(
    join(source, 'packages/platform-arkadium/src/index.ts'),
    "export const adapter = 'arkadium';\n",
  );
  await writeFile(
    join(source, 'packages/platform-arkadium/package.json'),
    `${JSON.stringify({
      name: '@arkadium-game-factory/platform-arkadium',
      dependencies: { '@arkadiuminc/sdk': '2.66.2' },
    }, null, 2)}\n`,
  );
  await writeFile(
    join(source, 'packages/platform-arkadium/sdk/manifest.json'),
    `${JSON.stringify({ package: { name: '@arkadiuminc/sdk', version: '2.66.2' } }, null, 2)}\n`,
  );

  return { root, source, destination };
}

test('snapshot records exact source commit, SDK version, and file hashes', async () => {
  const { source, destination } = await createFactoryFixture();
  const manifest = await syncSnapshot({
    source,
    destination,
    sourceCommit: SOURCE_COMMIT,
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceRepository, '646826/arkadium-game-factory');
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.sdkVersion, '2.66.2');
  assert.ok(Object.keys(manifest.files).length >= 4);
  assert.equal(
    Object.keys(manifest.files).every((path) => path.startsWith('source/')),
    true,
  );
  assert.equal(
    Object.values(manifest.files).every((digest) => /^[0-9a-f]{64}$/.test(digest)),
    true,
  );

  const report = await verifySnapshot(destination);
  assert.deepEqual(report, {
    ok: true,
    sourceCommit: SOURCE_COMMIT,
    sdkVersion: '2.66.2',
    files: Object.keys(manifest.files).length,
  });
});

test('snapshot manifest output is deterministic', async () => {
  const { source, destination } = await createFactoryFixture();
  await syncSnapshot({ source, destination, sourceCommit: SOURCE_COMMIT });
  const first = await readFile(join(destination, 'manifest.json'), 'utf8');
  await syncSnapshot({ source, destination, sourceCommit: SOURCE_COMMIT });
  const second = await readFile(join(destination, 'manifest.json'), 'utf8');
  assert.equal(second, first);
});

test('verification rejects modified and extra source files', async () => {
  const modified = await createFactoryFixture();
  await syncSnapshot({
    source: modified.source,
    destination: modified.destination,
    sourceCommit: SOURCE_COMMIT,
  });
  await writeFile(
    join(modified.destination, 'source/packages/platform-contract/src/index.ts'),
    'modified\n',
  );
  await assert.rejects(() => verifySnapshot(modified.destination), /hash mismatch/);

  const extra = await createFactoryFixture();
  await syncSnapshot({
    source: extra.source,
    destination: extra.destination,
    sourceCommit: SOURCE_COMMIT,
  });
  await writeFile(join(extra.destination, 'source/untracked.txt'), 'extra\n');
  await assert.rejects(() => verifySnapshot(extra.destination), /untracked snapshot file/);
});

test('sync rejects an SDK dependency or SDK snapshot version mismatch', async () => {
  const dependencyMismatch = await createFactoryFixture();
  await writeFile(
    join(dependencyMismatch.source, 'packages/platform-arkadium/package.json'),
    `${JSON.stringify({
      name: '@arkadium-game-factory/platform-arkadium',
      dependencies: { '@arkadiuminc/sdk': '^2.66.2' },
    }, null, 2)}\n`,
  );
  await assert.rejects(
    () => syncSnapshot({
      source: dependencyMismatch.source,
      destination: dependencyMismatch.destination,
      sourceCommit: SOURCE_COMMIT,
    }),
    /exactly 2\.66\.2/,
  );

  const manifestMismatch = await createFactoryFixture();
  await writeFile(
    join(manifestMismatch.source, 'packages/platform-arkadium/sdk/manifest.json'),
    `${JSON.stringify({ package: { version: '2.66.1' } }, null, 2)}\n`,
  );
  await assert.rejects(
    () => syncSnapshot({
      source: manifestMismatch.source,
      destination: manifestMismatch.destination,
      sourceCommit: SOURCE_COMMIT,
    }),
    /SDK snapshot version/,
  );
});

test('git source resolution returns HEAD and rejects a dirty checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkadium-source-git-'));
  const git = (...args) => spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.equal(git('init').status, 0);
  assert.equal(git('config', 'user.name', 'Snapshot Test').status, 0);
  assert.equal(git('config', 'user.email', 'snapshot@example.invalid').status, 0);
  await writeFile(join(root, 'tracked.txt'), 'clean\n');
  assert.equal(git('add', 'tracked.txt').status, 0);
  assert.equal(git('commit', '-m', 'fixture').status, 0);

  const expected = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(await resolveGitSourceCommit(root), expected);

  await writeFile(join(root, 'tracked.txt'), 'dirty\n');
  await assert.rejects(() => resolveGitSourceCommit(root), /must be clean/);
});
