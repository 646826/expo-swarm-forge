const PHASES = Object.freeze({
  NEW: 'new',
  INITIALIZING: 'initializing',
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ENDED: 'ended',
  DESTROYED: 'destroyed',
});

const SAFE_FAILURES = Object.freeze({
  initialize: 'Unable to initialize the publisher platform.',
  ready: 'Unable to signal publisher readiness.',
  subscribe: 'Unable to register publisher lifecycle callbacks.',
  gameStart: 'Unable to signal the publisher game start.',
  levelStart: 'Unable to signal the publisher level start.',
  score: 'Unable to report the publisher score.',
  levelEnd: 'Unable to signal the publisher level end.',
  gameEnd: 'Unable to signal the publisher game end.',
  destroy: 'Unable to destroy the publisher platform cleanly.',
  pauseEffect: 'Unable to apply the paused presentation state.',
  resumeEffect: 'Unable to apply the resumed presentation state.',
});

function success(value = undefined) {
  return Object.freeze({ ok: true, value });
}

function failure(code, message) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, retryable: false }),
  });
}

function validLevelId(levelId) {
  return typeof levelId === 'string' && levelId.length > 0 && levelId.length <= 64;
}

function normalizeScore(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const score = Math.round(value);
  return Number.isSafeInteger(score) ? score : null;
}

/**
 * Owns the publisher-facing lifecycle for one page load.
 *
 * Gameplay rules and rendering stay outside this controller. Public operations
 * are serialized so duplicate UI, host, or browser events cannot race into
 * duplicate publisher calls.
 */
