import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
  verifyCorrelatedTelemetryEvidence,
} from './correlated-telemetry-evidence-lib.mjs';

const MAX_INPUT_BYTES = 65_536;
const MAX_AGE_MS = 15 * 60_000;
const MAX_ALLOWED_AGE_MS = 24 * 60 * 60_000;
const EXPECTED_SDK_VERSION = '2.66.2';
const BUILD_SHA = /^[0-9a-f]{40}$/;
const INTEGER = /^(0|[1-9]\d{0,15})$/;
const REQUIRED_FLAGS = Object.freeze([
  '--sandbox-verification',
  '--sandbox-status',
  '--sandbox-events',
  '--ark-eye-evidence',
  '--expected-build-sha',
  '--output',
]);
const OPTIONAL_FLAGS = Object.freeze([
  '--now-ms',
  '--max-age-ms',
]);
const ALLOWED_FLAGS = new Set([...REQUIRED_FLAGS, ...OPTIONAL_FLAGS]);

function commandError() {
  throw new Error('Correlated telemetry evidence command failed.');
}

function parseArguments(values) {
  if (!Array.isArray(values) || values.length % 2 !== 0) commandError();
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (typeof flag !== 'string'
      || !ALLOWED_FLAGS.has(flag)
      || parsed.has(flag)
      || typeof value !== 'string'
      || value.length === 0
      || value.includes('\0')) {
      commandError();
    }
    parsed.set(flag, value);
  }
  if (REQUIRED_FLAGS.some((flag) => !parsed.has(flag))) commandError();
  return parsed;
}

function safeInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!INTEGER.test(value)) commandError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) commandError();
  return parsed;
}

function exactPaths(argumentsMap) {
  const paths = Object.freeze({
    verification: resolve(argumentsMap.get('--sandbox-verification')),
    status: resolve(argumentsMap.get('--sandbox-status')),
    events: resolve(argumentsMap.get('--sandbox-events')),
    arkEye: resolve(argumentsMap.get('--ark-eye-evidence')),
    output: resolve(argumentsMap.get('--output')),
  });
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length) {
    commandError();
  }
  return paths;
}

async function readBoundedJson(path) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    return commandError();
  }
  if (!(bytes instanceof Uint8Array)
    || bytes.byteLength < 2
    || bytes.byteLength > MAX_INPUT_BYTES) {
    commandError();
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return commandError();
  }
  try {
    return JSON.parse(text);
  } catch {
    return commandError();
  }
}

async function writeReport(path, report) {
  const directory = dirname(path);
  const temporary = resolve(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const paths = exactPaths(argumentsMap);
  const expectedBuildSha = argumentsMap.get('--expected-build-sha');
  if (!BUILD_SHA.test(expectedBuildSha)) commandError();

  const nowMs = safeInteger(
    argumentsMap.get('--now-ms'),
    Date.now(),
  );
  const maxAgeMs = safeInteger(
    argumentsMap.get('--max-age-ms'),
    MAX_AGE_MS,
    MAX_ALLOWED_AGE_MS,
  );
  if (maxAgeMs < 1) commandError();

  const [verification, status, events, arkEye] = await Promise.all([
    readBoundedJson(paths.verification),
    readBoundedJson(paths.status),
    readBoundedJson(paths.events),
    readBoundedJson(paths.arkEye),
  ]);
  const report = verifyCorrelatedTelemetryEvidence({
    sandbox: {
      verification,
      status,
      events,
    },
    arkEye,
  }, {
    expectedBuildSha,
    expectedSdkVersion: EXPECTED_SDK_VERSION,
    nowMs,
    maxAgeMs,
  });

  await writeReport(paths.output, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

try {
  await main();
} catch {
  console.error('Correlated telemetry evidence command failed.');
  process.exitCode = 1;
}
