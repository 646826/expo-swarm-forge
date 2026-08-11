import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('verified telemetry evidence is not invalidated by best-effort browser cleanup', async () => {
  const source = await readFile(
    new URL('../scripts/capture-local-telemetry-evidence.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /try\s*{\s*client\?\.close\(\);\s*}\s*catch\s*{/s);
  assert.match(source, /await browser\.close\(\)\.catch\(\(\) => undefined\)/);
});
