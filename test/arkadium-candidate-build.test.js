import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildArkadiumCandidate,
  finalizeCandidateManifest,
  verifyCandidateOutput,
} from '../scripts/arkadium-candidate-lib.mjs';
import { buildProject } from '../scripts/project-lib.mjs';

const SHA = '1111111111111111111111111111111111111111';

function sandboxConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: 'arkadium-sandbox',
    arkadiumEnvironment: 'DEV',
    gameId: null,
    analyticsProvider: 'console',
    appInsightsId: null,
    gameEyeEndpoint: 'http://127.0.0.1:3001/v1/game-events',
    gameEyeProject: 'canyon-charms',
    gameVersion: '1.1.0',
    buildSha: '2222222222222222222222222222222222222222',
    ...overrides,
  };
}

test('candidate manifest binds the requested publisher config to the exact build', () => {
  const manifest = finalizeCandidateManifest(sandboxConfig(), {
    buildSha: SHA,
    gameVersion: '1.1.0',
  });

  assert.equal(manifest.mode, 'arkadium-sandbox');
  assert.equal(manifest.arkadiumEnvironment, 'DEV');
  assert.equal(manifest.buildSha, SHA);
  assert.equal(manifest.gameVersion, '1.1.0');
  assert.equal(Object.isFrozen(manifest), true);
});

test('candidate manifest rejects standalone mode and version drift', () => {
  assert.throws(
    () => finalizeCandidateManifest(sandboxConfig({
      mode: 'standalone',
      arkadiumEnvironment: null,
      analyticsProvider: 'none',
    }), { buildSha: SHA, gameVersion: '1.1.0' }),
    /publisher mode/i,
  );

  assert.throws(
    () => finalizeCandidateManifest(sandboxConfig({ gameVersion: '1.0.0' }), {
      buildSha: SHA,
      gameVersion: '1.1.0',
    }),
    /game version/i,
  );
});

