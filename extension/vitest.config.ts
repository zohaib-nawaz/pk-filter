import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://learn.example.org/watch/1' } },
  },
});
