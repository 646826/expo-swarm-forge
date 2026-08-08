import {
  DEFAULT_COLS,
  DEFAULT_KINDS,
  DEFAULT_ROWS,
  areAdjacent,
  cellCoordinates,
  cellIndex,
  cloneBoard,
  collapseAndRefill,
  createBoard,
  createTile,
  findRuns,
  hasLegalMove,
  inBounds,
  matchedCells,
  mergeIntersectingRuns,
  runsTouching,
  shuffledPlayableBoard,
  swapTiles,
} from './board.js';
import { createRng, normalizeSeed } from './random.js';

export const DEFAULT_MOVES = 20;
export const DEFAULT_TARGET = 5000;

function freezeState(state) {
  return Object.freeze({
    ...state,
    board: Object.freeze([...state.board]),
    lastTurn: state.lastTurn ? Object.freeze(state.lastTurn) : null,
  });
}

export function createGame(seed = Date.now(), options = {}) {
  const rows = options.rows ?? DEFAULT_ROWS;
  const columns = options.columns ?? DEFAULT_COLS;
  const kinds = Object.freeze([...(options.kinds ?? DEFAULT_KINDS)]);
  const normalizedSeed = normalizeSeed(seed);
  const generated = createBoard({ rows, columns, kinds, rng: createRng(normalizedSeed) });
  return freezeState({
    seed: normalizedSeed,
    rows,
    columns,
    kinds,
    board: generated.board,
    nextId: generated.nextId,
    score: 0,
    moves: options.moves ?? DEFAULT_MOVES,
    target: options.target ?? DEFAULT_TARGET,
    status: 'playing',
    turn: 0,
    combo: 0,
    lastTurn: null,
  });
}

export function createGameFromBoard(board, options = {}) {
  const rows = options.rows ?? DEFAULT_ROWS;
  const columns = options.columns ?? DEFAULT_COLS;
  if (!Array.isArray(board) || board.length !== rows * columns) {
    throw new RangeError('Fixture board has the wrong shape');
  }
  const highestId = board.reduce((maximum, tile) => Math.max(maximum, tile?.id ?? 0), 0);
  return freezeState({
    seed: normalizeSeed(options.seed ?? 1),
    rows,
    columns,
    kinds: Object.freeze([...(options.kinds ?? DEFAULT_KINDS)]),
    board: cloneBoard(board),
    nextId: highestId + 1,
    score: options.score ?? 0,
    moves: options.moves ?? DEFAULT_MOVES,
    target: options.target ?? DEFAULT_TARGET,
    status: options.status ?? 'playing',
    turn: options.turn ?? 0,
    combo: 0,
    lastTurn: null,
  });
}

function preferredPlacement(cells, preferred) {
  for (const index of preferred) if (cells.includes(index)) return index;
  return cells[Math.floor(cells.length / 2)];
}

function specialCreations(runs, preferred) {
  const creations = [];
  for (const group of mergeIntersectingRuns(runs)) {
    let special = null;
    if (group.axes.length > 1 || group.cells.length >= 5) {
      special = 'dynamite';
    } else {
      const longest = runs
        .filter((run) => run.cells.some((cell) => group.cells.includes(cell)))
        .sort((a, b) => b.cells.length - a.cells.length)[0];
      if (longest?.cells.length >= 4) special = longest.axis === 'row' ? 'row' : 'column';
    }
    if (special) {
      creations.push(Object.freeze({
        index: preferredPlacement(group.cells, preferred),
        special,
        kind: group.kind,
      }));
    }
  }
  return creations;
}

function expandSpecials(board, startingCells, rows, columns) {
  const clear = new Set(startingCells);
  const queue = [...clear];
  const activated = [];
  const visited = new Set();
  while (queue.length > 0) {
    const index = queue.shift();
    if (visited.has(index)) continue;
    visited.add(index);
    const tile = board[index];
    if (!tile?.special) continue;
    activated.push(Object.freeze({ index, special: tile.special }));
    const { row, column } = cellCoordinates(index, columns);
    const additions = [];
    if (tile.special === 'row') {
      for (let x = 0; x < columns; x += 1) additions.push(cellIndex(row, x, columns));
    } else if (tile.special === 'column') {
      for (let y = 0; y < rows; y += 1) additions.push(cellIndex(y, column, columns));
    } else if (tile.special === 'dynamite') {
      for (let y = row - 1; y <= row + 1; y += 1) {
        for (let x = column - 1; x <= column + 1; x += 1) {
          const candidate = cellIndex(y, x, columns);
          if (y >= 0 && y < rows && x >= 0 && x < columns) additions.push(candidate);
        }
      }
    }
    for (const addition of additions) {
      if (!clear.has(addition)) {
        clear.add(addition);
        queue.push(addition);
      }
    }
  }
  return Object.freeze({ clear, activated: Object.freeze(activated) });
}

