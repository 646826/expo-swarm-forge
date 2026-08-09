import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('title screen explains the goal and every power-up recipe', async () => {
  const html = await read('example/canyon-charms/index.html');
  assert.match(html, /5,000<\/strong> points/);
  assert.match(html, /20<\/strong> moves/);
  assert.match(html, /Three in a row/);
  assert.match(html, /Four in a row/);
  assert.match(html, /Five, T, or L/);
  assert.match(html, /clarity\.css/);
});

test('playfield and help surface explain hints and invalid swaps', async () => {
  const html = await read('example/canyon-charms/index.html');
  assert.match(html, /Automatic hint after 8 quiet seconds/);
  assert.match(html, /Invalid swaps return automatically and do not spend a move/);
  assert.match(html, /Rules & controls/);
});

test('complete verification command covers both releases and the handbook', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const verify = await read('scripts/verify.mjs');
  assert.equal(packageJson.scripts.verify, 'node scripts/verify.mjs');
  assert.match(verify, /template\/browser-game/);
  assert.match(verify, /example\/canyon-charms/);
  assert.match(verify, /student-handbook-ru\.pdf/);
});

test('CI runs the complete gate and boots the current game build in Chrome', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /example\/canyon-charms\/dist/);
  assert.match(workflow, /--headless=new/);
  assert.match(workflow, /canyon-current\.png/);
});

test('Russian start guide provides one command and an honest publication status', async () => {
  const guide = await read('docs/START_HERE_RU.md');
  assert.match(guide, /npm run verify/);
  assert.match(guide, /5 000/);
  assert.match(guide, /20 ходов/);
  assert.match(guide, /GitHub Pages/);
  assert.match(guide, /Arkadium/);
});
