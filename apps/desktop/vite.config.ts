import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  resolve: {
    // This browser-safe entry is emitted as CommonJS by core; bundle its TS source as ESM.
    alias: {
      '@canvas-cut/core/dist/canvas/white-model': resolve(__dirname, '../../packages/core/src/canvas/white-model.ts'),
      '@canvas-cut/core/dist/provider/model-catalog': resolve(__dirname, '../../packages/core/src/provider/model-catalog.ts')
    }
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: { app: resolve(__dirname, 'index.html'), whiteModel: resolve(__dirname, 'white-model.html') }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
