import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('deterministic browser driver is explicit for Sandbox and standalone telemetry only', async () => {
  const source = await readFile(
    new URL('../example/canyon-charms/vite.config.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /sandboxEvidence/);
  assert.match(source, /telemetryEvidence/);
  assert.match(
    source,
    /sandboxEvidence\s*&&\s*sandboxRuntimeManifest\?\.mode\s*===\s*['"]arkadium-sandbox['"]/,
  );
  assert.match(
    source,
    /telemetryEvidence\s*&&\s*sandboxRuntimeManifest\?\.mode\s*===\s*['"]standalone['"]/,
  );
  assert.match(source, /sandboxRuntimeManifest\.mode\s*!==\s*['"]arkadium-prod['"]/);
  assert.match(source, /__CANYON_SANDBOX_DRIVER__/);
  assert.match(source, /findHint\(game\)/);
  assert.match(source, /configurable:\s*true/);
  assert.match(source, /enumerable:\s*false/);
  assert.match(source, /writable:\s*false/);
  assert.match(source, /pagehide/);
});

test('standalone telemetry opt-in cannot weaken the existing Sandbox evidence switch', async () => {
  const source = await readFile(
    new URL('../example/canyon-charms/vite.config.ts', import.meta.url),
    'utf8',
  );

  const sandboxCheck = source.indexOf("sandboxRuntimeManifest?.mode === 'arkadium-sandbox'");
  const standaloneCheck = source.indexOf("sandboxRuntimeManifest?.mode === 'standalone'");
  const driverInstall = source.indexOf("Object.defineProperty(globalThis, '__CANYON_SANDBOX_DRIVER__'");
  assert.ok(sandboxCheck >= 0);
  assert.ok(standaloneCheck > sandboxCheck);
  assert.ok(driverInstall > standaloneCheck);
  assert.doesNotMatch(
    source.slice(0, driverInstall),
    /arkadium-prod[^\n]*\|\||\|\|[^\n]*arkadium-prod/,
  );
});
