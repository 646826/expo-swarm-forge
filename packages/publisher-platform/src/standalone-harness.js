import { createStandalonePublisherPlatform } from './standalone.js';

function createEventSource() {
  const pauseHandlers = new Set();
  const resumeHandlers = new Set();
  const subscribe = (handlers) => (handler) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  };
  const emit = (handlers) => {
    for (const handler of [...handlers]) handler();
  };
  return {
    source: Object.freeze({
      onPause: subscribe(pauseHandlers),
      onResume: subscribe(resumeHandlers),
    }),
    pause: () => emit(pauseHandlers),
    resume: () => emit(resumeHandlers),
  };
}

export function createStandalonePlatformHarness(options = {}) {
  const events = createEventSource();
  return Object.freeze({
    platform: createStandalonePublisherPlatform({
      locale: options.locale,
      eventSource: events.source,
    }),
    pause: events.pause,
    resume: events.resume,
  });
}
