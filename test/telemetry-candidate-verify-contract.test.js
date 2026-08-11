import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('complete repository verification builds the exact standalone telemetry candidate', async () => {
  const source = await readFile(
    new URL('../scripts/verify.mjs', import.meta.url),
    'utf8',
  );

  const telemetry = source.indexOf('scripts/build-telemetry-candidate.mjs');
  const handbook = source.indexOf('tools/generate-canyon-handbook.mjs');
  assert.ok(telemetry >= 0);
  assert.ok(handbook > telemetry);
  assert.match(source, /config\/runtime\.telemetry\.example\.json/);
  assert.match(source, /exact standalone telemetry candidate bundle/);
});
