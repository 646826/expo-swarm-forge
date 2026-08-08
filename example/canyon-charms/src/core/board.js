import { randomInt, shuffled } from './random.js';

export const DEFAULT_ROWS = 8;
export const DEFAULT_COLS = 8;
export const DEFAULT_KINDS = Object.freeze([
  'turquoise',
  'amber',
  'garnet',
  'silver',
  'blossom',
  'horseshoe',
]);

export function cellIndex(row, column, columns = DEFAULT_COLS) {
  return row * columns + column;
}

export function cellCoordinates(index, columns = DEFAULT_COLS) {
  return { row: Math.floor(index / columns), column: index % columns };
}

export function inBounds(index, rows = DEFAULT_ROWS, columns = DEFAULT_COLS) {
  return Number.isInteger(index) && index >= 0 && index < rows * columns;
}

export function areAdjacent(first, second, columns = DEFAULT_COLS) {
  const a = cellCoordinates(first, columns);
  const b = cellCoordinates(second, columns);
  return Math.abs(a.row - b.row) + Math.abs(a.column - b.column) === 1;
}

export function createTile(id, kind, special = null) {
  return Object.freeze({ id, kind, special });
}

export function cloneBoard(board) {
  return board.map((tile) => (tile ? createTile(tile.id, tile.kind, tile.special) : null));
}

export function boardKinds(board) {
  return board.map((tile) => tile?.kind ?? null);
}

export function swapTiles(board, first, second) {
  const result = [...board];
  [result[first], result[second]] = [result[second], result[first]];
  return result;
}

function scanLine(board, indices, axis) {
  const runs = [];
  let start = 0;
  while (start < indices.length) {
    const first = board[indices[start]];
    let end = start + 1;
    while (
      first &&
      end < indices.length &&
      board[indices[end]] &&
      board[indices[end]].kind === first.kind
    ) {
      end += 1;
    }
    if (first && end - start >= 3) {
      runs.push(Object.freeze({
        axis,
        kind: first.kind,
        cells: Object.freeze(indices.slice(start, end)),
      }));
    }
    start = end;
  }
  return runs;
}

export function findRuns(board, rows = DEFAULT_ROWS, columns = DEFAULT_COLS) {
  if (!Array.isArray(board) || board.length !== rows * columns) {
    throw new RangeError('Board shape does not match rows and columns');
  }
  const runs = [];
  for (let row = 0; row < rows; row += 1) {
    const indices = Array.from({ length: columns }, (_, column) => cellIndex(row, column, columns));
    runs.push(...scanLine(board, indices, 'row'));
  }
  for (let column = 0; column < columns; column += 1) {
    const indices = Array.from({ length: rows }, (_, row) => cellIndex(row, column, columns));
    runs.push(...scanLine(board, indices, 'column'));
  }
  return runs;
}

export function matchedCells(runs) {
  const result = new Set();
  for (const run of runs) {
    for (const index of run.cells) result.add(index);
  }
  return result;
}

export function runsTouching(runs, indices) {
  const wanted = new Set(indices);
  return runs.filter((run) => run.cells.some((cell) => wanted.has(cell)));
}

export function mergeIntersectingRuns(runs) {
  const remaining = runs.map((run) => ({ ...run, cells: [...run.cells] }));
  const groups = [];
  while (remaining.length > 0) {
    const seed = remaining.shift();
    const cells = new Set(seed.cells);
    const axes = new Set([seed.axis]);
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        if (candidate.cells.some((cell) => cells.has(cell))) {
          for (const cell of candidate.cells) cells.add(cell);
          axes.add(candidate.axis);
          remaining.splice(index, 1);
          changed = true;
        }
      }
    }
    groups.push(Object.freeze({
      kind: seed.kind,
      cells: Object.freeze([...cells].sort((a, b) => a - b)),
      axes: Object.freeze([...axes].sort()),
    }));
  }
  return groups;
}

export function hasLegalMove(board, rows = DEFAULT_ROWS, columns = DEFAULT_COLS) {
  for (let index = 0; index < board.length; index += 1) {
    const { row, column } = cellCoordinates(index, columns);
    const candidates = [];
    if (column + 1 < columns) candidates.push(index + 1);
    if (row + 1 < rows) candidates.push(index + columns);
    for (const other of candidates) {
      const swapped = swapTiles(board, index, other);
      const touching = runsTouching(findRuns(swapped, rows, columns), [index, other]);
      if (touching.length > 0) return true;
    }
  }
  return false;
}

