import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('official Sandbox evidence stays independent of the local Game Eye endpoint', async () => {
  const [workflow, runtime] = await Promise.all([
    readFile(new URL('../.github/workflows/arkadium-sandbox.yml', import.meta.url), 'utf8'),
    readFile(new URL('../example/canyon-charms/src/integration/runtime.js', import.meta.url), 'utf8'),
  ]);

  assert.match(workflow, /runtime\.sandbox\.official\.json/);
  assert.match(workflow, /GAME_EYE_ENDPOINT:\s*\$\{\{\s*secrets\.GAME_EYE_ENDPOINT\s*}}/);
  assert.match(workflow, /endpoint\.protocol !== 'https:'/);
  assert.match(workflow, /gameEyeEndpoint:\s*endpoint \? endpoint\.href : null/);
  assert.match(workflow, /build:arkadium -- --config/);
  assert.doesNotMatch(workflow, /127\.0\.0\.1:3001/);

  assert.match(runtime, /gameEyeSink\?\.sessionId\s*\?\?/);
  assert.match(runtime, /crypto\?\.randomUUID\?\.\(\)/);
  assert.match(runtime, /sessionId:\s*sandboxSessionId/);
  assert.doesNotMatch(runtime, /const evidenceApi = gameEyeSink\s*\?/);
});
