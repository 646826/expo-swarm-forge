import { createServer } from 'node:http';

import { validateCanonicalEvent } from '../packages/game-events/src/catalog.js';

const HOST = '127.0.0.1';
const PORT = 3001;
const ALLOWED_ORIGIN = 'http://127.0.0.1:4173';
const MAX_BODY_BYTES = 65_536;
const BUILD_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENVELOPE_KEYS = Object.freeze([
  'schema',
  'project',
  'gameVersion',
  'buildSha',
  'platformMode',
  'sdkVersion',
  'sessionId',
  'locale',
  'userState',
  'events',
]);

function exactDataObject(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  const actual = Object.keys(descriptors).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) return null;
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
  }
  return descriptors;
}

function data(descriptors, key) {
  const descriptor = descriptors?.[key];
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function exactEventArray(value) {
  if (!Array.isArray(value)) return null;
  let descriptors;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length > 0) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > 32) return null;
  const values = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) return null;
    values.push(descriptor.value);
  }
  if (Object.keys(descriptors).filter((key) => key !== 'length').length !== length) return null;
  return values;
}

function validateEnvelope(value) {
  const descriptors = exactDataObject(value, ENVELOPE_KEYS);
  if (!descriptors
    || data(descriptors, 'schema') !== 'ark.game-events.v1'
    || data(descriptors, 'project') !== 'canyon-charms'
    || data(descriptors, 'gameVersion') !== '1.1.0'
    || typeof data(descriptors, 'buildSha') !== 'string'
    || !BUILD_SHA.test(data(descriptors, 'buildSha'))
    || data(descriptors, 'platformMode') !== 'standalone'
    || data(descriptors, 'sdkVersion') !== null
    || typeof data(descriptors, 'sessionId') !== 'string'
    || !UUID_V4.test(data(descriptors, 'sessionId'))
    || data(descriptors, 'locale') !== 'en-US'
    || data(descriptors, 'userState') !== 'anonymous') return null;

  const events = exactEventArray(data(descriptors, 'events'));
  if (!events) return null;
  let previousSequence = 0;
  try {
    for (const event of events) {
      validateCanonicalEvent(event);
      if (event.sequence <= previousSequence) return null;
      previousSequence = event.sequence;
    }
  } catch {
    return null;
  }
  return Object.freeze({ accepted: events.length });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '0',
    vary: 'Origin',
  };
}

function respond(response, statusCode, body, headers = {}) {
  response.statusCode = statusCode;
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  if (body === null) {
    response.end();
    return;
  }
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  response.setHeader(
    'content-type',
    typeof body === 'string'
      ? 'text/plain; charset=utf-8'
      : 'application/json; charset=utf-8',
  );
  response.setHeader('content-length', Buffer.byteLength(text));
  response.end(text);
}

async function readBoundedJson(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const server = createServer(async (incoming, response) => {
  const path = incoming.url ?? '';
  if (incoming.method === 'GET' && path === '/health') {
    respond(response, 200, 'OK');
    return;
  }
  if (path !== '/v1/game-events') {
    respond(response, 404, 'Not found');
    return;
  }
  if (incoming.headers.origin !== ALLOWED_ORIGIN) {
    respond(response, 403, 'Forbidden');
    return;
  }
  if (incoming.method === 'OPTIONS') {
    respond(response, 204, null, corsHeaders());
    return;
  }
  if (incoming.method !== 'POST') {
    respond(response, 405, 'Method not allowed', corsHeaders());
    return;
  }
  const mediaType = String(incoming.headers['content-type'] ?? '').split(';', 1)[0].trim();
  if (mediaType !== 'application/json') {
    respond(response, 415, 'Unsupported media type', corsHeaders());
    return;
  }

  const parsed = await readBoundedJson(incoming);
  const accepted = validateEnvelope(parsed);
  if (!accepted) {
    respond(response, 400, { code: 'INVALID_GAME_EVENTS' }, corsHeaders());
    return;
  }

  response.statusCode = 202;
  respond(response, 202, accepted, corsHeaders());
});

server.listen(PORT, HOST, () => {
  console.log(`Local Game Eye fixture listening on ${HOST}:${PORT}.`);
});

let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.close(() => process.exit(0));
}
process.once('SIGTERM', close);
process.once('SIGINT', close);
