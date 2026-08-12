import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ACTION_PATH = resolve(
  import.meta.dirname,
  '../.github/actions/verify-correlated-telemetry/action.yml',
);

async function actionSource() {
  return readFile(ACTION_PATH, 'utf8');
}

test('composite action exposes only the exact correlated evidence inputs', async () => {
  const source = await actionSource();

  assert.match(source, /^name: Verify correlated Sandbox telemetry$/m);
  for (const input of [
    'sandbox-verification',
    'sandbox-status',
    'sandbox-events',
    'ark-eye-evidence',
    'expected-build-sha',
    'output',
  ]) {
    assert.match(source, new RegExp(`^  ${input}:\\n(?:    .+\\n)*?    required: true$`, 'm'));
  }
  assert.match(source, /^  max-age-ms:\n(?:    .+\n)*?    required: false\n    default: '900000'$/m);
  assert.doesNotMatch(source, /^  [a-z0-9-]*(?:token|secret|password|credential)[a-z0-9-]*:/mi);
});

test('composite action passes expressions through quoted environment values', async () => {
  const source = await actionSource();

  const bindings = {
    SANDBOX_VERIFICATION_PATH: 'sandbox-verification',
    SANDBOX_STATUS_PATH: 'sandbox-status',
    SANDBOX_EVENTS_PATH: 'sandbox-events',
    ARK_EYE_EVIDENCE_PATH: 'ark-eye-evidence',
    EXPECTED_BUILD_SHA: 'expected-build-sha',
    CORRELATED_OUTPUT_PATH: 'output',
    CORRELATED_MAX_AGE_MS: 'max-age-ms',
  };
  for (const [name, input] of Object.entries(bindings)) {
    assert.match(
      source,
      new RegExp(`^        ${name}: \\${{ inputs\\.${input} }}$`, 'm'),
    );
  }

  assert.match(source, /^      shell: bash$/m);
  assert.match(source, /^        set -Eeuo pipefail$/m);
  assert.match(
    source,
    /node "\$GITHUB_ACTION_PATH\/\.\.\/\.\.\/\.\.\/scripts\/verify-correlated-telemetry-evidence\.mjs"/,
  );
  for (const [flag, variable] of [
    ['--sandbox-verification', 'SANDBOX_VERIFICATION_PATH'],
    ['--sandbox-status', 'SANDBOX_STATUS_PATH'],
    ['--sandbox-events', 'SANDBOX_EVENTS_PATH'],
    ['--ark-eye-evidence', 'ARK_EYE_EVIDENCE_PATH'],
    ['--expected-build-sha', 'EXPECTED_BUILD_SHA'],
    ['--output', 'CORRELATED_OUTPUT_PATH'],
    ['--max-age-ms', 'CORRELATED_MAX_AGE_MS'],
  ]) {
    assert.match(source, new RegExp(`${flag} "\\$${variable}"`));
  }
  assert.doesNotMatch(source, /\$\{\{\s*(?:secrets|github\.token)/);
  assert.doesNotMatch(source, /eval|bash\s+-c|sh\s+-c/);
});