function chooseKind(board, row, column, rows, columns, kinds, rng) {
  const forbidden = new Set();
  if (column >= 2) {
    const leftA = board[cellIndex(row, column - 1, columns)];
    const leftB = board[cellIndex(row, column - 2, columns)];
    if (leftA && leftB && leftA.kind === leftB.kind) forbidden.add(leftA.kind);
  }
  if (row >= 2) {
    const aboveA = board[cellIndex(row - 1, column, columns)];
    const aboveB = board[cellIndex(row - 2, column, columns)];
    if (aboveA && aboveB && aboveA.kind === aboveB.kind) forbidden.add(aboveA.kind);
  }
  const choices = kinds.filter((kind) => !forbidden.has(kind));
  return choices[randomInt(rng, choices.length)];
}

export function createBoard({
  rows = DEFAULT_ROWS,
  columns = DEFAULT_COLS,
  kinds = DEFAULT_KINDS,
  rng,
  firstId = 1,
  maxAttempts = 300,
} = {}) {
  if (typeof rng !== 'function') throw new TypeError('createBoard requires an rng function');
  if (!Number.isInteger(rows) || rows < 3 || !Number.isInteger(columns) || columns < 3) {
    throw new RangeError('Board dimensions must both be at least 3');
  }
  if (!Array.isArray(kinds) || kinds.length < 4) {
    throw new RangeError('At least four tile kinds are required');
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const board = [];
    let nextId = firstId;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const kind = chooseKind(board, row, column, rows, columns, kinds, rng);
        board.push(createTile(nextId, kind));
        nextId += 1;
      }
    }
    if (findRuns(board, rows, columns).length === 0 && hasLegalMove(board, rows, columns)) {
      return Object.freeze({ board: Object.freeze(board), nextId });
    }
  }
  throw new Error('Unable to generate a playable board');
}

export function collapseAndRefill(
  board,
  {
    rows = DEFAULT_ROWS,
    columns = DEFAULT_COLS,
    kinds = DEFAULT_KINDS,
    rng,
    firstId,
  },
) {
  if (typeof rng !== 'function') throw new TypeError('collapseAndRefill requires an rng function');
  const result = Array(rows * columns).fill(null);
  const drops = [];
  const spawns = [];
  let nextId = firstId;
  for (let column = 0; column < columns; column += 1) {
    const survivors = [];
    for (let row = rows - 1; row >= 0; row -= 1) {
      const from = cellIndex(row, column, columns);
      if (board[from]) survivors.push({ tile: board[from], from });
    }
    let targetRow = rows - 1;
    for (const survivor of survivors) {
      const to = cellIndex(targetRow, column, columns);
      result[to] = survivor.tile;
      if (survivor.from !== to) drops.push(Object.freeze({ id: survivor.tile.id, from: survivor.from, to }));
      targetRow -= 1;
    }
    while (targetRow >= 0) {
      const to = cellIndex(targetRow, column, columns);
      const kind = kinds[randomInt(rng, kinds.length)];
      const tile = createTile(nextId, kind);
      result[to] = tile;
      spawns.push(Object.freeze({ id: tile.id, to, offsetRows: targetRow + 1 }));
      nextId += 1;
      targetRow -= 1;
    }
  }
  return Object.freeze({
    board: Object.freeze(result),
    nextId,
    drops: Object.freeze(drops),
    spawns: Object.freeze(spawns),
  });
}

export function shuffledPlayableBoard(board, rng, rows = DEFAULT_ROWS, columns = DEFAULT_COLS) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = shuffled(board, rng);
    if (findRuns(candidate, rows, columns).length === 0 && hasLegalMove(candidate, rows, columns)) {
      return Object.freeze(candidate);
    }
  }
  throw new Error('Unable to shuffle board into a playable state');
}

export function boardFromKinds(kinds, columns = DEFAULT_COLS) {
  return Object.freeze(kinds.map((kind, index) => createTile(index + 1, kind)));
}
