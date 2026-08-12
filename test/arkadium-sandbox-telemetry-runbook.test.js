import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runbookUrl = new URL('../docs/ARKADIUM_SANDBOX_RUNBOOK.md', import.meta.url);
const checklistUrl = new URL('../docs/ARKADIUM_CHECKLIST.md', import.meta.url);

function ordered(text, values) {
  let previous = -1;
  for (const value of values) {
    const index = text.indexOf(value);
    assert.equal(index > previous, true, `${value} is missing or out of order`);
    previous = index;
  }
}

test('runbook documents the monotonic correlated release state', async () => {
  const runbook = await readFile(runbookUrl, 'utf8');

  assert.match(runbook, /five monotonic release states/i);
  ordered(runbook, [
    '`contract-ready`',
    '`sandbox-verified`',
    '`sandbox-telemetry-verified`',
    '`arkadium-dev-ready`',
    '`production-approved`',
  ]);
  assert.match(runbook, /does not replace Arkadium approval/i);
  assert.match(runbook, /Retaining `sandbox-verified`/);
  assert.match(runbook, /only exact correlated evidence/i);
});

test('runbook documents protected inputs and privacy-safe artifacts', async () => {
  const runbook = await readFile(runbookUrl, 'utf8');

  for (const name of [
    'GAME_EYE_ENDPOINT',
    'ARK_EYE_CORRELATION_EVIDENCE_URL',
    'ARK_EYE_CORRELATION_EVIDENCE_TOKEN',
  ]) {
    assert.match(runbook, new RegExp(`\\b${name}\\b`));
  }
  assert.match(runbook, /HTTPS endpoint/i);
  assert.match(runbook, /buildSha.*sessionId.*sdkVersion/is);
  assert.match(runbook, /30-second timeout/i);
  assert.match(runbook, /256 KiB/i);
  assert.match(runbook, /never log.*endpoint.*token.*response body/is);
  assert.match(runbook, /ark-eye-correlation\.json/);
  assert.match(runbook, /correlated-telemetry-verification\.json/);
  assert.match(runbook, /copied.*only after.*verifier.*success/is);
});

test('submission checklist exposes the optional telemetry promotion gate', async () => {
  const checklist = await readFile(checklistUrl, 'utf8');

  assert.match(checklist, /protected HTTPS Game Eye endpoint/i);
  assert.match(checklist, /same build, session and SDK/i);
  assert.match(checklist, /`sandbox-telemetry-verified`/);
  ordered(checklist, [
    '`contract-ready`',
    '`sandbox-verified`',
    '`sandbox-telemetry-verified`',
    '`arkadium-dev-ready`',
    '`production-approved`',
  ]);
});