export function createGameSessionController({
  platform,
  setPaused = () => {},
  suspendAudio = () => {},
  resumeAudio = () => {},
  reportIntegrationError = () => {},
  publisherMode = false,
} = {}) {
  if (!platform || typeof platform !== 'object') {
    throw new TypeError('A publisher platform is required.');
  }

  let phase = PHASES.NEW;
  let chain = Promise.resolve();
  let context = null;
  let currentLevelId = null;
  let lastScore = -1;
  let gameStarted = false;
  let levelStarted = false;
  let levelEnded = false;
  let gameEnded = false;
  let platformDestroyed = false;
  const subscriptions = [];

  function report(message) {
    try {
      reportIntegrationError(message);
    } catch {
      // Diagnostics must never break gameplay or lifecycle cleanup.
    }
  }

  function enqueue(operation) {
    const scheduled = chain.then(operation, operation);
    chain = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  async function callPlatform(stage, operation, { critical = false } = {}) {
    try {
      const result = await operation();
      if (result?.ok === true) return result;
    } catch {
      // The stable stage-specific error below intentionally replaces SDK data.
    }

    const message = SAFE_FAILURES[stage] ?? 'Publisher integration failed.';
    report(message);
    if (critical) phase = PHASES.ENDED;
    return failure(
      publisherMode ? 'PUBLISHER_INTEGRATION_FAILED' : 'PLATFORM_INTEGRATION_FAILED',
      message,
    );
  }

  async function applyEffects(paused) {
    try {
      await Promise.resolve(setPaused(paused));
      await Promise.resolve(paused ? suspendAudio() : resumeAudio());
      return success();
    } catch {
      const stage = paused ? 'pauseEffect' : 'resumeEffect';
      const message = SAFE_FAILURES[stage];
      report(message);
      return failure('PRESENTATION_TRANSITION_FAILED', message);
    }
  }

  function removeSubscriptions() {
    while (subscriptions.length > 0) {
      const unsubscribe = subscriptions.pop();
      try {
        unsubscribe?.();
      } catch {
        // Cleanup remains best effort and idempotent.
      }
    }
  }

  function registerHostLifecycle() {
    try {
      const unsubscribePause = platform.onPause(() => {
        void pause();
      });
      const unsubscribeResume = platform.onResume(() => {
        void resume();
      });
      if (typeof unsubscribePause === 'function') subscriptions.push(unsubscribePause);
      if (typeof unsubscribeResume === 'function') subscriptions.push(unsubscribeResume);
      return success();
    } catch {
      const message = SAFE_FAILURES.subscribe;
      report(message);
      phase = PHASES.ENDED;
      removeSubscriptions();
      return failure('PUBLISHER_INTEGRATION_FAILED', message);
    }
  }

  function boot() {
    return enqueue(async () => {
      if (phase === PHASES.READY || phase === PHASES.PLAYING || phase === PHASES.PAUSED) {
        return success(context);
      }
      if (phase !== PHASES.NEW) {
        return failure('INVALID_SESSION_PHASE', 'Session boot is unavailable in the current phase.');
      }

      phase = PHASES.INITIALIZING;
      const initialized = await callPlatform('initialize', () => platform.initialize(), {
        critical: true,
      });
      if (!initialized.ok) return initialized;
      context = initialized.value;

      const subscribed = registerHostLifecycle();
      if (!subscribed.ok) return subscribed;

      const ready = await callPlatform('ready', () => platform.signalReady(), {
        critical: true,
      });
      if (!ready.ok) {
        removeSubscriptions();
        return ready;
      }

      phase = PHASES.READY;
      return success(context);
    });
  }

  function startLevel(levelId) {
    return enqueue(async () => {
      if (phase === PHASES.DESTROYED || phase === PHASES.ENDED) {
        return failure('INVALID_SESSION_PHASE', 'Level start is unavailable in the current phase.');
      }
      if (!validLevelId(levelId)) {
        return failure('INVALID_LEVEL_ID', 'Level ID must be a bounded non-empty string.');
      }
      if (
        (phase === PHASES.PLAYING || phase === PHASES.PAUSED)
        && currentLevelId === levelId
        && levelStarted
      ) {
        return success();
      }
      if (phase !== PHASES.READY) {
        return failure('INVALID_SESSION_PHASE', 'Level start requires a ready session.');
      }

      if (!gameStarted) {
        const started = await callPlatform('gameStart', () => platform.signalGameStart());
        if (!started.ok) return started;
        gameStarted = true;
      }

      if (!levelStarted) {
        const started = await callPlatform('levelStart', () => platform.signalLevelStart(levelId));
        if (!started.ok) return started;
        currentLevelId = levelId;
        levelStarted = true;
      }

      phase = PHASES.PLAYING;
      return success();
    });
  }

  function score(value) {
    return enqueue(async () => {
      if (phase !== PHASES.PLAYING && phase !== PHASES.PAUSED) {
        return failure('INVALID_SESSION_PHASE', 'Score reporting requires an active level.');
      }
      const normalized = normalizeScore(value);
      if (normalized === null) {
        return failure('INVALID_SCORE', 'Score must be a non-negative safe number.');
      }
      if (normalized <= lastScore) return success(lastScore);

      const reported = await callPlatform('score', () => platform.signalScore(normalized));
      if (!reported.ok) return reported;
      lastScore = normalized;
      return success(lastScore);
    });
  }

  function pause() {
    return enqueue(async () => {
      if (phase !== PHASES.PLAYING) return success();
      phase = PHASES.PAUSED;
      return applyEffects(true);
    });
  }

  function resume() {
    return enqueue(async () => {
      if (phase !== PHASES.PAUSED) return success();
      phase = PHASES.PLAYING;
      return applyEffects(false);
    });
  }

  function endLevel(levelId, reason = 'completed') {
    return enqueue(async () => {
      if (phase === PHASES.ENDED) return success();
      if (phase === PHASES.DESTROYED) {
        return failure('INVALID_SESSION_PHASE', 'Level end is unavailable after destroy.');
      }
      if (phase !== PHASES.PLAYING && phase !== PHASES.PAUSED) {
        return failure('INVALID_SESSION_PHASE', 'Level end requires an active level.');
      }
      if (levelId !== currentLevelId) {
        return failure('INVALID_LEVEL_ID', 'Level end must match the active level.');
      }
      if (typeof reason !== 'string' || reason.length === 0 || reason.length > 64) {
        return failure('INVALID_END_REASON', 'Game-end reason must be a bounded string.');
      }

      if (!levelEnded) {
        const ended = await callPlatform('levelEnd', () => platform.signalLevelEnd(levelId));
        if (!ended.ok) return ended;
        levelEnded = true;
      }
      if (!gameEnded) {
        const ended = await callPlatform('gameEnd', () => platform.signalGameEnd(reason));
        if (!ended.ok) return ended;
        gameEnded = true;
      }

      phase = PHASES.ENDED;
      return success();
    });
  }

  function destroy() {
    return enqueue(async () => {
      if (phase === PHASES.DESTROYED) return success();
      removeSubscriptions();
      if (!platformDestroyed) {
        platformDestroyed = true;
        try {
          await platform.destroy();
        } catch {
          report(SAFE_FAILURES.destroy);
        }
      }
      phase = PHASES.DESTROYED;
      return success();
    });
  }

  return Object.freeze({
    get phase() {
      return phase;
    },
    boot,
    startLevel,
    score,
    pause,
    resume,
    endLevel,
    destroy,
    settled: () => chain,
  });
}

export { PHASES as SESSION_PHASES };
