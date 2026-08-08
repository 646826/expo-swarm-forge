import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduceState } from '../src/state.js';

test('starter follows title, play, pause, resume, and result', () => {
  let state = createInitialState();
  state = reduceState(state, { type: 'START' });
  state = reduceState(state, { type: 'PAUSE' });
  assert.equal(state.screen, 'paused');
  state = reduceState(state, { type: 'RESUME' });
  state = reduceState(state, { type: 'FINISH', score: 1200 });
  assert.deepEqual({ screen: state.screen, score: state.score }, { screen: 'result', score: 1200 });
});

test('starter settings are immutable toggles', () => {
  const before = createInitialState();
  const after = reduceState(before, { type: 'TOGGLE_SOUND' });
  assert.notEqual(after, before);
  assert.equal(before.sound, true);
  assert.equal(after.sound, false);
});
