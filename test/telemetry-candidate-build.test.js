import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildTelemetryCandidate,
  finalizeTelemetryCandidateManifest,
  verifyTelemetryCandidateOutput,
} from '../scripts/telemetry-candidate-lib.mjs';
import { buildProject } from '../scripts/project-lib.mjs';

const SHA = '1111111111111111111111111111111111111111';

function telemetryConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: 'standalone',
    arkadiumEnvironment: null,
    gameId: null,
    analyticsProvider: 'none',
    appInsightsId: null,
    gameEyeEndpoint: 'http://127.0.0.1:3001/v1/game-events',
    gameEyeProject: 'canyon-charms',
    gameVersion: '1.1.0',
    buildSha: '2222222222222222222222222222222222222222',
    ...overrides,
  };
}

test('telemetry candidate binds one local standalone endpoint to the exact build', () => {
  const manifest = finalizeTelemetryCandidateManifest(telemetryConfig(), {
    buildSha: SHA,
    gameVersion: '1.1.0',
  });

  assert.deepEqual(manifest, {
    schemaVersion: 1,
    mode: 'standalone',
    arkadiumEnvironment: null,
    gameId: null,
    analyticsProvider: 'none',
    appInsightsId: null,
    gameEyeEndpoint: 'http://127.0.0.1:3001/v1/game-events',
    gameEyeProject: 'canyon-charms',
    gameVersion: '1.1.0',
    buildSha: SHA,
  });
  assert.equal(Object.isFrozen(manifest), true);
});

test('telemetry candidate rejects publisher modes, absent endpoints and build drift', () => {
  const invalid = [
    telemetryConfig({
      mode: 'arkadium-sandbox',
      arkadiumEnvironment: 'DEV',
      analyticsProvider: 'console',
    }),
    telemetryConfig({ gameEyeEndpoint: null }),
    telemetryConfig({ gameEyeEndpoint: 'http://telemetry.example/v1/game-events' }),
    telemetryConfig({ gameEyeEndpoint: 'http://127.0.0.1:3001/not-game-events' }),
  ];
  for (const value of invalid) {
    assert.throws(
      () => finalizeTelemetryCandidateManifest(value, {
        buildSha: SHA,
        gameVersion: '1.1.0',
      }),
      /telemetry candidate|runtime configuration/i,
    );
  }

  assert.throws(
    () => finalizeTelemetryCandidateManifest(
      telemetryConfig({ gameVersion: '1.0.0' }),
      { buildSha: SHA, gameVersion: '1.1.0' },
    ),
    /game version/i,
  );
  for (const buildSha of [
    'ABCDEF1111111111111111111111111111111111',
    '111111111111111111111111111111111111111',
    '111111111111111111111111111111111111111g',
  ]) {
    assert.throws(
      () => finalizeTelemetryCandidateManifest(telemetryConfig(), {
        buildSha,
        gameVersion: '1.1.0',
      }),
      /exact lowercase commit SHA/i,
    );
  }
});

