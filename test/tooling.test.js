import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyStarter, safeSlug, replaceTokens, validateProjectConfig } from '../scripts/project-lib.mjs';

test('safeSlug accepts lowercase game slugs and rejects traversal', () => {
  assert.equal(safeSlug('my-game'), 'my-game');
  for (const value of ['../game', 'Game', 'a', 'two words', 'a/'.repeat(10)]) {
    assert.throws(() => safeSlug(value));
  }
});

test('replaceTokens substitutes starter title and slug', () => {
  assert.equal(replaceTokens('__GAME_TITLE__ / __GAME_SLUG__', { title: 'My Game', slug: 'my-game' }), 'My Game / my-game');
});

test('validateProjectConfig requires bounded static project fields', () => {
  assert.deepEqual(validateProjectConfig({ slug: 'my-game', title: 'My Game', entry: 'index.html', output: 'dist', buildBudgetBytes: 750000 }), {
    slug: 'my-game', title: 'My Game', entry: 'index.html', output: 'dist', buildBudgetBytes: 750000,
  });
  assert.throws(() => validateProjectConfig({ slug: '../bad' }));
});

test('copyStarter writes a ready-to-check project config', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'swarm-starter-'));
  const destination = join(temporary, 'my-game');
  try {
    await copyStarter(join(process.cwd(), 'template', 'browser-game'), destination, {
      slug: 'my-game',
      title: 'My Game',
    });
    const config = JSON.parse(await readFile(join(destination, 'game.config.json'), 'utf8'));
    const html = await readFile(join(destination, 'index.html'), 'utf8');
    assert.equal(config.slug, 'my-game');
    assert.equal(config.title, 'My Game');
    assert.match(html, /<title>My Game<\/title>/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
