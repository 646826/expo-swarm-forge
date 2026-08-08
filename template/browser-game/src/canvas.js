export function createCanvasSurface(canvas, { maxDpr = 2 } = {}) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  let width = 1;
  let height = 1;
  let dpr = 1;
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(maxDpr, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, dpr };
  };
  return { canvas, context, resize, get size() { return { width, height, dpr }; } };
}