test('candidate build injects the manifest, writes evidence, and verifies the output', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'canyon-arkadium-candidate-'));
  const projectDir = join(temporary, 'example', 'canyon-charms');
  const outputDir = join(projectDir, 'arkadium-dist');
  const configPath = join(temporary, 'runtime.json');
  const packagePath = join(temporary, 'node_modules', '@arkadiuminc', 'sdk', 'package.json');
  const snapshotPath = join(temporary, 'vendor', 'arkadium-platform', 'manifest.json');
  const calls = [];

  try {
    await mkdir(projectDir, { recursive: true });
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await mkdir(join(packagePath, '..'), { recursive: true });
    await mkdir(join(snapshotPath, '..'), { recursive: true });
    await writeFile(join(projectDir, 'index.html'), [
      '<!doctype html>',
      '<meta name="version" content="1.1.0">',
      '<script type="module" src="./src/main.js"></script>',
    ].join('\n'));
    await writeFile(join(projectDir, 'src', 'main.js'), 'console.log("candidate");\n');
    await writeFile(configPath, `${JSON.stringify(sandboxConfig(), null, 2)}\n`);
    await writeFile(packagePath, `${JSON.stringify({ name: '@arkadiuminc/sdk', version: '2.66.2' })}\n`);
    await writeFile(snapshotPath, `${JSON.stringify({ sdkVersion: '2.66.2' })}\n`);

    const result = await buildArkadiumCandidate({
      rootDir: temporary,
      projectDir,
      configPath,
      buildSha: SHA,
      runViteBuild: async (options) => {
        calls.push(options);
        await mkdir(join(outputDir, 'assets'), { recursive: true });
        await writeFile(join(outputDir, 'index.html'), '<script type="module" src="./assets/app.js"></script>\n');
        await writeFile(join(outputDir, 'assets', 'app.js'), 'console.log("bundled");\n');
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].root, projectDir);
    assert.equal(calls[0].build.outDir, outputDir);
    assert.equal(calls[0].build.sourcemap, false);
    assert.equal(calls[0].base, './');
    assert.equal(
      calls[0].define['globalThis.__CANYON_RUNTIME_MANIFEST__'],
      JSON.stringify(result.manifest),
    );

    const emittedManifest = JSON.parse(await readFile(join(outputDir, 'runtime-manifest.json'), 'utf8'));
    const report = JSON.parse(await readFile(join(outputDir, 'candidate-report.json'), 'utf8'));
    assert.deepEqual(emittedManifest, result.manifest);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.buildSha, SHA);
    assert.equal(report.sdkVersion, '2.66.2');
    assert.equal(report.runtimeMode, 'arkadium-sandbox');
    assert.equal(report.files.some((file) => file.path === 'assets/app.js'), true);
    assert.equal(report.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)), true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('candidate verification rejects source maps, bare imports, and external module URLs', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'canyon-arkadium-invalid-'));
  const manifest = finalizeCandidateManifest(sandboxConfig(), {
    buildSha: SHA,
    gameVersion: '1.1.0',
  });

  try {
    await writeFile(join(temporary, 'runtime-manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(temporary, 'index.html'), '<script type="module" src="./app.js"></script>\n');
    await writeFile(join(temporary, 'app.js'), 'import "@arkadiuminc/sdk";\n');
    await assert.rejects(
      () => verifyCandidateOutput(temporary, { manifest, sdkVersion: '2.66.2' }),
      /bare import/i,
    );

    await writeFile(join(temporary, 'app.js'), 'import("https://cdn.example.com/sdk.js");\n');
    await assert.rejects(
      () => verifyCandidateOutput(temporary, { manifest, sdkVersion: '2.66.2' }),
      /external module/i,
    );

    await writeFile(join(temporary, 'app.js'), 'console.log("bundled");\n');
    await writeFile(join(temporary, 'app.js.map'), '{}\n');
    await assert.rejects(
      () => verifyCandidateOutput(temporary, { manifest, sdkVersion: '2.66.2' }),
      /source map/i,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('standalone build excludes candidate tooling and candidate output', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'canyon-standalone-boundary-'));
  try {
    await mkdir(join(temporary, 'arkadium-dist'), { recursive: true });
    await writeFile(join(temporary, 'index.html'), '<title>Standalone Boundary</title>\n');
    await writeFile(join(temporary, 'vite.config.ts'), 'throw new Error("build only");\n');
    await writeFile(join(temporary, 'arkadium-dist', 'candidate.js'), 'console.log("candidate");\n');
    await writeFile(join(temporary, 'game.config.json'), `${JSON.stringify({
      slug: 'standalone-boundary',
      title: 'Standalone Boundary',
      entry: 'index.html',
      output: 'dist',
      buildBudgetBytes: 750000,
    }, null, 2)}\n`);

    const report = await buildProject(temporary);
    assert.equal(report.files.some((file) => file.path === 'vite.config.ts'), false);
    assert.equal(report.files.some((file) => file.path.startsWith('arkadium-dist/')), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Canyon runtime and repository commands expose the official candidate track', async () => {
  const [runtimeSource, viteSource, packageSource, verifySource, workflowSource] = await Promise.all([
    readFile(new URL('../example/canyon-charms/src/integration/runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../example/canyon-charms/vite.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/verify.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  ]);

  assert.match(runtimeSource, /createRuntimePlatform/);
  assert.match(runtimeSource, /__CANYON_RUNTIME_MANIFEST__/);
  assert.match(runtimeSource, /platformMode:\s*runtimeManifest\.mode/);
  assert.match(viteSource, /defineConfig/);
  assert.match(viteSource, /arkadium-dist/);
  assert.match(viteSource, /sourcemap:\s*false/);

  const packageJson = JSON.parse(packageSource);
  assert.match(packageJson.scripts['build:arkadium'], /build-arkadium-candidate\.mjs/);
  assert.match(verifySource, /build-arkadium-candidate\.mjs/);
  assert.match(workflowSource, /arkadium-dist/);
  assert.match(workflowSource, /runtime-manifest\.json/);
  assert.match(workflowSource, /candidate-report\.json/);
});
