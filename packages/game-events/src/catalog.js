const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEYS = Object.freeze([
  'eventId',
  'name',
  'version',
  'sequence',
  'occurredAt',
  'properties',
]);
const SENSITIVE_PROPERTY = /(?:^|_)(?:access_?token|refresh_?token|token|password|secret|credential|cookie|email|profile|app_?insights_?id|transaction_?id|authorization)(?:$|_)/i;

const string = ({ max = 64, values, optional = false } = {}) => Object.freeze({
  type: 'string',
  max,
  values: values ? Object.freeze([...values]) : null,
  optional,
});
const integer = ({ min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) => Object.freeze({
  type: 'integer',
  min,
  max,
  optional,
});

const LEVEL_ID = string({ max: 64 });
const MODE = string({
  values: ['standalone', 'arkadium-sandbox', 'arkadium-dev', 'arkadium-prod'],
  optional: true,
});
const USER_STATE = string({ values: ['anonymous', 'registered', 'subscriber'], optional: true });
const LOCALE = string({ max: 35, optional: true });
const SCORE = integer();
const MOVES = integer({ max: 10_000 });
const OUTCOME = (values, optional = false) => string({ values, optional });

function definition(properties, {
  arkadium = true,
  gameEye = true,
  prodAllowed = true,
  samplingAllowed = false,
} = {}) {
  return Object.freeze({
    version: 1,
    routes: Object.freeze({ arkadium, gameEye }),
    prodAllowed,
    samplingAllowed,
    properties: Object.freeze({ ...properties }),
  });
}

const CATALOG = Object.freeze({
  sdk_initialize_started: definition({ mode: MODE }, { arkadium: false }),
  sdk_initialize_succeeded: definition({
    mode: MODE,
    userState: USER_STATE,
    locale: LOCALE,
  }, { arkadium: false }),
  sdk_ready: definition({}, { arkadium: false }),
  game_start: definition({ levelId: LEVEL_ID }),
  level_start: definition({ levelId: LEVEL_ID }),
  move_rejected: definition({
    reason: string({ max: 64 }),
    movesRemaining: MOVES,
  }),
  move_accepted: definition({
    scoreDelta: integer(),
    combo: integer({ min: 1, max: 1000 }),
    movesRemaining: MOVES,
  }),
  score_changed: definition({ score: SCORE }),
  pause: definition({ source: string({ values: ['host', 'visibility', 'player', 'system'] }) }),
  resume: definition({ source: string({ values: ['host', 'visibility', 'player', 'system'] }) }),
  level_end: definition({
    levelId: LEVEL_ID,
    result: string({ values: ['won', 'lost', 'completed', 'abandoned'] }),
    score: SCORE,
    movesRemaining: MOVES,
  }),
  game_end: definition({
    reason: string({ values: ['completed', 'lost', 'abandoned', 'error'] }),
    score: integer({ optional: true }),
  }),
  save_load: definition({
    source: string({ values: ['local', 'remote', 'none'] }),
    outcome: OUTCOME(['success', 'empty', 'failure']),
    bytes: integer({ max: 524_288, optional: true }),
  }),
  save_write: definition({
    destination: string({ values: ['local', 'remote'] }),
    outcome: OUTCOME(['success', 'failure']),
    bytes: integer({ max: 524_288 }),
  }),
  ad_request: definition({
    placement: string({ max: 64 }),
    format: string({ values: ['interstitial', 'rewarded'] }),
  }),
  ad_result: definition({
    placement: string({ max: 64 }),
    format: string({ values: ['interstitial', 'rewarded'] }),
    outcome: OUTCOME(['shown', 'completed', 'skipped', 'failed', 'unavailable']),
  }),
  leaderboard_submit: definition({
    board: string({ max: 64 }),
    score: SCORE,
    outcome: OUTCOME(['success', 'failure', 'unsupported']),
  }),
  wallet_balance: definition({
    outcome: OUTCOME(['success', 'failure', 'unsupported']),
    balance: integer({ optional: true }),
  }),
  wallet_consume_result: definition({
    outcome: OUTCOME(['applied', 'rejected', 'ambiguous', 'failure', 'unsupported']),
    amount: integer({ min: 1 }),
  }),
  integration_error: definition({
    stage: string({ max: 64 }),
    code: string({ max: 64 }),
  }),
});

export const GAME_EVENT_NAMES = Object.freeze(Object.keys(CATALOG));

function assertPlainDataObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain data object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must use a plain object prototype.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} cannot contain symbol properties.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) {
      throw new TypeError(`${label} property ${key} must not be an accessor.`);
    }
  }
  return descriptors;
}

