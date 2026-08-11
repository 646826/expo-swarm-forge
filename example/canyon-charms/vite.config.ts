import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

const sandboxDriverSource = String.raw`
const evidenceSearch = new URLSearchParams(location.search);
const sandboxEvidence = evidenceSearch.get('sandboxEvidence') === '1';
const telemetryEvidence = evidenceSearch.get('telemetryEvidence') === '1';
const sandboxRuntimeManifest = globalThis.__CANYON_RUNTIME_MANIFEST__ ?? null;
const deterministicEvidence = (
  sandboxEvidence && sandboxRuntimeManifest?.mode === 'arkadium-sandbox'
) || (
  telemetryEvidence && sandboxRuntimeManifest?.mode === 'standalone'
);
if (deterministicEvidence
  && sandboxRuntimeManifest.mode !== 'arkadium-prod'
  && !Object.prototype.hasOwnProperty.call(globalThis, '__CANYON_SANDBOX_DRIVER__')) {
  const pointForSandboxDriver = (index) => {
    if (!layout) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const center = cellCenter(index);
    return Object.freeze({
      x: rect.left + center.x * (rect.width / layout.width),
      y: rect.top + center.y * (rect.height / layout.height),
    });
  };
  const sandboxDriver = Object.freeze({
    snapshot() {
      return Object.freeze({
        mode,
        status: game.status,
        score: game.score,
        moves: game.moves,
      });
    },
    nextMove() {
      if (mode !== 'playing' || game.status !== 'playing') return null;
      const move = findHint(game);
      if (!move) return null;
      const first = pointForSandboxDriver(move[0]);
      const second = pointForSandboxDriver(move[1]);
      return first && second ? Object.freeze({ first, second }) : null;
    },
  });
  Object.defineProperty(globalThis, '__CANYON_SANDBOX_DRIVER__', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: sandboxDriver,
  });
  window.addEventListener('pagehide', () => {
    delete globalThis.__CANYON_SANDBOX_DRIVER__;
  }, { once: true });
}
`;

export default defineConfig({
  root,
  base: './',
  plugins: [{
    name: 'canyon-sandbox-evidence-driver',
    apply: 'build',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/main.js')) return null;
      return {
        code: `${source}\n${sandboxDriverSource}`,
        map: null,
      };
    },
  }],
  build: {
    outDir: 'arkadium-dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});