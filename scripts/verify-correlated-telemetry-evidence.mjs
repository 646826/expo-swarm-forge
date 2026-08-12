import {
  lstat,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';

import { verifyCorrelatedTelemetryEvidence } from './correlated-telemetry-evidence-lib.mjs';
import { ROOT } from './project-lib.mjs';

const MAX_EVIDENCE_BYTES = 256 * 1_024;
const DEFAULT_DIRECTORY = 'evidence/arkadium-sandbox';
const DEFAULT_OUTPUT = 'correlated-telemetry-verification.json';
const DEFAULT_SDK_VERSION = '2.66.2';
const DEFAULT_MAX_AGE_MS = 15 * 60_000;
const OPTION_NAMES = new Set([
  '--directory',
  '--ark-eye-evidence',
  '--output',
  '--expected-build-sha',
  '--expected-sdk-version',
  '--now-ms',
  '--max-age-ms',
]);

const COMMAND_FAILURE_REPORT = Object.freeze({
  ok: false,
  releaseState: 'sandbox-verified',
  errors: Object.freeze(['Correlated telemetry evidence command failed.']),
  summary: Object.freeze({}),
});

function commandError() {
  throw new Error('Correlated telemetry evidence command failed.');
}

function parseOptions(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!OPTION_NAMES.has(name)
      || values.has(name)
      || typeof value !== 'string'
      || value.length === 0
      || value.startsWith('--')) {
      commandError();
    }
    values.set(name, value);
  }
  return values;
}

function integerOption(values, name, fallback) {
  const raw = values.get(name) ?? String(fallback);
  if (!/^(0|[1-9]\d*)$/.test(raw)) commandError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) commandError();
  return value;
}

function inside(directory, path) {
  const offset = relative(directory, path);
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
}

async function readJsonFile(path) {
  let metadata;
  let bytes;
  try {
    metadata = await lstat(path);
    if (!metadata.isFile()
      || metadata.isSymbolicLink()
      || metadata.size < 2
      || metadata.size > MAX_EVIDENCE_BYTES) {
      commandError();
    }
    bytes = await readFile(path);
  } catch {
    return commandError();
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    return commandError();
  }
}

async function main() {
  const values = parseOptions(process.argv.slice(2));
  const expectedBuildSha = values.get('--expected-build-sha');
  const expectedSdkVersion = values.get('--expected-sdk-version') ?? DEFAULT_SDK_VERSION;
  const arkEyeOption = values.get('--ark-eye-evidence');
  if (!expectedBuildSha || !arkEyeOption) commandError();

  const directory = resolve(ROOT, values.get('--directory') ?? DEFAULT_DIRECTORY);
  const output = resolve(directory, values.get('--output') ?? DEFAULT_OUTPUT);
  const arkEyePath = resolve(ROOT, arkEyeOption);
  const sandboxPaths = Object.freeze({
    verification: resolve(directory, 'sandbox-verification.json'),
    status: resolve(directory, 'sandbox-status.json'),
    events: resolve(directory, 'sandbox-events.json'),
  });
  if (!inside(directory, output)
    || output === arkEyePath
    || Object.values(sandboxPaths).includes(output)) {
    commandError();
  }

  const nowMs = integerOption(values, '--now-ms', Date.now());
  const maxAgeMs = integerOption(values, '--max-age-ms', DEFAULT_MAX_AGE_MS);

  let report;
  try {
    const [verification, status, events, arkEye] = await Promise.all([
      readJsonFile(sandboxPaths.verification),
      readJsonFile(sandboxPaths.status),
      readJsonFile(sandboxPaths.events),
      readJsonFile(arkEyePath),
    ]);
    report = verifyCorrelatedTelemetryEvidence({
      sandbox: { verification, status, events },
      arkEye,
    }, {
      expectedBuildSha,
      expectedSdkVersion,
      nowMs,
      maxAgeMs,
    });
  } catch {
    report = COMMAND_FAILURE_REPORT;
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (!report.ok) {
    for (const error of report.errors) {
      console.error(`Correlated telemetry evidence: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log([
    'Arkadium Sandbox telemetry correlation verified.',
    `Build: ${expectedBuildSha}`,
    `SDK: ${expectedSdkVersion}`,
    `State: ${report.releaseState}`,
  ].join(' '));
}

try {
  await main();
} catch {
  console.error('Correlated telemetry evidence command failed.');
  process.exitCode = 1;
}
