import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../.github/workflows/correlated-telemetry-gate.yml',
);

async function workflowSource() {
  return readFile(WORKFLOW_PATH, 'utf8');
}

test('correlated telemetry workflow runs the repository-owned gate on exact fixtures', async () => {
  const source = await workflowSource();

  assert.match(source, /^name: Correlated telemetry gate CI$/m);
  assert.match(source, /^permissions:\n  contents: read$/m);
  assert.match(source, /^  workflow_dispatch:$/m);
  assert.match(source, /^    runs-on: ubuntu-latest$/m);
  assert.match(source, /^    timeout-minutes: 10$/m);
  assert.match(
    source,
    /uses: actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/,
  );
  assert.match(
    source,
    /uses: actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
  );
  assert.match(source, /^          node-version: 22$/m);
  assert.match(source, /^          CANDIDATE_SHA: \$\{\{ github\.sha }}$/m);
  assert.match(source, /writeFileSync\('evidence\/sandbox-verification\.json'/);
  assert.match(source, /writeFileSync\('evidence\/sandbox-status\.json'/);
  assert.match(source, /writeFileSync\('evidence\/sandbox-events\.json'/);
  assert.match(source, /writeFileSync\('evidence\/ark-eye-correlation\.json'/);
  assert.match(source, /^        uses: \.\/\.github\/actions\/verify-correlated-telemetry$/m);
  assert.match(source, /^          expected-build-sha: \$\{\{ github\.sha }}$/m);
  assert.match(source, /^          output: evidence\/correlated-telemetry-report\.json$/m);
  assert.match(source, /report\.releaseState !== 'sandbox-telemetry-verified'/);
  assert.match(source, /report\.summary\.buildSha !== process\.env\.CANDIDATE_SHA/);
});

test('gate workflow has no external producer, credential, secret or mutable action reference', async () => {
  const source = await workflowSource();

  assert.doesNotMatch(source, /repository:/);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(source, /token|password|credential/i);
  assert.doesNotMatch(source, /uses:\s+[^\n]+@(main|master|v\d+)\s*$/m);
  assert.doesNotMatch(source, /curl|wget|gh\s|docker/);
});
