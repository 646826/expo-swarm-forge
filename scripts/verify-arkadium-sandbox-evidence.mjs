import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { verifySandboxEvidenceDirectory } from './arkadium-sandbox-evidence-lib.mjs';
import { ROOT } from './project-lib.mjs';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function integerOption(name, fallback) {
  const raw = option(name, String(fallback));
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} requires a safe integer.`);
  return value;
}

const directory = resolve(ROOT, option('--directory', 'evidence/arkadium-sandbox'));
const output = resolve(directory, option('--output', 'sandbox-verification.json'));
const expectedBuildSha = option('--expected-build-sha');
const expectedSdkVersion = option('--expected-sdk-version', '2.66.2');
const nowMs = integerOption('--now-ms', Date.now());
const maxAgeMs = integerOption('--max-age-ms', 15 * 60_000);

if (!expectedBuildSha) throw new Error('--expected-build-sha is required.');

let report;
try {
  report = await verifySandboxEvidenceDirectory(directory, {
    expectedBuildSha,
    expectedSdkVersion,
    nowMs,
    maxAgeMs,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : 'Sandbox evidence verification failed.';
  report = Object.freeze({
    ok: false,
    releaseState: 'contract-ready',
    errors: Object.freeze([message]),
    summary: Object.freeze({}),
  });
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (!report.ok) {
  for (const error of report.errors) console.error(`Sandbox evidence: ${error}`);
  process.exit(1);
}

console.log([
  'Arkadium Sandbox evidence verified.',
  `Build: ${expectedBuildSha}`,
  `SDK: ${expectedSdkVersion}`,
  `State: ${report.releaseState}`,
].join(' '));
