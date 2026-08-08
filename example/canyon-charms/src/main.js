import { cellCoordinates, cellIndex } from './core/board.js';
import { attemptSwap, createGame, findHint } from './core/game-state.js';
import { createPublisherPlatform, createStorage } from './platform/platform.js';

const canvas = document.querySelector('#game-canvas');
const context = canvas.getContext('2d', { alpha: false });
const app = document.querySelector('#app');
const announcer = document.querySelector('[data-role="announcer"]');
const canvasDescription = document.querySelector('#canvas-description');
const helpDialog = document.querySelector('#help-dialog');
const scoreNode = document.querySelector('[data-role="score"]');
const targetNode = document.querySelector('[data-role="target"]');
const movesNode = document.querySelector('[data-role="moves"]');
const comboNode = document.querySelector('[data-role="combo"]');
const finalScoreNode = document.querySelector('[data-role="final-score"]');
const resultTitleNode = document.querySelector('[data-role="result-title"]');
const resultKickerNode = document.querySelector('[data-role="result-kicker"]');
const resultCopyNode = document.querySelector('[data-role="result-copy"]');
const pauseButton = document.querySelector('[data-action="pause"]');
const soundButtons = [...document.querySelectorAll('[data-action="sound"]')];
const motionButtons = [...document.querySelectorAll('[data-action="motion"]')];

if (!canvas || !context) throw new Error('Canvas 2D is required to play Canyon Charms.');

const storage = createStorage();
const platform = createPublisherPlatform();
let settings = storage.load();
let game = createGame(seedFromLocation());
let mode = 'title';
let selected = null;
let focused = 0;
let pointerStart = null;
let hoverIndex = null;
let lastInteractionAt = performance.now();
let hint = null;
let shakeUntil = 0;
let shakeStrength = 0;
let audioContext = null;
let visualCounter = 1;
let layout = null;
let lastFrame = performance.now();
let resumeAfterHelp = false;
const flashes = new Map();
const particles = [];
const flyups = [];
const MAX_PARTICLES = 180;

const TILE_STYLE = Object.freeze({
  turquoise: { base: '#1a8c8a', light: '#86fff0', dark: '#075052', glow: '#52ead8' },
  amber: { base: '#d8872f', light: '#ffe09a', dark: '#7c381a', glow: '#ffbd55' },
  garnet: { base: '#a93648', light: '#ff9ba5', dark: '#561827', glow: '#ff596f' },
  silver: { base: '#71869d', light: '#f2fbff', dark: '#344255', glow: '#c4e8ff' },
  blossom: { base: '#b64f7f', light: '#ffc5e5', dark: '#612344', glow: '#ff82bd' },
  horseshoe: { base: '#7657ad', light: '#d9caff', dark: '#3e286a', glow: '#ae91ff' },
});

function seedFromLocation() {
  const requested = Number(new URLSearchParams(location.search).get('seed'));
  if (Number.isFinite(requested) && requested !== 0) return requested;
  const day = Math.floor(Date.now() / 86_400_000);
  return (day ^ 0xc4a5_0c17) >>> 0;
}

