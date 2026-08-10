import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: 'arkadium-dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
