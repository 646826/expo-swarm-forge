import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GAME_EVENT_NAMES,
  createCanonicalEventFactory,
  getEventDefinition,
  validateCanonicalEvent,
} from '../src/catalog.js';
import { createEventDispatcher } from '../src/dispatcher.js';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const NOW = '2026-08-10T12:00:00.000Z';

function eventFactory() {
  let id = 0;
  return createCanonicalEventFactory({
    now: () => NOW,
    createId: () => `11111111-2222-4333-8444-${String(555555555555 + id++).padStart(12, '0')}`,
  });
}

test('event factory emits immutable ordered reviewed events', () => {
  const createEvent = eventFactory();
  const first = createEvent('game_start', { levelId: '1' });
  const second = createEvent('move_accepted', {
    scoreDelta: 240,
    combo: 1,
    movesRemaining: 19,
  });

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(first.occurredAt, NOW);
  assert.match(first.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(validateCanonicalEvent(second), second);
  assert.equal(Object.isFrozen(second), true);
  assert.equal(Object.isFrozen(second.properties), true);
  assert.throws(() => {
    second.properties.combo = 99;
  }, TypeError);
});

test('catalog contains every approved integration event and routing metadata', () => {
  assert.deepEqual(GAME_EVENT_NAMES, [
    'sdk_initialize_started',
    'sdk_initialize_succeeded',
    'sdk_ready',
    'game_start',
    'level_start',
    'move_rejected',
    'move_accepted',
    'score_changed',
    'pause',
    'resume',
    'level_end',
    'game_end',
    'save_load',
    'save_write',
    'ad_request',
    'ad_result',
    'leaderboard_submit',
    'wallet_balance',
    'wallet_consume_result',
    'integration_error',
  ]);

  const move = getEventDefinition('move_accepted');
  assert.deepEqual(move.routes, { arkadium: true, gameEye: true });
  assert.equal(move.prodAllowed, true);
  assert.equal(move.samplingAllowed, false);
  assert.equal(Object.isFrozen(move), true);
});

test('unknown events and properties fail before dispatch', () => {
  const createEvent = eventFactory();
  assert.throws(() => createEvent('made_up_event', {}), /event name/i);
  assert.throws(
    () => createEvent('game_start', { levelId: '1', arbitrary: true }),
    /property/i,
  );
  assert.throws(
    () => createEvent('game_start', { levelId: 'x'.repeat(65) }),
    /levelId/i,
  );
});

test('sensitive property names and non-primitive values are rejected', () => {
  const createEvent = eventFactory();
  for (const property of [
    'token',
    'accessToken',
    'password',
    'secret',
    'credential',
    'cookie',
    'email',
    'profile',
    'appInsightsId',
    'transactionId',
  ]) {
    assert.throws(
      () => createEvent('integration_error', { stage: 'boot', code: 'SDK', [property]: 'x' }),
      /sensitive|property/i,
      property,
    );
  }

  assert.throws(
    () => createEvent('integration_error', {
      stage: 'boot',
      code: 'SDK',
      details: { nested: true },
    }),
    /property/i,
  );
});

test('numeric, enum, UUID, timestamp, and sequence constraints fail closed', () => {
  const valid = {
    eventId: EVENT_ID,
    name: 'move_accepted',
    version: 1,
    sequence: 1,
    occurredAt: NOW,
    properties: { scoreDelta: 240, combo: 1, movesRemaining: 19 },
  };

  for (const candidate of [
    { ...valid, eventId: 'not-a-uuid' },
    { ...valid, version: 2 },
    { ...valid, sequence: 0 },
    { ...valid, occurredAt: 'yesterday' },
    { ...valid, properties: { ...valid.properties, scoreDelta: Number.NaN } },
    { ...valid, properties: { ...valid.properties, combo: -1 } },
  ]) {
    assert.throws(() => validateCanonicalEvent(candidate));
  }

  assert.throws(
    () => validateCanonicalEvent({
      ...valid,
      name: 'pause',
      properties: { source: 'unknown' },
    }),
    /source/i,
  );
});

test('dispatcher sends only to reviewed routes and redacts sink failures', async () => {
  const calls = [];
  const dispatcher = createEventDispatcher([
    {
      id: 'arkadium',
      route: 'arkadium',
      dispatch: async (event) => calls.push(`arkadium:${event.name}`),
    },
    {
      id: 'eye',
      route: 'gameEye',
      dispatch: async (event) => {
        calls.push(`eye:${event.name}`);
        if (event.name === 'integration_error') {
          throw new Error('upstream token=do-not-echo');
        }
      },
    },
  ]);
  const createEvent = eventFactory();

  const gameStart = await dispatcher.dispatch(createEvent('game_start', { levelId: '1' }));
  assert.deepEqual(gameStart, {
    delivered: ['arkadium', 'eye'],
    failed: [],
  });

  const failed = await dispatcher.dispatch(createEvent('integration_error', {
    stage: 'initialize',
    code: 'SDK_FAILURE',
  }));
  assert.deepEqual(failed.delivered, ['arkadium']);
  assert.deepEqual(failed.failed, [{ id: 'eye', code: 'SINK_DELIVERY_FAILED' }]);
  assert.doesNotMatch(JSON.stringify(failed), /token|do-not-echo/i);
  assert.deepEqual(calls, [
    'arkadium:game_start',
    'eye:game_start',
    'arkadium:integration_error',
    'eye:integration_error',
  ]);
});

test('dispatcher rejects duplicate IDs, unknown routes, and malformed events', async () => {
  assert.throws(
    () => createEventDispatcher([
      { id: 'same', route: 'arkadium', dispatch: async () => {} },
      { id: 'same', route: 'gameEye', dispatch: async () => {} },
    ]),
    /duplicate/i,
  );
  assert.throws(
    () => createEventDispatcher([
      { id: 'bad', route: 'other', dispatch: async () => {} },
    ]),
    /route/i,
  );

  const dispatcher = createEventDispatcher([]);
  await assert.rejects(
    () => dispatcher.dispatch({ name: 'game_start' }),
    /event/i,
  );
});