function assertExactKeys(descriptors, expected, label) {
  const actual = Object.keys(descriptors).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} contains an unknown or missing property.`);
  }
}

function assertTimestamp(value) {
  if (typeof value !== 'string') throw new TypeError('Event occurredAt must be an ISO timestamp.');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError('Event occurredAt must be a canonical ISO timestamp.');
  }
}

function assertProperty(name, value, spec) {
  if (value === undefined && spec.optional) return;
  if (spec.type === 'string') {
    if (typeof value !== 'string' || value.length === 0 || value.length > spec.max) {
      throw new TypeError(`Event property ${name} must be a bounded non-empty string.`);
    }
    if (spec.values && !spec.values.includes(value)) {
      throw new TypeError(`Event property ${name} has an unsupported value.`);
    }
    return;
  }
  if (spec.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < spec.min || value > spec.max) {
      throw new TypeError(`Event property ${name} must be a bounded safe integer.`);
    }
    return;
  }
  throw new TypeError(`Event property ${name} has an unknown schema.`);
}

function validateProperties(properties, eventDefinition) {
  const descriptors = assertPlainDataObject(properties, 'Event properties');
  if (Object.keys(descriptors).length > 16) {
    throw new TypeError('Event properties exceed the reviewed property limit.');
  }

  for (const key of Object.keys(descriptors)) {
    const normalizedKey = key.replace(/([a-z])([A-Z])/g, '$1_$2');
    if (SENSITIVE_PROPERTY.test(normalizedKey)) {
      throw new TypeError('Event contains a sensitive property name.');
    }
    if (!(key in eventDefinition.properties)) {
      throw new TypeError(`Event contains unknown property ${key}.`);
    }
  }

  for (const [name, spec] of Object.entries(eventDefinition.properties)) {
    const descriptor = descriptors[name];
    if (!descriptor) {
      if (!spec.optional) throw new TypeError(`Event property ${name} is required.`);
      continue;
    }
    const value = descriptor.value;
    if (value === undefined && spec.optional) continue;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new TypeError(`Event property ${name} must be primitive.`);
    }
    assertProperty(name, value, spec);
  }
}

export function getEventDefinition(name) {
  if (typeof name !== 'string' || !(name in CATALOG)) {
    throw new TypeError('Unknown canonical event name.');
  }
  return CATALOG[name];
}

export function validateCanonicalEvent(event) {
  const descriptors = assertPlainDataObject(event, 'Canonical event');
  assertExactKeys(descriptors, EVENT_KEYS, 'Canonical event');

  const eventId = descriptors.eventId.value;
  const name = descriptors.name.value;
  const version = descriptors.version.value;
  const sequence = descriptors.sequence.value;
  const occurredAt = descriptors.occurredAt.value;
  const properties = descriptors.properties.value;

  if (typeof eventId !== 'string' || !UUID_V4.test(eventId)) {
    throw new TypeError('Event eventId must be a UUID v4.');
  }
  const eventDefinition = getEventDefinition(name);
  if (version !== eventDefinition.version) {
    throw new TypeError('Event version does not match the reviewed catalog.');
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError('Event sequence must be a positive safe integer.');
  }
  assertTimestamp(occurredAt);
  validateProperties(properties, eventDefinition);
  return event;
}

export function createCanonicalEventFactory({ now, createId } = {}) {
  if (typeof now !== 'function' || typeof createId !== 'function') {
    throw new TypeError('Canonical event factory requires now and createId functions.');
  }
  let sequence = 0;

  return function createCanonicalEvent(name, properties = {}) {
    const event = {
      eventId: createId(),
      name,
      version: 1,
      sequence: sequence + 1,
      occurredAt: now(),
      properties,
    };
    validateCanonicalEvent(event);
    sequence += 1;
    return Object.freeze({
      ...event,
      properties: Object.freeze({ ...properties }),
    });
  };
}
