import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': `${repo}shared`,
      '@': `${repo}web/src`,
    },
  },
  test: {
    globals: true,
    include: [
      'shared/**/*.test.ts',
      'server/**/*.test.ts',
      'web/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    environment: 'node',
  },
});
