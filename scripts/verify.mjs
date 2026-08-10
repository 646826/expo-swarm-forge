import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, pathExists } from './project-lib.mjs';

const steps = [];

if (await pathExists(join(ROOT, 'vendor', 'arkadium-platform', 'manifest.json'))) {
  steps.push({
    name: 'Arkadium adapter snapshot',
    command: process.execPath,
    args: ['scripts/verify-arkadium-snapshot.mjs'],
  });
}

steps.push(
  {
    name: 'all Node tests',
    command: process.execPath,
    args: ['scripts/run-tests.mjs'],
  },
  {
    name: 'static checks and deterministic builds',
    command: process.execPath,
    args: ['scripts/check.mjs'],
  },
  {
    name: 'starter release package',
    command: process.execPath,
    args: ['scripts/package.mjs', '--project', 'template/browser-game'],
  },
  {
    name: 'Canyon Charms release package',
    command: process.execPath,
    args: ['scripts/package.mjs', '--project', 'example/canyon-charms'],
  },
  {
    name: 'exact Arkadium candidate bundle',
    command: process.execPath,
    args: [
      'scripts/build-arkadium-candidate.mjs',
      '--config',
      'config/runtime.sandbox.example.json',
    ],
  },
  {
    name: 'Russian student handbook',
    command: process.execPath,
    args: [
      'tools/generate-canyon-handbook.mjs',
      '--output',
      'example/canyon-charms/dist/student-handbook-ru.pdf',
    ],
  },
);

for (const step of steps) {
  console.log(`\n=== ${step.name} ===`);
  const result = spawnSync(step.command, step.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Verification stopped at: ${step.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nVerification complete: tests, checks, standalone packages, exact Arkadium candidate, handbook, and committed integration snapshots passed.');