export function resolveCascades(
  board,
  {
    rows = DEFAULT_ROWS,
    columns = DEFAULT_COLS,
    kinds = DEFAULT_KINDS,
    seed = 1,
    turn = 0,
    nextId = board.length + 1,
    preferred = [],
  } = {},
) {
  const rng = createRng((normalizeSeed(seed) ^ Math.imul(turn + 1, 0x9e3779b1)) >>> 0);
  let current = Object.freeze(cloneBoard(board));
  let id = nextId;
  let depth = 1;
  let scoreDelta = 0;
  const phases = [];
  const cascades = [];

  while (depth <= 50) {
    const runs = findRuns(current, rows, columns);
    if (runs.length === 0) break;
    const creations = specialCreations(runs, depth === 1 ? preferred : []);
    const clearBase = matchedCells(runs);
    for (const creation of creations) clearBase.delete(creation.index);
    const expanded = expandSpecials(current, clearBase, rows, columns);
    const cleared = [...expanded.clear].sort((a, b) => a - b);
    const normalPoints = cleared.length * 80;
    const specialPoints = expanded.activated.length * 240;
    const awarded = (normalPoints + specialPoints) * depth;
    scoreDelta += awarded;

    const clearedBoard = [...current];
    for (const index of cleared) clearedBoard[index] = null;
    for (const creation of creations) {
      const source = current[creation.index];
      if (source) clearedBoard[creation.index] = createTile(source.id, source.kind, creation.special);
    }

    phases.push(Object.freeze({
      type: 'clear',
      depth,
      cells: Object.freeze(cleared),
      activated: expanded.activated,
      creations: Object.freeze(creations),
      score: awarded,
    }));

    const collapsed = collapseAndRefill(clearedBoard, {
      rows,
      columns,
      kinds,
      rng,
      firstId: id,
    });
    id = collapsed.nextId;
    phases.push(Object.freeze({ type: 'drop', depth, moves: collapsed.drops }));
    phases.push(Object.freeze({ type: 'refill', depth, spawns: collapsed.spawns }));
    cascades.push(Object.freeze({
      depth,
      cleared: Object.freeze(cleared),
      creations: Object.freeze(creations),
      activated: expanded.activated,
      score: awarded,
    }));
    current = collapsed.board;
    depth += 1;
  }

  if (depth > 50) throw new Error('Cascade safety limit exceeded');
  return Object.freeze({
    board: current,
    nextId: id,
    scoreDelta,
    combo: Math.max(0, depth - 1),
    phases: Object.freeze(phases),
    cascades: Object.freeze(cascades),
  });
}

function rejected(state, reason, phases = []) {
  return Object.freeze({
    accepted: false,
    reason,
    state,
    phases: Object.freeze(phases),
  });
}

export function attemptSwap(state, first, second) {
  if (state.status !== 'playing') return rejected(state, 'not-playing');
  if (!inBounds(first, state.rows, state.columns) || !inBounds(second, state.rows, state.columns)) {
    return rejected(state, 'out-of-bounds');
  }
  if (!areAdjacent(first, second, state.columns)) return rejected(state, 'not-adjacent');

  const swapPhase = Object.freeze({ type: 'swap', first, second });
  const swapped = swapTiles(state.board, first, second);
  const touching = runsTouching(findRuns(swapped, state.rows, state.columns), [first, second]);
  if (touching.length === 0) {
    return rejected(state, 'no-match', [swapPhase, Object.freeze({ type: 'swap-back', first, second })]);
  }

  const resolved = resolveCascades(swapped, {
    rows: state.rows,
    columns: state.columns,
    kinds: state.kinds,
    seed: state.seed,
    turn: state.turn,
    nextId: state.nextId,
    preferred: [second, first],
  });
  const moves = state.moves - 1;
  const score = state.score + resolved.scoreDelta;
  const postTurnRng = createRng((state.seed ^ Math.imul(state.turn + 17, 0x85ebca6b)) >>> 0);
  let board = resolved.board;
  let reshuffled = false;
  if (!hasLegalMove(board, state.rows, state.columns)) {
    board = shuffledPlayableBoard(board, postTurnRng, state.rows, state.columns);
    reshuffled = true;
  }
  const status = score >= state.target ? 'won' : moves <= 0 ? 'lost' : 'playing';
  const phases = [
    swapPhase,
    ...resolved.phases,
    ...(reshuffled ? [Object.freeze({ type: 'shuffle' })] : []),
    Object.freeze({ type: 'settle', status }),
  ];
  const nextState = freezeState({
    ...state,
    board,
    nextId: resolved.nextId,
    score,
    moves,
    status,
    turn: state.turn + 1,
    combo: resolved.combo,
    lastTurn: {
      first,
      second,
      scoreDelta: resolved.scoreDelta,
      combo: resolved.combo,
      cascades: resolved.cascades.length,
      reshuffled,
    },
  });
  return Object.freeze({
    accepted: true,
    reason: null,
    state: nextState,
    phases: Object.freeze(phases),
  });
}

export function findHint(state) {
  for (let index = 0; index < state.board.length; index += 1) {
    const { row, column } = cellCoordinates(index, state.columns);
    const candidates = [];
    if (column + 1 < state.columns) candidates.push(index + 1);
    if (row + 1 < state.rows) candidates.push(index + state.columns);
    for (const other of candidates) {
      const swapped = swapTiles(state.board, index, other);
      if (runsTouching(findRuns(swapped, state.rows, state.columns), [index, other]).length > 0) {
        return Object.freeze([index, other]);
      }
    }
  }
  return null;
}
