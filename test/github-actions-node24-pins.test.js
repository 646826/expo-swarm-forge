import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKFLOW_DIRECTORY = new URL('../.github/workflows/', import.meta.url);
const ACTIONS = Object.freeze({
  'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node': '820762786026740c76f36085b0efc47a31fe5020',
  'actions/upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
});
const RETIRED_NODE20_PINS = Object.freeze([
  '11bd71901bbe5b1630ceea73d27597364c9af683',
  '49933ea5288caeca8642d1e84afbd3f7d6820020',
  'ea165f8d65b6e75b540449e92b4886f43607fa02',
]);

async function workflowSource() {
  const names = (await readdir(WORKFLOW_DIRECTORY))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  assert.equal(names.length > 0, true);
  const sources = await Promise.all(names.map(async (name) => ({
    name,
    text: await readFile(new URL(name, WORKFLOW_DIRECTORY), 'utf8'),
  })));
  return sources;
}

test('all reviewed first-party JavaScript actions use exact Node 24 commit pins', async () => {
  const workflows = await workflowSource();
  const combined = workflows.map(({ text }) => text).join('\n');

  for (const retired of RETIRED_NODE20_PINS) {
    assert.doesNotMatch(combined, new RegExp(retired));
  }

  for (const [action, expectedSha] of Object.entries(ACTIONS)) {
    const references = [];
    const pattern = new RegExp(
      `uses:\\s*${action.replace('/', '\\/')}@([^\\s#]+)`,
      'g',
    );
    for (const { name, text } of workflows) {
      for (const match of text.matchAll(pattern)) {
        references.push({ name, ref: match[1] });
      }
    }
    assert.equal(references.length > 0, true, `${action} is not used`);
    for (const reference of references) {
      assert.equal(
        reference.ref,
        expectedSha,
        `${reference.name} uses an unreviewed ${action} ref`,
      );
    }
  }
});