test('telemetry candidate build injects the manifest and emits nullable-SDK evidence', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'canyon-telemetry-candidate-'));
  const projectDir = join(temporary, 'example', 'canyon-charms');
  const outputDir = join(projectDir, 'telemetry-dist');
  const configPath = join(temporary, 'runtime.json');
  const calls = [];

  try {
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'index.html'), [
      '<!doctype html>',
      '<meta name="version" content="1.1.0">',
      '<script type="module" src="./src/main.js"></script>',
    ].join('\n'));
    await writeFile(join(projectDir, 'src', 'main.js'), 'console.log("candidate");\n');
    await writeFile(configPath, `${JSON.stringify(telemetryConfig(), null, 2)}\n`);

    const result = await buildTelemetryCandidate({
      rootDir: temporary,
      projectDir,
      configPath,
      buildSha: SHA,
      runViteBuild: async (options) => {
        calls.push(options);
        await mkdir(join(outputDir, 'assets'), { recursive: true });
        await writeFile(
          join(outputDir, 'index.html'),
          '<script type="module" src="./assets/app.js"></script>\n',
        );
        await writeFile(join(outputDir, 'assets', 'app.js'), 'console.log("bundled");\n');
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].root, projectDir);
    assert.equal(calls[0].build.outDir, outputDir);
    assert.equal(calls[0].build.sourcemap, false);
    assert.equal(calls[0].build.target, 'es2022');
    assert.equal(calls[0].base, './');
    assert.equal(
      calls[0].define['globalThis.__CANYON_RUNTIME_MANIFEST__'],
      JSON.stringify(result.manifest),
    );

    const emittedManifest = JSON.parse(await readFile(
      join(outputDir, 'runtime-manifest.json'),
      'utf8',
    ));
    const report = JSON.parse(await readFile(
      join(outputDir, 'telemetry-candidate-report.json'),
      'utf8',
    ));
    assert.deepEqual(emittedManifest, result.manifest);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.source, 'standalone-local-telemetry');
    assert.equal(report.buildSha, SHA);
    assert.equal(report.gameVersion, '1.1.0');
    assert.equal(report.runtimeMode, 'standalone');
    assert.equal(report.sdkVersion, null);
    assert.equal(report.files.some((file) => file.path === 'assets/app.js'), true);
    assert.equal(report.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)), true);
    assert.deepEqual(Object.keys(report), [
      'schemaVersion',
      'source',
      'buildSha',
      'gameVersion',
      'runtimeMode',
      'sdkVersion',
      'files',
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('telemetry output rejects source maps, raw TypeScript and unresolved modules', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'canyon-telemetry-invalid-'));
  const manifest = finalizeTelemetryCandidateManifest(telemetryConfig(), {
    buildSha: SHA,
    gameVersion: '1.1.0',
  });

  try {
    await writeFile(join(temporary, 'runtime-manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(
      join(temporary, 'index.html'),
      '<script type="module" src="./app.js"></script>\n',
    );
    await writeFile(join(temporary, 'app.js'), 'import "@arkadiuminc/sdk";\n');
    await assert.rejects(
      () => verifyTelemetryCandidateOutput(temporary, { manifest }),
      /bare import/i,
    );

    await writeFile(join(temporary, 'app.js'), 'import("https://cdn.example.com/app.js");\n');
    await assert.rejects(
      () => verifyTelemetryCandidateOutput(temporary, { manifest }),
      /external module/i,
    );

    await writeFile(join(temporary, 'app.js'), 'console.log("bundled");\n');
    await writeFile(join(temporary, 'source.ts'), 'export const raw: string = "no";\n');
    await assert.rejects(
      () => verifyTelemetryCandidateOutput(temporary, { manifest }),
      /uncompiled TypeScript/i,
    );
    await rm(join(temporary, 'source.ts'));

    await writeFile(join(temporary, 'app.js.map'), '{}\n');
    await assert.rejects(
      () => verifyTelemetryCandidateOutput(temporary, { manifest }),
      /source map/i,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('ordinary static build excludes standalone telemetry candidate output', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'canyon-telemetry-boundary-'));
  try {
    await mkdir(join(temporary, 'telemetry-dist'), { recursive: true });
    await writeFile(join(temporary, 'index.html'), '<title>Telemetry Boundary</title>\n');
    await writeFile(join(temporary, 'telemetry-dist', 'candidate.js'), 'console.log("candidate");\n');
    await writeFile(join(temporary, 'game.config.json'), `${JSON.stringify({
      slug: 'telemetry-boundary',
      title: 'Telemetry Boundary',
      entry: 'index.html',
      output: 'dist',
      buildBudgetBytes: 750000,
    }, null, 2)}\n`);

    const report = await buildProject(temporary);
    assert.equal(
      report.files.some((file) => file.path.startsWith('telemetry-dist/')),
      false,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('repository exposes one explicit standalone telemetry build command and config', async () => {
  const [packageSource, cliSource, configSource] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-telemetry-candidate.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../config/runtime.telemetry.example.json', import.meta.url), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageSource);
  const config = JSON.parse(configSource);

  assert.match(
    packageJson.scripts['build:telemetry'],
    /build-telemetry-candidate\.mjs/,
  );
  assert.match(cliSource, /buildTelemetryCandidate/);
  assert.match(cliSource, /--config/);
  assert.match(cliSource, /--build-sha/);
  assert.equal(config.mode, 'standalone');
  assert.equal(config.gameEyeEndpoint, 'http://127.0.0.1:3001/v1/game-events');
  assert.equal(config.gameVersion, '1.1.0');
  assert.doesNotMatch(
    `${cliSource}\n${configSource}`,
    /password|authorization|access[_-]?token|refresh[_-]?token|cookie|credential/i,
  );
});
