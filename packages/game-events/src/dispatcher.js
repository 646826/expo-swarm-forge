import { getEventDefinition, validateCanonicalEvent } from './catalog.js';

const ROUTES = Object.freeze(['arkadium', 'gameEye']);
const SINK_ID = /^[a-z][a-z0-9-]{0,63}$/;

function normalizeSink(sink) {
  if (!sink || typeof sink !== 'object' || Array.isArray(sink)) {
    throw new TypeError('Event sink must be an object.');
  }
  if (typeof sink.id !== 'string' || !SINK_ID.test(sink.id)) {
    throw new TypeError('Event sink id must be a bounded lowercase identifier.');
  }
  if (!ROUTES.includes(sink.route)) {
    throw new TypeError('Event sink route is not reviewed.');
  }
  if (typeof sink.dispatch !== 'function') {
    throw new TypeError('Event sink dispatch must be a function.');
  }
  return Object.freeze({
    id: sink.id,
    route: sink.route,
    dispatch: sink.dispatch.bind(sink),
  });
}

export function createEventDispatcher(sinks = []) {
  if (!Array.isArray(sinks)) throw new TypeError('Event sinks must be an array.');
  const normalized = sinks.map(normalizeSink);
  const ids = new Set();
  for (const sink of normalized) {
    if (ids.has(sink.id)) throw new TypeError('Duplicate event sink id.');
    ids.add(sink.id);
  }

  return Object.freeze({
    async dispatch(event) {
      validateCanonicalEvent(event);
      const definition = getEventDefinition(event.name);
      const delivered = [];
      const failed = [];

      for (const sink of normalized) {
        if (!definition.routes[sink.route]) continue;
        try {
          await sink.dispatch(event);
          delivered.push(sink.id);
        } catch {
          failed.push(Object.freeze({
            id: sink.id,
            code: 'SINK_DELIVERY_FAILED',
          }));
        }
      }

      return Object.freeze({
        delivered: Object.freeze(delivered),
        failed: Object.freeze(failed),
      });
    },
  });
}
