import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': resolve(root, '../extension/src/core') } },
  server: { port: 3180, strictPort: true, fs: { allow: [resolve(root, '..')] } },
  build: {
    rollupOptions: {
      input: { index: resolve(root, 'index.html'), privacy: resolve(root, 'privacy.html') },
    },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'jsdom' },
});