function format(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function announce(message) {
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

function persist() {
  settings = storage.save(settings);
  app.dataset.reducedMotion = String(settings.reducedMotion);
  for (const button of soundButtons) {
    button.setAttribute('aria-pressed', String(settings.sound));
    button.textContent = settings.sound ? 'Sound on' : 'Sound off';
  }
  for (const button of motionButtons) {
    button.setAttribute('aria-pressed', String(settings.reducedMotion));
    button.textContent = settings.reducedMotion ? 'Motion reduced' : 'Motion on';
  }
}

function updateHud() {
  scoreNode.textContent = format(game.score);
  targetNode.textContent = format(game.target);
  movesNode.textContent = String(game.moves);
  comboNode.textContent = game.combo > 1 ? `×${game.combo}` : '—';
  const focus = cellCoordinates(focused, game.columns);
  const selectedCopy = selected === null
    ? 'No charm is selected.'
    : `Selected row ${cellCoordinates(selected, game.columns).row + 1}, column ${cellCoordinates(selected, game.columns).column + 1}.`;
  canvasDescription.textContent = [
    `Canyon Charms board. Score ${format(game.score)} of ${format(game.target)}.`,
    `${game.moves} moves remain.`,
    `Keyboard focus is row ${focus.row + 1}, column ${focus.column + 1}.`,
    selectedCopy,
    game.status === 'playing' ? 'The game is active.' : `The game is ${game.status}.`,
  ].join(' ');
}

function setMode(nextMode) {
  mode = nextMode;
  for (const overlay of document.querySelectorAll('[data-screen]')) {
    overlay.hidden = overlay.dataset.screen !== nextMode;
  }
  pauseButton.disabled = nextMode === 'title' || nextMode === 'result';
  pauseButton.textContent = nextMode === 'paused' ? 'Resume' : 'Pause';
  updateHud();
}

function startGame() {
  const nextSeed = (game.seed + game.turn + 0x9e37_79b9) >>> 0;
  game = createGame(nextSeed);
  selected = null;
  focused = 0;
  hint = null;
  flashes.clear();
  particles.length = 0;
  flyups.length = 0;
  setMode('playing');
  unlockAudio();
  tone(392, 0.08, 'triangle', 0.035);
  setTimeout(() => tone(523.25, 0.12, 'triangle', 0.04), 80);
  platform.started();
  platform.track('level_start', { seed: game.seed });
  announce('New game started. Reach five thousand points in twenty moves.');
  canvas.focus({ preventScroll: true });
}

function pauseGame() {
  if (mode !== 'playing') return;
  setMode('paused');
  suspendAudio();
  platform.paused();
  announce('Game paused.');
}

function resumeGame() {
  if (mode !== 'paused') return;
  setMode('playing');
  unlockAudio();
  platform.resumed();
  announce('Game resumed.');
  canvas.focus({ preventScroll: true });
}

function showResult() {
  if (game.status === 'playing') return;
  const won = game.status === 'won';
  settings = storage.save({
    ...settings,
    bestScore: Math.max(settings.bestScore, game.score),
  });
  resultKickerNode.textContent = won ? 'Display restored' : 'Sunset reached';
  resultTitleNode.textContent = won ? 'A brilliant finish' : 'One more trail';
  resultCopyNode.textContent = won
    ? `You reached the target with ${game.moves} moves left. Best score: ${format(settings.bestScore)}.`
    : `You finished below the target. Best score: ${format(settings.bestScore)}.`;
  finalScoreNode.textContent = format(game.score);
  setMode('result');
  if (won) emitVictory();
  platform.submitScore(game.score);
  platform.completed({ status: game.status, score: game.score, moves: game.moves });
  platform.track('level_complete', { status: game.status, score: game.score, moves: game.moves });
  announce(won ? `You won with ${format(game.score)} points.` : `The level ended with ${format(game.score)} points.`);
}

function toggleSound() {
  settings = { ...settings, sound: !settings.sound };
  persist();
  if (settings.sound) {
    unlockAudio();
    tone(523.25, 0.08, 'sine', 0.035);
  } else {
    suspendAudio();
  }
  announce(settings.sound ? 'Sound on.' : 'Sound off.');
}

function toggleMotion() {
  settings = { ...settings, reducedMotion: !settings.reducedMotion };
  persist();
  announce(settings.reducedMotion ? 'Reduced motion on.' : 'Full motion on.');
}

function showHelp() {
  resumeAfterHelp = mode === 'playing';
  if (resumeAfterHelp) pauseGame();
  helpDialog.showModal();
}

helpDialog.addEventListener('close', () => {
  if (resumeAfterHelp) resumeGame();
  resumeAfterHelp = false;
});

function unlockAudio() {
  if (!settings.sound) return;
  if (!audioContext) {
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
  }
  if (audioContext?.state === 'suspended') void audioContext.resume();
}

function suspendAudio() {
  if (audioContext?.state === 'running') void audioContext.suspend();
}

function tone(frequency, duration, type = 'sine', gainValue = 0.03, delay = 0) {
  if (!settings.sound || !audioContext) return;
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function performSwap(first, second) {
  if (mode !== 'playing') return;
  unlockAudio();
  const before = game;
  const result = attemptSwap(game, first, second);
  selected = null;
  hint = null;
  lastInteractionAt = performance.now();
  if (!result.accepted) {
    shakeUntil = performance.now() + (settings.reducedMotion ? 50 : 220);
    shakeStrength = settings.reducedMotion ? 1 : 7;
    tone(126, 0.11, 'square', 0.018);
    announce('That swap does not create a match. The move was returned.');
    updateHud();
    return;
  }

  game = result.state;
  const clearPhases = result.phases.filter((phase) => phase.type === 'clear');
  for (const phase of clearPhases) {
    for (const index of phase.cells) {
      flashes.set(index, performance.now() + (settings.reducedMotion ? 90 : 440));
      emitBurst(index, before.board[index]?.kind ?? game.board[index]?.kind ?? 'amber', phase.depth);
    }
    if (phase.score > 0) {
      const anchor = phase.cells[Math.floor(phase.cells.length / 2)] ?? first;
      emitFlyup(anchor, `+${format(phase.score)}`, phase.depth);
    }
  }
  const delta = game.score - before.score;
  const combo = game.lastTurn?.combo ?? 1;
  tone(280 + Math.min(combo, 5) * 54, 0.08, 'triangle', 0.025);
  if (combo > 1) tone(520 + combo * 36, 0.12, 'sine', 0.026, 0.06);
  platform.track('move_complete', {
    turn: game.turn,
    scoreDelta: delta,
    combo,
    moves: game.moves,
  });
  announce(
    combo > 1
      ? `Match accepted. ${format(delta)} points. Combo times ${combo}. ${game.moves} moves remain.`
      : `Match accepted. ${format(delta)} points. ${game.moves} moves remain.`,
  );
  updateHud();
  if (game.status !== 'playing') {
    const delay = settings.reducedMotion ? 80 : 650;
    setTimeout(() => {
      if (game.status !== 'playing') showResult();
    }, delay);
  }
}

function handleCell(index) {
  if (mode !== 'playing') return;
  focused = index;
  if (selected === null) {
    selected = index;
    tone(330, 0.04, 'sine', 0.018);
    announce(`Charm selected at row ${cellCoordinates(index, game.columns).row + 1}, column ${cellCoordinates(index, game.columns).column + 1}.`);
  } else if (selected === index) {
    selected = null;
    announce('Selection cleared.');
  } else {
    const firstCoordinates = cellCoordinates(selected, game.columns);
    const secondCoordinates = cellCoordinates(index, game.columns);
    const adjacent = Math.abs(firstCoordinates.row - secondCoordinates.row)
      + Math.abs(firstCoordinates.column - secondCoordinates.column) === 1;
    if (adjacent) performSwap(selected, index);
    else {
      selected = index;
      announce('Selected a different charm.');
    }
  }
  lastInteractionAt = performance.now();
  hint = null;
  updateHud();
}

function cellFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (!layout || x < layout.boardX || y < layout.boardY || x >= layout.boardX + layout.boardSize || y >= layout.boardY + layout.boardSize) {
    return null;
  }
  const column = Math.floor((x - layout.boardX) / layout.cellSize);
  const row = Math.floor((y - layout.boardY) / layout.cellSize);
  if (row < 0 || row >= game.rows || column < 0 || column >= game.columns) return null;
  return cellIndex(row, column, game.columns);
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  const index = cellFromPointer(event);
  pointerStart = index === null ? null : { index, x: event.clientX, y: event.clientY };
  hoverIndex = index;
  unlockAudio();
});

canvas.addEventListener('pointermove', (event) => {
  hoverIndex = cellFromPointer(event);
});

canvas.addEventListener('pointerleave', () => {
  hoverIndex = null;
});

canvas.addEventListener('pointerup', (event) => {
  event.preventDefault();
  if (!pointerStart) return;
  const end = cellFromPointer(event);
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  const threshold = 18;
  if (Math.max(Math.abs(dx), Math.abs(dy)) >= threshold) {
    const startCoordinates = cellCoordinates(pointerStart.index, game.columns);
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const row = startCoordinates.row + (horizontal ? 0 : Math.sign(dy));
    const column = startCoordinates.column + (horizontal ? Math.sign(dx) : 0);
    if (row >= 0 && row < game.rows && column >= 0 && column < game.columns) {
      performSwap(pointerStart.index, cellIndex(row, column, game.columns));
    }
  } else if (end !== null) {
    handleCell(end);
  }
  pointerStart = null;
});

function moveFocus(deltaRow, deltaColumn) {
  const current = cellCoordinates(focused, game.columns);
  const row = Math.max(0, Math.min(game.rows - 1, current.row + deltaRow));
  const column = Math.max(0, Math.min(game.columns - 1, current.column + deltaColumn));
  focused = cellIndex(row, column, game.columns);
  lastInteractionAt = performance.now();
  hint = null;
  updateHud();
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (helpDialog.open && key !== 'escape') return;
  if (key === 'arrowup') { event.preventDefault(); moveFocus(-1, 0); }
  else if (key === 'arrowdown') { event.preventDefault(); moveFocus(1, 0); }
  else if (key === 'arrowleft') { event.preventDefault(); moveFocus(0, -1); }
  else if (key === 'arrowright') { event.preventDefault(); moveFocus(0, 1); }
  else if ((key === 'enter' || key === ' ') && mode === 'playing') { event.preventDefault(); handleCell(focused); }
  else if (key === 'escape') {
    if (mode === 'playing') pauseGame();
    else if (mode === 'paused') resumeGame();
  } else if (key === 'm') toggleSound();
  else if (key === 'r' && mode !== 'title') startGame();
  else if (key === 'h' || key === '?') showHelp();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'start' || action === 'restart') startGame();
  else if (action === 'pause') mode === 'paused' ? resumeGame() : pauseGame();
  else if (action === 'resume') resumeGame();
  else if (action === 'sound') toggleSound();
  else if (action === 'motion') toggleMotion();
  else if (action === 'help') showHelp();
  else if (action === 'title') setMode('title');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'playing') pauseGame();
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const availableWidth = width * 0.94;
  const availableHeight = height * 0.94;
  const boardSize = Math.max(220, Math.min(availableWidth, availableHeight));
  layout = Object.freeze({
    width,
    height,
    dpr,
    boardSize,
    boardX: (width - boardSize) / 2,
    boardY: (height - boardSize) / 2,
    cellSize: boardSize / game.columns,
    gap: Math.max(3, boardSize * 0.008),
  });
}

