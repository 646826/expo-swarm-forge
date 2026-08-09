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

test('delivery guide documents the required one-time Pages source selection', async () => {
  const guide = await readFile(deliveryPath, 'utf8');
  assert.match(guide, /Settings[\s\S]*Pages[\s\S]*GitHub Actions/i);
});
