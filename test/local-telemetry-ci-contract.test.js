import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ordinary CI captures one real standalone telemetry browser session', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /Capture real standalone telemetry in Chrome/);
  assert.match(workflow, /scripts\/local-game-eye-fixture\.mjs/);
  assert.match(workflow, /example\/canyon-charms\/telemetry-dist 4173/);
  assert.match(
    workflow,
    /http:\/\/127\.0\.0\.1:4173\/\?seed=12345&telemetryEvidence=1/,
  );
  assert.match(workflow, /--expected-build-sha "\$GITHUB_SHA"/);
  assert.match(workflow, /--output evidence\/local-browser-telemetry\.json/);
  assert.match(workflow, /test -s evidence\/local-browser-telemetry\.json/);
  assert.match(workflow, /source.*local-browser-telemetry-capture/si);
  assert.match(workflow, /runtimeMode.*standalone/si);
  assert.match(workflow, /sdkVersion.*null/si);
  assert.match(workflow, /httpStatus.*202/si);
  assert.match(workflow, /officialRuntimeRequests.*0/si);
  assert.match(workflow, /consoleErrorCount.*0/si);
  assert.match(workflow, /evidence\/local-browser-telemetry\.json/);
  assert.match(workflow, /telemetry-dist\/runtime-manifest\.json/);
  assert.match(workflow, /telemetry-dist\/telemetry-candidate-report\.json/);

  const verify = workflow.indexOf('Run complete repository verification');
  const capture = workflow.indexOf('Capture real standalone telemetry in Chrome');
  const upload = workflow.indexOf('Upload verified release artifacts');
  assert.ok(verify >= 0);
  assert.ok(capture > verify);
  assert.ok(upload > capture);
});

test('local fixture accepts only reviewed CORS game-event envelopes without raw logging', async () => {
  const source = await readFile(
    new URL('../scripts/local-game-eye-fixture.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /createServer/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /3001/);
  assert.match(source, /\/health/);
  assert.match(source, /\/v1\/game-events/);
  assert.match(source, /OPTIONS/);
  assert.match(source, /access-control-allow-origin/i);
  assert.match(source, /http:\/\/127\.0\.0\.1:4173/);
  assert.match(source, /65_536/);
  assert.match(source, /ark\.game-events\.v1/);
  assert.match(source, /platformMode.*standalone/s);
  assert.match(source, /sdkVersion.*null/s);
  assert.match(source, /validateCanonicalEvent/);
  assert.match(source, /statusCode\s*=\s*202/);
  assert.match(source, /accepted/);
  assert.doesNotMatch(
    source,
    /console\.(?:log|error)\([^\n]*(?:body|payload|envelope|event|header|request)/i,
  );
  assert.doesNotMatch(
    source,
    /password|authorization|access[_-]?token|refresh[_-]?token|cookie|credential/i,
  );
});
