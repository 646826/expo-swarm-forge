import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/arkadium-sandbox.yml', import.meta.url);

test('protected workflow builds an optional exact HTTPS Game Eye candidate', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /prepare:\s*\n(?:[\s\S]*?)environment:\s*\n\s+name:\s*arkadium-sandbox/);
  assert.match(workflow, /outputs:\s*\n\s+telemetry_enabled:\s*\$\{\{\s*steps\.runtime\.outputs\.telemetry_enabled\s*}}/);
  assert.match(workflow, /GAME_EYE_ENDPOINT:\s*\$\{\{\s*secrets\.GAME_EYE_ENDPOINT\s*}}/);
  assert.match(workflow, /name:\s*Write optional protected telemetry official Sandbox runtime config/);
  assert.match(workflow, /id:\s*runtime/);
  assert.match(workflow, /new URL\(process\.env\.GAME_EYE_ENDPOINT\)/);
  assert.match(workflow, /endpoint\.protocol !== 'https:'/);
  assert.match(workflow, /gameEyeEndpoint:\s*endpoint \? endpoint\.href : null/);
  assert.match(workflow, /telemetry_enabled=/);
  assert.match(workflow, /assert\.equal\(manifest\.gameEyeEndpoint, expectedEndpoint\)/);
});

test('protected workflow retrieves only same-session Ark Eye evidence and verifies it', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /needs:\s*\[prepare, deploy]/);
  assert.match(workflow, /ARK_EYE_CORRELATION_EVIDENCE_URL:\s*\$\{\{\s*secrets\.ARK_EYE_CORRELATION_EVIDENCE_URL\s*}}/);
  assert.match(workflow, /ARK_EYE_CORRELATION_EVIDENCE_TOKEN:\s*\$\{\{\s*secrets\.ARK_EYE_CORRELATION_EVIDENCE_TOKEN\s*}}/);
  assert.match(workflow, /name:\s*Decide protected telemetry correlation/);
  assert.match(workflow, /id:\s*correlation/);
  assert.match(workflow, /Retaining sandbox-verified/);
  assert.match(workflow, /name:\s*Retrieve same-session Ark Eye correlation evidence/);
  assert.match(workflow, /if:\s*steps\.correlation\.outputs\.enabled == 'true'/);
  assert.match(workflow, /url\.searchParams\.set\('buildSha', status\.buildSha\)/);
  assert.match(workflow, /url\.searchParams\.set\('sessionId', status\.sessionId\)/);
  assert.match(workflow, /url\.searchParams\.set\('sdkVersion', status\.sdkVersion\)/);
  assert.match(workflow, /authorization:\s*`Bearer \$\{process\.env\.ARK_EYE_CORRELATION_EVIDENCE_TOKEN}`/);
  assert.match(workflow, /AbortSignal\.timeout\(30_000\)/);
  assert.match(workflow, /ark-eye-correlation\.json/);
  assert.match(workflow, /verify-correlated-telemetry-evidence\.mjs/);
  assert.match(workflow, /"releaseState": "sandbox-telemetry-verified"/);
});

test('raw protected response is uploaded only after exact correlation succeeds', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /cp "\$RUNNER_TEMP\/ark-eye-correlation\.json" \\\n\s+evidence\/arkadium-sandbox\/ark-eye-correlation\.json/);
  assert.match(workflow, /evidence\/arkadium-sandbox\/ark-eye-correlation\.json/);
  assert.match(workflow, /evidence\/arkadium-sandbox\/correlated-telemetry-verification\.json/);
  assert.doesNotMatch(workflow, /set -x|echo "\$GAME_EYE_ENDPOINT"|echo "\$ARK_EYE_CORRELATION_EVIDENCE_TOKEN"/);
  assert.doesNotMatch(workflow, /console\.(?:log|error)\([^\n]*(?:responseText|responseBody|token|endpoint)/i);
});
