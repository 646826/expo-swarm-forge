import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('protected Sandbox workflow executes only candidates already reachable from main', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/arkadium-sandbox.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /git fetch --no-tags origin main:refs\/remotes\/origin\/main/);
  assert.match(workflow, /git merge-base --is-ancestor "\$CANDIDATE_SHA" refs\/remotes\/origin\/main/);
  assert.match(workflow, /Candidate SHA is not reachable from the trusted main branch/);
  assert.doesNotMatch(workflow, /pull_request_target/);
});
