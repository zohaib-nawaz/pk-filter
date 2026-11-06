import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { brandHtml } from '../brand/brand.mjs';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

const config = {
  plugins: [react(), tailwindcss(), brandHtml()],
  resolve: { alias: { '@shared': resolve(root, '../extension/src/core') } },
  server: { port: 3180, strictPort: true, fs: { allow: [resolve(root, '..')] } },
  build: {
    rollupOptions: {
      input: { index: resolve(root, 'index.html'), privacy: resolve(root, 'privacy.html'), download: resolve(root, 'download.html') },
    },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'jsdom' },
};

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && !loadEnv(mode, root, 'VITE_').VITE_API_URL) {
    console.warn('\nVITE_API_URL is not set: this build will call http://localhost:8787. Set it to the public API address for production.\n');
  }
  return config;
});