new ResizeObserver(resizeCanvas).observe(canvas);

function randomVisual() {
  visualCounter = (visualCounter + 0x6d2b79f5) >>> 0;
  let value = visualCounter;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function cellCenter(index) {
  const coordinates = cellCoordinates(index, game.columns);
  return {
    x: layout.boardX + (coordinates.column + 0.5) * layout.cellSize,
    y: layout.boardY + (coordinates.row + 0.5) * layout.cellSize,
  };
}

function emitBurst(index, kind, depth = 1) {
  if (!layout) return;
  const center = cellCenter(index);
  const count = settings.reducedMotion ? 3 : Math.min(12, 5 + depth * 2);
  for (let number = 0; number < count && particles.length < MAX_PARTICLES; number += 1) {
    const angle = randomVisual() * Math.PI * 2;
    const speed = 24 + randomVisual() * (80 + depth * 12);
    particles.push({
      x: center.x,
      y: center.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 18,
      life: 0.35 + randomVisual() * 0.45,
      age: 0,
      size: 2 + randomVisual() * 4,
      color: TILE_STYLE[kind]?.glow ?? '#ffd37f',
    });
  }
}

function emitFlyup(index, text, depth) {
  if (!layout) return;
  const center = cellCenter(index);
  flyups.push({ x: center.x, y: center.y, text, depth, age: 0, life: settings.reducedMotion ? 0.35 : 0.9 });
}

function emitVictory() {
  if (!layout) return;
  for (let burst = 0; burst < (settings.reducedMotion ? 3 : 9); burst += 1) {
    const index = Math.floor(randomVisual() * game.board.length);
    setTimeout(() => emitBurst(index, game.kinds[burst % game.kinds.length], 4), burst * 90);
  }
  tone(392, 0.12, 'triangle', 0.03);
  tone(523.25, 0.18, 'triangle', 0.03, 0.1);
  tone(659.25, 0.26, 'sine', 0.026, 0.22);
}

function updateEffects(delta) {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.age += delta;
    if (particle.age >= particle.life) {
      particles.splice(index, 1);
      continue;
    }
    particle.vy += 85 * delta;
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
  }
  for (let index = flyups.length - 1; index >= 0; index -= 1) {
    flyups[index].age += delta;
    if (flyups[index].age >= flyups[index].life) flyups.splice(index, 1);
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function drawBackground(now) {
  const { width, height } = layout;
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#342044');
  sky.addColorStop(0.42, '#82414a');
  sky.addColorStop(0.74, '#db7744');
  sky.addColorStop(1, '#3a1b20');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const sunX = width * 0.78;
  const sunY = height * 0.2;
  const sunRadius = Math.min(width, height) * 0.13;
  const glow = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius * 2.6);
  glow.addColorStop(0, 'rgba(255, 238, 172, 0.92)');
  glow.addColorStop(0.28, 'rgba(255, 181, 91, 0.38)');
  glow.addColorStop(1, 'rgba(255, 139, 71, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const motion = settings.reducedMotion ? 0 : Math.sin(now * 0.00008) * 7;
  context.fillStyle = 'rgba(45, 18, 30, 0.58)';
  context.beginPath();
  context.moveTo(0, height * 0.62);
  context.lineTo(width * 0.12, height * 0.49 + motion);
  context.lineTo(width * 0.26, height * 0.58);
  context.lineTo(width * 0.4, height * 0.44 - motion * 0.3);
  context.lineTo(width * 0.55, height * 0.58);
  context.lineTo(width * 0.72, height * 0.46 + motion * 0.25);
  context.lineTo(width, height * 0.63);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();

  context.fillStyle = 'rgba(22, 10, 17, 0.62)';
  context.beginPath();
  context.moveTo(0, height * 0.78);
  for (let step = 0; step <= 12; step += 1) {
    const x = (step / 12) * width;
    const y = height * (0.72 + (step % 3) * 0.028);
    context.lineTo(x, y);
  }
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();

  if (!settings.reducedMotion) {
    context.fillStyle = 'rgba(255, 228, 178, 0.22)';
    for (let dust = 0; dust < 18; dust += 1) {
      const x = (dust * 97 + now * (0.004 + dust * 0.00015)) % (width + 30) - 15;
      const y = ((dust * 53) % Math.max(1, height)) * 0.8 + height * 0.08;
      context.beginPath();
      context.arc(x, y, 0.7 + (dust % 3) * 0.45, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function drawBoardFrame() {
  const padding = Math.max(8, layout.cellSize * 0.12);
  const x = layout.boardX - padding;
  const y = layout.boardY - padding;
  const size = layout.boardSize + padding * 2;
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.58)';
  context.shadowBlur = 34;
  context.shadowOffsetY = 18;
  roundedRect(context, x, y, size, size, Math.max(18, layout.cellSize * 0.24));
  const wood = context.createLinearGradient(x, y, x + size, y + size);
  wood.addColorStop(0, '#6f3827');
  wood.addColorStop(0.48, '#3a1b1b');
  wood.addColorStop(1, '#8b492b');
  context.fillStyle = wood;
  context.fill();
  context.shadowColor = 'transparent';
  context.lineWidth = Math.max(2, layout.cellSize * 0.035);
  context.strokeStyle = 'rgba(255, 217, 144, 0.55)';
  context.stroke();
  roundedRect(context, layout.boardX - 2, layout.boardY - 2, layout.boardSize + 4, layout.boardSize + 4, Math.max(12, layout.cellSize * 0.18));
  context.fillStyle = 'rgba(18, 8, 12, 0.82)';
  context.fill();
  context.restore();
}

function drawSymbol(tile, centerX, centerY, radius) {
  const style = TILE_STYLE[tile.kind];
  context.save();
  context.translate(centerX, centerY);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = style.light;
  context.fillStyle = style.light;
  context.lineWidth = Math.max(1.6, radius * 0.12);

  if (tile.kind === 'turquoise') {
    for (let petal = 0; petal < 6; petal += 1) {
      context.save();
      context.rotate((petal / 6) * Math.PI * 2);
      context.beginPath();
      context.ellipse(0, -radius * 0.34, radius * 0.22, radius * 0.42, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.fillStyle = '#fff2b0';
    context.beginPath();
    context.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
    context.fill();
  } else if (tile.kind === 'amber') {
    for (let ray = 0; ray < 8; ray += 1) {
      context.save();
      context.rotate((ray / 8) * Math.PI * 2);
      context.beginPath();
      context.moveTo(0, -radius * 0.52);
      context.lineTo(-radius * 0.09, -radius * 0.31);
      context.lineTo(radius * 0.09, -radius * 0.31);
      context.closePath();
      context.fill();
      context.restore();
    }
    context.beginPath();
    context.arc(0, 0, radius * 0.29, 0, Math.PI * 2);
    context.fill();
  } else if (tile.kind === 'garnet') {
    context.beginPath();
    context.moveTo(0, -radius * 0.55);
    context.lineTo(radius * 0.45, 0);
    context.lineTo(0, radius * 0.55);
    context.lineTo(-radius * 0.45, 0);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.6)';
    context.lineWidth = radius * 0.06;
    context.beginPath();
    context.moveTo(0, -radius * 0.47);
    context.lineTo(0, radius * 0.47);
    context.moveTo(-radius * 0.38, 0);
    context.lineTo(radius * 0.38, 0);
    context.stroke();
  } else if (tile.kind === 'silver') {
    context.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const angle = -Math.PI / 2 + (point / 10) * Math.PI * 2;
      const distance = point % 2 === 0 ? radius * 0.58 : radius * 0.25;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
  } else if (tile.kind === 'blossom') {
    for (let petal = 0; petal < 5; petal += 1) {
      context.save();
      context.rotate((petal / 5) * Math.PI * 2);
      context.beginPath();
      context.ellipse(0, -radius * 0.28, radius * 0.2, radius * 0.38, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.fillStyle = '#ffe58a';
    context.beginPath();
    context.arc(0, 0, radius * 0.18, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.arc(0, -radius * 0.02, radius * 0.46, Math.PI * 0.15, Math.PI * 0.85, true);
    context.stroke();
    context.beginPath();
    context.arc(0, -radius * 0.02, radius * 0.25, Math.PI * 0.15, Math.PI * 0.85, true);
    context.stroke();
    context.beginPath();
    context.arc(-radius * 0.35, radius * 0.31, radius * 0.08, 0, Math.PI * 2);
    context.arc(radius * 0.35, radius * 0.31, radius * 0.08, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawSpecial(tile, x, y, size) {
  if (!tile.special) return;
  context.save();
  context.strokeStyle = '#fff0a4';
  context.fillStyle = 'rgba(255, 221, 111, 0.88)';
  context.lineWidth = Math.max(1.4, size * 0.035);
  context.shadowColor = '#ffd45e';
  context.shadowBlur = size * 0.16;
  if (tile.special === 'row') {
    context.beginPath();
    context.moveTo(x + size * 0.18, y + size * 0.82);
    context.lineTo(x + size * 0.82, y + size * 0.82);
    context.stroke();
    context.beginPath();
    context.moveTo(x + size * 0.18, y + size * 0.82);
    context.lineTo(x + size * 0.28, y + size * 0.75);
    context.moveTo(x + size * 0.18, y + size * 0.82);
    context.lineTo(x + size * 0.28, y + size * 0.89);
    context.moveTo(x + size * 0.82, y + size * 0.82);
    context.lineTo(x + size * 0.72, y + size * 0.75);
    context.moveTo(x + size * 0.82, y + size * 0.82);
    context.lineTo(x + size * 0.72, y + size * 0.89);
    context.stroke();
  } else if (tile.special === 'column') {
    context.beginPath();
    context.moveTo(x + size * 0.82, y + size * 0.18);
    context.lineTo(x + size * 0.82, y + size * 0.82);
    context.stroke();
    context.beginPath();
    context.moveTo(x + size * 0.82, y + size * 0.18);
    context.lineTo(x + size * 0.75, y + size * 0.28);
    context.moveTo(x + size * 0.82, y + size * 0.18);
    context.lineTo(x + size * 0.89, y + size * 0.28);
    context.moveTo(x + size * 0.82, y + size * 0.82);
    context.lineTo(x + size * 0.75, y + size * 0.72);
    context.moveTo(x + size * 0.82, y + size * 0.82);
    context.lineTo(x + size * 0.89, y + size * 0.72);
    context.stroke();
  } else {
    context.beginPath();
    context.arc(x + size * 0.8, y + size * 0.2, size * 0.1, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x + size * 0.75, y + size * 0.13);
    context.quadraticCurveTo(x + size * 0.66, y + size * 0.03, x + size * 0.6, y + size * 0.09);
    context.stroke();
  }
  context.restore();
}

function drawTile(tile, index, now) {
  const coordinates = cellCoordinates(index, game.columns);
  const gap = layout.gap;
  const x = layout.boardX + coordinates.column * layout.cellSize + gap;
  const y = layout.boardY + coordinates.row * layout.cellSize + gap;
  const size = layout.cellSize - gap * 2;
  const style = TILE_STYLE[tile.kind];
  const isSelected = selected === index;
  const isFocused = focused === index && document.activeElement === canvas;
  const isHovered = hoverIndex === index;
  const isHint = hint?.includes(index);
  const flashRemaining = (flashes.get(index) ?? 0) - now;
  if (flashRemaining <= 0) flashes.delete(index);
  const idleFloat = settings.reducedMotion ? 0 : Math.sin(now * 0.0017 + index * 0.73) * size * 0.012;
  const scale = isSelected ? 1.065 : isHovered ? 1.03 : 1;
  const centerX = x + size / 2;
  const centerY = y + size / 2 + idleFloat;

  context.save();
  context.translate(centerX, centerY);
  context.scale(scale, scale);
  context.translate(-centerX, -centerY);
  context.shadowColor = isSelected || isHint ? style.glow : 'rgba(0,0,0,0.48)';
  context.shadowBlur = isSelected || isHint ? size * 0.32 : size * 0.12;
  context.shadowOffsetY = isSelected || isHint ? 0 : size * 0.07;
  roundedRect(context, x, y + idleFloat, size, size, size * 0.22);
  const gem = context.createLinearGradient(x, y, x + size, y + size);
  gem.addColorStop(0, style.light);
  gem.addColorStop(0.18, style.base);
  gem.addColorStop(0.7, style.dark);
  gem.addColorStop(1, style.base);
  context.fillStyle = gem;
  context.fill();
  context.shadowColor = 'transparent';
  context.lineWidth = Math.max(1.4, size * 0.028);
  context.strokeStyle = isSelected ? '#fff6d1' : 'rgba(255, 245, 218, 0.34)';
  context.stroke();

  roundedRect(context, x + size * 0.09, y + idleFloat + size * 0.08, size * 0.82, size * 0.33, size * 0.15);
  const shine = context.createLinearGradient(0, y, 0, y + size * 0.45);
  shine.addColorStop(0, 'rgba(255,255,255,0.46)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = shine;
  context.fill();

  drawSymbol(tile, centerX, centerY + idleFloat, size * 0.34);
  drawSpecial(tile, x, y + idleFloat, size);

  if (isFocused || isHint) {
    roundedRect(context, x - 2, y + idleFloat - 2, size + 4, size + 4, size * 0.24);
    context.lineWidth = isFocused ? 3 : 2;
    context.setLineDash(isHint ? [5, 5] : []);
    context.strokeStyle = isFocused ? '#ffffff' : 'rgba(255, 239, 157, 0.9)';
    context.stroke();
    context.setLineDash([]);
  }

  if (flashRemaining > 0) {
    const alpha = Math.min(1, flashRemaining / 220);
    roundedRect(context, x, y + idleFloat, size, size, size * 0.22);
    context.fillStyle = `rgba(255, 248, 211, ${alpha * 0.55})`;
    context.fill();
  }
  context.restore();
}

function drawParticles() {
  context.save();
  context.globalCompositeOperation = 'lighter';
  for (const particle of particles) {
    const remaining = 1 - particle.age / particle.life;
    context.globalAlpha = Math.max(0, remaining);
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size * (0.55 + remaining), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `900 ${Math.max(16, layout.cellSize * 0.34)}px system-ui, sans-serif`;
  for (const flyup of flyups) {
    const progress = flyup.age / flyup.life;
    context.globalAlpha = Math.sin(Math.PI * Math.min(1, progress));
    context.fillStyle = flyup.depth > 1 ? '#72f3df' : '#fff0a8';
    context.shadowColor = 'rgba(0,0,0,0.65)';
    context.shadowBlur = 8;
    context.fillText(flyup.text, flyup.x, flyup.y - progress * layout.cellSize * 0.7);
  }
  context.restore();
}

function draw(now) {
  if (!layout) return;
  context.save();
  const shakeActive = now < shakeUntil;
  if (shakeActive) {
    const strength = shakeStrength * (1 - (shakeUntil - now) / Math.max(1, settings.reducedMotion ? 50 : 220));
    context.translate(Math.sin(now * 0.11) * strength, Math.cos(now * 0.14) * strength * 0.6);
  }
  drawBackground(now);
  drawBoardFrame();
  for (let index = 0; index < game.board.length; index += 1) drawTile(game.board[index], index, now);
  drawParticles();
  if (mode !== 'playing') {
    context.fillStyle = 'rgba(17, 7, 12, 0.18)';
    context.fillRect(0, 0, layout.width, layout.height);
  }
  context.restore();
}

function frame(now) {
  const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  updateEffects(delta);
  if (mode === 'playing' && now - lastInteractionAt > 8000 && !hint) hint = findHint(game);
  draw(now);
  requestAnimationFrame(frame);
}

function boot() {
  persist();
  updateHud();
  setMode('title');
  resizeCanvas();
  platform.loaded();
  void platform.connect();
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (error) {
  const panel = document.querySelector('[data-role="boot-error"]');
  panel.hidden = false;
  document.querySelector('[data-role="boot-error-message"]').textContent = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  throw error;
}
