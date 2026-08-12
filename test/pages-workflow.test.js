import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = '.github/workflows/deploy-canyon-pages.yml';
const deliveryPath = 'docs/CANYON_CHARMS_DELIVERY.md';

test('Pages workflow does not request unsupported first-time enablement with GITHUB_TOKEN', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.doesNotMatch(workflow, /^\s+enablement:\s*true\s*$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
});

test('Pages workflow succeeds without deployment until Pages is enabled', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /^\s+outputs:\s*\n\s+pages_enabled:\s*\$\{\{\s*steps\.pages\.outputs\.enabled\s*}}\s*$/m);
  assert.match(workflow, /^\s+- name: Detect enabled GitHub Pages configuration\s*\n\s+id: pages\s*$/m);
  assert.match(workflow, /status="\$\(curl[\s\S]*--write-out '%\{http_code}'/);
  assert.match(workflow, /^\s+200\)\s*$/m);
  assert.match(workflow, /^\s+404\)\s*$/m);
  assert.match(workflow, /printf 'enabled=true\\n' >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /printf 'enabled=false\\n' >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /^\s+if:\s+steps\.pages\.outputs\.enabled == 'true'\s*$/m);
  assert.match(workflow, /^\s+if:\s+needs\.build\.outputs\.pages_enabled == 'true'\s*$/m);
  assert.doesNotMatch(workflow, /curl[\s\S]*\$GITHUB_TOKEN[\s\S]*--verbose/);
});

test('delivery guide documents the required one-time Pages source selection', async () => {
  const guide = await readFile(deliveryPath, 'utf8');
  assert.match(guide, /Settings[\s\S]*Pages[\s\S]*GitHub Actions/i);
});
