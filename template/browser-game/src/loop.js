export function createFixedStepLoop({ step = 1 / 60, update, render, maxFrame = 0.25 }) {
  if (!(step > 0) || typeof update !== 'function' || typeof render !== 'function') {
    throw new TypeError('createFixedStepLoop requires positive step, update, and render');
  }
  let running = false;
  let frameId = 0;
  let previous = 0;
  let accumulator = 0;

  const frame = (now) => {
    if (!running) return;
    const seconds = previous === 0 ? 0 : Math.min(maxFrame, Math.max(0, (now - previous) / 1000));
    previous = now;
    accumulator += seconds;
    while (accumulator >= step) {
      update(step);
      accumulator -= step;
    }
    render(accumulator / step);
    frameId = requestAnimationFrame(frame);
  };

  return {
    start() {
      if (running) return;
      running = true;
      previous = 0;
      frameId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frameId);
    },
    get running() { return running; },
  };
}
