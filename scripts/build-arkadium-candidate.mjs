import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { buildArkadiumCandidate } from './arkadium-candidate-lib.mjs';
import { ROOT } from './project-lib.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function currentCommitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error('Unable to resolve the exact candidate commit SHA.');
  }
  return result.stdout.trim();
}

const configPath = resolve(ROOT, option('--config') ?? 'config/runtime.sandbox.example.json');
const buildSha = option('--build-sha') ?? currentCommitSha();
const result = await buildArkadiumCandidate({
  rootDir: ROOT,
  projectDir: resolve(ROOT, 'example/canyon-charms'),
  configPath,
  buildSha,
});

console.log([
  `Built Arkadium candidate ${result.manifest.mode}.`,
  `Build: ${result.manifest.buildSha}`,
  `SDK: ${result.report.sdkVersion}`,
  `Output: ${result.outputDir}`,
].join(' '));
