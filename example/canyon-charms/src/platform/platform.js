const STORAGE_KEY = 'canyon-charms-v1';

export const DEFAULT_SETTINGS = Object.freeze({
  sound: true,
  reducedMotion: false,
  bestScore: 0,
});

export function normalizeSettings(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    sound: value.sound !== false,
    reducedMotion: value.reducedMotion === true,
    bestScore: Number.isFinite(value.bestScore)
      ? Math.max(0, Math.round(value.bestScore))
      : 0,
  };
}

export function createStorage(storage = globalThis.localStorage) {
  return Object.freeze({
    load() {
      try {
        const raw = storage?.getItem?.(STORAGE_KEY);
        return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },
    save(settings) {
      const normalized = normalizeSettings(settings);
      try {
        storage?.setItem?.(STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // Storage is best effort. Private browsing and embedded frames may reject it.
      }
      return normalized;
    },
  });
}

function callable(target, names) {
  for (const name of names) {
    if (typeof target?.[name] === 'function') return target[name].bind(target);
  }
  return null;
}

/**
 * Legacy standalone compatibility for historical hosts that inject an
 * untyped global object. Arkadium publisher modes must never select this
 * adapter; they use the exact official SDK adapter in a later runtime layer.
 */
export function createLegacyCompatibilityPlatform(host = globalThis) {
  const queued = [];
  const MAX_QUEUE = 32;
  let adapter = null;
  let ready = false;

  function discover() {
    const candidate = host?.Arkadium ?? host?.arkadium ?? host?.publisherPlatform ?? null;
    if (!candidate) return null;
    return Object.freeze({
      loaded: callable(candidate, ['gameLoaded', 'loaded', 'onLoaded']),
      started: callable(candidate, ['gameStart', 'started', 'onStarted']),
      paused: callable(candidate, ['gamePause', 'paused', 'onPaused']),
      resumed: callable(candidate, ['gameResume', 'resumed', 'onResumed']),
      completed: callable(candidate, ['gameComplete', 'completed', 'onCompleted']),
      score: callable(candidate, ['submitScore', 'score', 'setScore']),
      event: callable(candidate, ['trackEvent', 'event', 'analyticsEvent']),
    });
  }

  async function invoke(kind, payload) {
    const target = adapter?.[kind];
    if (!target) return false;
    try {
      await Promise.resolve(target(payload));
      return true;
    } catch {
      return false;
    }
  }

  async function flush() {
    if (!adapter) adapter = discover();
    if (!adapter) return false;
    ready = true;
    while (queued.length > 0) {
      const item = queued.shift();
      await invoke(item.kind, item.payload);
    }
    return true;
  }

  function emit(kind, payload = undefined) {
    if (ready && adapter) {
      void invoke(kind, payload);
      return;
    }
    if (queued.length === MAX_QUEUE) queued.shift();
    queued.push(Object.freeze({ kind, payload }));
    void flush();
  }

  return Object.freeze({
    connect: flush,
    loaded: () => emit('loaded'),
    started: () => emit('started'),
    paused: () => emit('paused'),
    resumed: () => emit('resumed'),
    completed: (result) => emit('completed', result),
    submitScore: (score) => emit('score', Math.max(0, Math.round(score))),
    track: (name, data = {}) => emit('event', { name, ...data }),
    diagnostics: () => Object.freeze({ connected: ready, queued: queued.length }),
  });
}

// Temporary source-compatible alias for the current standalone UI. Task 6
// removes direct UI use when the typed runtime platform is wired in.
export const createPublisherPlatform = createLegacyCompatibilityPlatform;
