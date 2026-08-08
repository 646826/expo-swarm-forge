import { createAudioPort } from './audio.js';
import { createCanvasSurface } from './canvas.js';
import { createFixedStepLoop } from './loop.js';
import { createPlatformBridge } from './platform.js';
import { createInitialState, reduceState } from './state.js';

const canvas = document.querySelector('canvas');
const status = document.querySelector('[data-role="status"]');
const play = document.querySelector('[data-action="play"]');
const pause = document.querySelector('[data-action="pause"]');
const sound = document.querySelector('[data-action="sound"]');
const motion = document.querySelector('[data-action="motion"]');
const errorPanel = document.querySelector('[data-role="error"]');

try {
  const surface = createCanvasSurface(canvas);
  const audio = createAudioPort();
  const platform = createPlatformBridge();
  let state = createInitialState();
  const updateView = () => {
    status.textContent = `${state.screen} · ${Math.round(state.elapsed)}s · ${state.score}`;
    pause.textContent = state.screen === 'paused' ? 'Resume' : 'Pause';
    sound.setAttribute('aria-pressed', String(state.sound));
    motion.setAttribute('aria-pressed', String(state.reducedMotion));
  };
  const loop = createFixedStepLoop({
    update(dt) { state = reduceState(state, { type: 'TICK', dt }); },
    render() {
      const { context: ctx } = surface;
      const { width, height } = surface.size;
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#261343');
      gradient.addColorStop(1, '#0f2440');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ffd15f';
      ctx.font = '700 28px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(state.screen === 'playing' ? 'Your game world goes here' : '__GAME_TITLE__', width / 2, height / 2);
      updateView();
    },
  });
  const resize = () => surface.resize();
  new ResizeObserver(resize).observe(canvas);
  resize();
  play.addEventListener('click', async () => {
    state = reduceState(state, { type: 'START' });
    await audio.ping(520);
    await platform.signal('gameStart', { title: '__GAME_TITLE__' });
    canvas.focus();
  });
  pause.addEventListener('click', () => {
    state = reduceState(state, { type: state.screen === 'paused' ? 'RESUME' : 'PAUSE' });
  });
  sound.addEventListener('click', () => {
    state = reduceState(state, { type: 'TOGGLE_SOUND' });
    audio.setEnabled(state.sound);
  });
  motion.addEventListener('click', () => { state = reduceState(state, { type: 'TOGGLE_MOTION' }); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === 'playing') state = reduceState(state, { type: 'PAUSE' });
    if (document.hidden) void audio.suspend();
  });
  void platform.connect();
  loop.start();
  updateView();
} catch (error) {
  errorPanel.hidden = false;
  errorPanel.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}`;
}
