import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('telemetry console evidence excludes generic browser network log entries', async () => {
  const source = await readFile(
    new URL('../scripts/capture-local-telemetry-evidence.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /Runtime\.exceptionThrown/);
  assert.match(source, /Runtime\.consoleAPICalled/);
  assert.doesNotMatch(source, /Log\.entryAdded/);
  assert.doesNotMatch(source, /Log\.enable/);
});
