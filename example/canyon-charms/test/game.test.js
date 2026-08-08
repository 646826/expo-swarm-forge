import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COLS,
  DEFAULT_KINDS,
  DEFAULT_ROWS,
  areAdjacent,
  boardFromKinds,
  boardKinds,
  createBoard,
  createTile,
  findRuns,
  hasLegalMove,
  mergeIntersectingRuns,
} from '../src/core/board.js';
import {
  attemptSwap,
  createGame,
  createGameFromBoard,
  findHint,
  resolveCascades,
} from '../src/core/game-state.js';
import { createRng, normalizeSeed, shuffled } from '../src/core/random.js';
import {
  DEFAULT_SETTINGS,
  createPublisherPlatform,
  createStorage,
  normalizeSettings,
} from '../src/platform/platform.js';

function findInvalidAdjacentPair(state) {
  for (let index = 0; index < state.board.length; index += 1) {
    const row = Math.floor(index / state.columns);
    const column = index % state.columns;
    const candidates = [];
    if (column + 1 < state.columns) candidates.push(index + 1);
    if (row + 1 < state.rows) candidates.push(index + state.columns);
    for (const other of candidates) {
      if (!attemptSwap(state, index, other).accepted) return [index, other];
    }
  }
  throw new Error('Expected at least one invalid adjacent pair');
}

test('normalizeSeed converts finite numbers to unsigned integers', () => {
  assert.equal(normalizeSeed(-1), 0xffff_ffff);
  assert.equal(normalizeSeed(3.9), 3);
});

test('normalizeSeed uses a stable fallback for invalid values', () => {
  assert.equal(normalizeSeed(Number.NaN), normalizeSeed('not-a-number'));
});

test('seeded random streams are reproducible', () => {
  const first = createRng(12345);
  const second = createRng(12345);
  assert.deepEqual(
    Array.from({ length: 12 }, first),
    Array.from({ length: 12 }, second),
  );
});

test('seeded random values remain inside the unit interval', () => {
  const rng = createRng(9);
  for (let index = 0; index < 500; index += 1) {
    const value = rng();
    assert.ok(value >= 0 && value < 1);
  }
});

test('shuffled is deterministic and does not mutate its input', () => {
  const input = [1, 2, 3, 4, 5, 6];
  const first = shuffled(input, createRng(44));
  const second = shuffled(input, createRng(44));
  assert.deepEqual(first, second);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
});

test('orthogonal neighbors are adjacent', () => {
  assert.equal(areAdjacent(0, 1, 8), true);
  assert.equal(areAdjacent(0, 8, 8), true);
});

test('diagonal and wrapped cells are not adjacent', () => {
  assert.equal(areAdjacent(0, 9, 8), false);
  assert.equal(areAdjacent(7, 8, 8), false);
});

test('generated board has the requested dimensions', () => {
  const generated = createBoard({ rng: createRng(101) });
  assert.equal(generated.board.length, DEFAULT_ROWS * DEFAULT_COLS);
});

test('generated board starts without automatic matches', () => {
  const generated = createBoard({ rng: createRng(202) });
  assert.deepEqual(findRuns(generated.board), []);
});

test('generated board always exposes a legal move', () => {
  const generated = createBoard({ rng: createRng(303) });
  assert.equal(hasLegalMove(generated.board), true);
});

test('generated tile identifiers are unique', () => {
  const generated = createBoard({ rng: createRng(404) });
  const identifiers = generated.board.map((tile) => tile.id);
  assert.equal(new Set(identifiers).size, identifiers.length);
});

test('horizontal runs are detected', () => {
  const board = boardFromKinds([
    'amber', 'amber', 'amber', 'silver',
    'silver', 'garnet', 'blossom', 'amber',
    'garnet', 'blossom', 'silver', 'turquoise',
  ], 4);
  const runs = findRuns(board, 3, 4);
  assert.deepEqual(runs.map((run) => [run.axis, [...run.cells]]), [['row', [0, 1, 2]]]);
});

