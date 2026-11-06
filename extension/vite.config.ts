import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { brandHtml } from '../brand/brand.mjs';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  base: '/',
  publicDir: false,
  plugins: [react(), tailwindcss(), brandHtml()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome110',
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'src/popup/index.html'),
        options: resolve(import.meta.dirname, 'src/options/index.html'),
        site: resolve(import.meta.dirname, 'src/site/index.html'),
      },
    },
  },
});
