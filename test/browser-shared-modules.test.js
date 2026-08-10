import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  ROOT,
  buildProject,
  validateProjectConfig,
} from '../scripts/project-lib.mjs';

const BASE_CONFIG = Object.freeze({
  slug: 'shared-build-test',
  title: 'Shared Build Test',
  entry: 'index.html',
  output: 'dist',
  buildBudgetBytes: 750000,
});

test('project config accepts only bounded repository package source roots', () => {
  assert.deepEqual(validateProjectConfig({
    ...BASE_CONFIG,
    browserSharedRoots: [
      'packages/game-events/src',
      'packages/publisher-platform/src',
    ],
  }).browserSharedRoots, [
    'packages/game-events/src',
    'packages/publisher-platform/src',
  ]);

  for (const browserSharedRoots of [
    ['../packages/game-events/src'],
    ['/packages/game-events/src'],
    ['vendor/arkadium-platform'],
    ['packages/game-events'],
    ['packages/GameEvents/src'],
    ['packages/game-events/src', 'packages/game-events/src'],
    Array.from({ length: 17 }, (_, index) => `packages/package-${index}/src`),
  ]) {
    assert.throws(
      () => validateProjectConfig({ ...BASE_CONFIG, browserSharedRoots }),
      /shared browser module/i,
      JSON.stringify(browserSharedRoots),
    );
  }
});

test('build copies allowlisted shared modules into the static server root', async () => {
  const project = await mkdtemp(join(ROOT, '.shared-browser-build-'));
  try {
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(join(project, 'index.html'), [
      '<!doctype html>',
      '<title>Shared Build Test</title>',
      '<script type="module" src="./src/main.js"></script>',
    ].join('\n'));
    await writeFile(
      join(project, 'src', 'main.js'),
      "import '../../../../packages/game-events/src/index.js';\n",
    );
    await writeFile(join(project, 'game.config.json'), `${JSON.stringify({
      ...BASE_CONFIG,
      browserSharedRoots: ['packages/game-events/src'],
    }, null, 2)}\n`);

    const report = await buildProject(project);
    const copied = await readFile(
      join(project, 'dist', 'packages', 'game-events', 'src', 'index.js'),
      'utf8',
    );

    assert.match(copied, /createCanonicalEventFactory/);
    assert.ok(report.files.some(
      (file) => file.path === 'packages/game-events/src/index.js',
    ));
    assert.ok(report.totalBytes > 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('the Canyon Charms release explicitly packages both runtime dependencies', async () => {
  const config = JSON.parse(await readFile(
    join(ROOT, 'example', 'canyon-charms', 'game.config.json'),
    'utf8',
  ));
  assert.deepEqual(config.browserSharedRoots, [
    'packages/game-events/src',
    'packages/publisher-platform/src',
  ]);
});