test('vertical runs are detected', () => {
  const board = boardFromKinds([
    'amber', 'silver', 'garnet',
    'amber', 'garnet', 'silver',
    'amber', 'blossom', 'turquoise',
    'silver', 'turquoise', 'blossom',
  ], 3);
  const runs = findRuns(board, 4, 3);
  assert.deepEqual(runs.map((run) => [run.axis, [...run.cells]]), [['column', [0, 3, 6]]]);
});

test('intersecting row and column runs merge into one group', () => {
  const board = boardFromKinds([
    'silver', 'amber', 'garnet', 'blossom', 'turquoise',
    'amber', 'garnet', 'amber', 'silver', 'blossom',
    'garnet', 'amber', 'amber', 'amber', 'silver',
    'blossom', 'silver', 'amber', 'turquoise', 'garnet',
    'turquoise', 'blossom', 'silver', 'garnet', 'amber',
  ], 5);
  const groups = mergeIntersectingRuns(findRuns(board, 5, 5));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].axes, ['column', 'row']);
  assert.equal(groups[0].cells.length, 5);
});

test('equal seeds create equal games', () => {
  const first = createGame(8080);
  const second = createGame(8080);
  assert.deepEqual(boardKinds(first.board), boardKinds(second.board));
});

test('findHint returns a legal neighboring pair', () => {
  const game = createGame(505);
  const hint = findHint(game);
  assert.ok(hint);
  assert.equal(areAdjacent(hint[0], hint[1], game.columns), true);
  assert.equal(attemptSwap(game, hint[0], hint[1]).accepted, true);
});

test('invalid swaps return the board and preserve the move counter', () => {
  const game = createGame(606);
  const pair = findInvalidAdjacentPair(game);
  const result = attemptSwap(game, pair[0], pair[1]);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'no-match');
  assert.equal(result.state.moves, game.moves);
  assert.deepEqual(boardKinds(result.state.board), boardKinds(game.board));
  assert.deepEqual(result.phases.map((phase) => phase.type), ['swap', 'swap-back']);
});

test('valid swaps spend exactly one move', () => {
  const game = createGame(707);
  const hint = findHint(game);
  const result = attemptSwap(game, hint[0], hint[1]);
  assert.equal(result.accepted, true);
  assert.equal(result.state.moves, game.moves - 1);
});

test('valid swaps produce points and a stable board', () => {
  const game = createGame(808);
  const hint = findHint(game);
  const result = attemptSwap(game, hint[0], hint[1]);
  assert.ok(result.state.score > 0);
  assert.equal(findRuns(result.state.board).length, 0);
  assert.equal(hasLegalMove(result.state.board), true);
});

test('turn resolution remains deterministic', () => {
  const first = createGame(909);
  const second = createGame(909);
  const hint = findHint(first);
  const a = attemptSwap(first, hint[0], hint[1]);
  const b = attemptSwap(second, hint[0], hint[1]);
  assert.equal(a.state.score, b.state.score);
  assert.deepEqual(boardKinds(a.state.board), boardKinds(b.state.board));
});

test('four in a row creates a directional firecracker', () => {
  const board = boardFromKinds([
    'amber', 'amber', 'amber', 'amber',
    'silver', 'garnet', 'blossom', 'turquoise',
    'garnet', 'blossom', 'turquoise', 'silver',
  ], 4);
  const result = resolveCascades(board, {
    rows: 3,
    columns: 4,
    kinds: DEFAULT_KINDS,
    seed: 12,
    nextId: 13,
    preferred: [1],
  });
  assert.equal(result.cascades[0].creations[0].special, 'row');
  assert.equal(result.cascades[0].creations[0].index, 1);
});

