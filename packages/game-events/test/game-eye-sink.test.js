import assert from 'node:assert/strict';
import test from 'node:test';

import { createCanonicalEventFactory } from '../src/catalog.js';
import { createGameEyeSink } from '../src/game-eye-sink.js';

const BUILD_SHA = '1111111111111111111111111111111111111111';
const SESSION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const STARTED_AT = '2026-08-10T14:00:00.000Z';

const CONTEXT = Object.freeze({
  project: 'canyon-charms',
  gameVersion: '1.1.0',
  buildSha: BUILD_SHA,
  platformMode: 'arkadium-sandbox',
  sdkVersion: '2.66.2',
  locale: 'en-US',
  userState: 'anonymous',
});

function events(count) {
  let id = 0;
  const createEvent = createCanonicalEventFactory({
    now: () => STARTED_AT,
    createId: () => `11111111-2222-4333-8444-${String(555555555555 + id++).padStart(12, '0')}`,
  });
  return Array.from({ length: count }, (_, index) => createEvent('score_changed', {
    score: (index + 1) * 10,
  }));
}

function sinkOptions(overrides = {}) {
  return {
    endpoint: 'http://127.0.0.1:3001/v1/game-events',
    context: CONTEXT,
    createSessionId: () => SESSION_ID,
    retryDelaysMs: [0, 0],
    sleepImpl: async () => {},
    autoFlush: false,
    ...overrides,
  };
}

test('failed delivery retries only the first bounded batch and retains the queue', async () => {
  const requests = [];
  const sink = createGameEyeSink(sinkOptions({
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response('upstream credential=do-not-echo', { status: 503 });
    },
  }));

  for (const event of events(40)) await sink.enqueue(event);
  const result = await sink.flush();

  assert.equal(result.ok, false);
  assert.equal(requests.length, 3);
  assert.equal(requests.every((request) => request.body.events.length === 32), true);
  assert.equal(requests.every((request) => request.init.keepalive === true), true);
  assert.equal(requests.every((request) => request.init.headers['content-type'] === 'application/json'), true);
  assert.deepEqual(sink.diagnostics(), {
    sessionId: SESSION_ID,
    queueCount: 40,
    droppedCount: 0,
    inFlight: false,
    lastResult: {
      outcome: 'failed',
      attempts: 3,
      batchSize: 32,
      httpStatus: 503,
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /credential|do-not-echo/i);
});

test('successful delivery emits exact envelopes in ordered batches of at most 32', async () => {
  const requests = [];
  const sink = createGameEyeSink(sinkOptions({
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    },
  }));

  for (const event of events(40)) await sink.enqueue(event);
  const result = await sink.flush();

  assert.equal(result.ok, true);
  assert.deepEqual(requests.map((request) => request.body.events.length), [32, 8]);
  const first = requests[0].body;
  assert.deepEqual(Object.keys(first).sort(), [
    'buildSha',
    'events',
    'gameVersion',
    'locale',
    'platformMode',
    'project',
    'schema',
    'sdkVersion',
    'sessionId',
    'userState',
  ]);
  assert.equal(first.schema, 'ark.game-events.v1');
  assert.equal(first.project, 'canyon-charms');
  assert.equal(first.gameVersion, '1.1.0');
  assert.equal(first.buildSha, BUILD_SHA);
  assert.equal(first.platformMode, 'arkadium-sandbox');
  assert.equal(first.sdkVersion, '2.66.2');
  assert.equal(first.sessionId, SESSION_ID);
  assert.equal(first.locale, 'en-US');
  assert.equal(first.userState, 'anonymous');
  assert.deepEqual(
    requests.flatMap((request) => request.body.events.map((event) => event.sequence)),
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
  assert.equal(sink.diagnostics().queueCount, 0);
  assert.deepEqual(sink.diagnostics().lastResult, {
    outcome: 'delivered',
    attempts: 1,
    batchSize: 8,
    httpStatus: 204,
  });
});

test('queue overflow is bounded, deterministic, and never blocks dispatcher calls', async () => {
  const pending = [];
  const sink = createGameEyeSink(sinkOptions({
    maxQueueSize: 3,
    autoFlush: true,
    fetchImpl: async () => new Promise((resolve) => pending.push(resolve)),
  }));
  const input = events(5);

  for (const event of input) await sink.dispatch(event);
  await Promise.resolve();

  const diagnostics = sink.diagnostics();
  assert.equal(diagnostics.queueCount, 3);
  assert.equal(diagnostics.droppedCount, 2);
  assert.deepEqual(sink.queuedEvents().map((event) => event.sequence), [3, 4, 5]);
  assert.equal(diagnostics.inFlight, true);

  pending[0](new Response(null, { status: 204 }));
  await sink.settled();
});

test('unload beacon sends only a validated bounded envelope', async () => {
  const beacons = [];
  const sink = createGameEyeSink(sinkOptions({
    fetchImpl: async () => {
      throw new Error('fetch must not run');
    },
    beaconImpl: (url, payload) => {
      beacons.push({ url, payload });
      return true;
    },
  }));

  for (const event of events(2)) await sink.enqueue(event);
  const result = sink.flushOnUnload();

  assert.equal(result.ok, true);
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].url, 'http://127.0.0.1:3001/v1/game-events');
  assert.equal(beacons[0].payload.type, 'application/json');
  const envelope = JSON.parse(await beacons[0].payload.text());
  assert.equal(envelope.schema, 'ark.game-events.v1');
  assert.equal(envelope.events.length, 2);
  assert.equal(sink.diagnostics().queueCount, 0);
  assert.equal(sink.diagnostics().lastResult.outcome, 'beaconed');
});

test('context, events, endpoints, and diagnostics fail closed without echoing sensitive values', async () => {
  for (const candidate of [
    { ...CONTEXT, credential: 'do-not-echo' },
    { ...CONTEXT, buildSha: 'not-a-sha' },
    { ...CONTEXT, platformMode: 'unknown' },
  ]) {
    assert.throws(
      () => createGameEyeSink(sinkOptions({ context: candidate })),
      (error) => {
        assert.match(error.message, /context|configuration/i);
        assert.doesNotMatch(error.message, /credential|do-not-echo|not-a-sha|unknown/i);
        return true;
      },
    );
  }

  assert.throws(
    () => createGameEyeSink(sinkOptions({ endpoint: 'https://user:password@example.com/events' })),
    /endpoint/i,
  );

  const sink = createGameEyeSink(sinkOptions({ fetchImpl: async () => new Response(null, { status: 204 }) }));
  await assert.rejects(
    () => sink.enqueue({ name: 'game_start', token: 'do-not-echo' }),
    (error) => {
      assert.match(error.message, /event/i);
      assert.doesNotMatch(error.message, /token|do-not-echo/i);
      return true;
    },
  );
  assert.equal(sink.diagnostics().queueCount, 0);
});
