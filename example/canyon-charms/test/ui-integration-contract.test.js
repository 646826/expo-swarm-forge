import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('game UI uses the typed integration runtime instead of guessed publisher globals', async () => {
  const source = await read('src/main.js');

  assert.match(source, /createCanyonIntegration/);
  assert.match(source, /\.\/integration\/runtime\.js/);
  assert.doesNotMatch(source, /createPublisherPlatform/);
  assert.doesNotMatch(source, /\bplatform\.(?:loaded|connect|started|paused|resumed|completed|submitScore|track)\b/);

  for (const method of [
    'boot',
    'startLevel',
    'moveRejected',
    'moveAccepted',
    'pause',
    'resume',
    'complete',
  ]) {
    assert.match(source, new RegExp(`integration\\.${method}\\(`), method);
  }
});

test('UI publishes only structural integration evidence into the DOM', async () => {
  const source = await read('src/main.js');
  assert.match(source, /dataset\.integrationPhase/);
  assert.match(source, /dataset\.integrationEventCount/);
  assert.match(source, /dataset\.integrationLastEvent/);
  assert.doesNotMatch(source, /dataset\.(?:token|credential|profile|savePayload|appInsightsId)/i);
});

test('Chrome CI requires a ready integration runtime before accepting the build', async () => {
  const workflow = await read('../../../.github/workflows/ci.yml');
  assert.match(workflow, /data-integration-phase="ready"/);
  assert.match(workflow, /data-integration-last-event="sdk_ready"/);
  assert.match(workflow, /data-integration-event-count="3"/);
});