test('five in a row creates dynamite', () => {
  const board = boardFromKinds([
    'garnet', 'garnet', 'garnet', 'garnet', 'garnet',
    'silver', 'amber', 'blossom', 'turquoise', 'horseshoe',
    'amber', 'blossom', 'turquoise', 'horseshoe', 'silver',
  ], 5);
  const result = resolveCascades(board, {
    rows: 3,
    columns: 5,
    kinds: DEFAULT_KINDS,
    seed: 13,
    nextId: 16,
    preferred: [2],
  });
  assert.equal(result.cascades[0].creations[0].special, 'dynamite');
});

test('T-shaped matches create dynamite', () => {
  const board = boardFromKinds([
    'silver', 'amber', 'garnet', 'blossom', 'turquoise',
    'amber', 'garnet', 'amber', 'silver', 'blossom',
    'garnet', 'amber', 'amber', 'amber', 'silver',
    'blossom', 'silver', 'amber', 'turquoise', 'garnet',
    'turquoise', 'blossom', 'silver', 'garnet', 'amber',
  ], 5);
  const result = resolveCascades(board, {
    rows: 5,
    columns: 5,
    kinds: DEFAULT_KINDS,
    seed: 14,
    nextId: 26,
    preferred: [12],
  });
  assert.equal(result.cascades[0].creations[0].special, 'dynamite');
});

test('activated row specials expand the clear set', () => {
  const board = [
    createTile(1, 'amber', 'row'), createTile(2, 'silver'), createTile(3, 'garnet'), createTile(4, 'blossom'),
    createTile(5, 'amber'), createTile(6, 'turquoise'), createTile(7, 'silver'), createTile(8, 'garnet'),
    createTile(9, 'amber'), createTile(10, 'blossom'), createTile(11, 'turquoise'), createTile(12, 'silver'),
  ];
  const result = resolveCascades(board, {
    rows: 3,
    columns: 4,
    kinds: DEFAULT_KINDS,
    seed: 15,
    nextId: 13,
  });
  assert.ok(result.cascades[0].cleared.includes(3));
  assert.equal(result.cascades[0].activated[0].special, 'row');
});

test('reaching a tiny target wins immediately after a valid move', () => {
  const game = createGame(1001, { target: 1 });
  const hint = findHint(game);
  const result = attemptSwap(game, hint[0], hint[1]);
  assert.equal(result.state.status, 'won');
});

test('spending the final move below target loses', () => {
  const game = createGame(1002, { moves: 1, target: 999999 });
  const hint = findHint(game);
  const result = attemptSwap(game, hint[0], hint[1]);
  assert.equal(result.state.status, 'lost');
});

test('finished games reject further swaps', () => {
  const game = createGame(1003);
  const finished = createGameFromBoard(game.board, { status: 'won', seed: game.seed });
  const hint = findHint(finished);
  const result = attemptSwap(finished, hint[0], hint[1]);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'not-playing');
});

test('settings normalization is fail-safe', () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings({ sound: false, reducedMotion: true, bestScore: -5 }), {
    sound: false,
    reducedMotion: true,
    bestScore: 0,
  });
});

test('storage tolerates malformed persisted data', () => {
  const fake = {
    getItem: () => '{broken',
    setItem: () => { throw new Error('blocked'); },
  };
  const storage = createStorage(fake);
  assert.deepEqual(storage.load(), { ...DEFAULT_SETTINGS });
  assert.doesNotThrow(() => storage.save({ sound: false }));
});

test('publisher bridge queues calls until a host appears', async () => {
  const calls = [];
  const host = {};
  const platform = createPublisherPlatform(host);
  platform.loaded();
  platform.submitScore(321);
  assert.equal(platform.diagnostics().queued, 2);
  host.publisherPlatform = {
    gameLoaded: () => calls.push('loaded'),
    submitScore: (score) => calls.push(`score:${score}`),
  };
  assert.equal(await platform.connect(), true);
  assert.deepEqual(calls, ['loaded', 'score:321']);
});
