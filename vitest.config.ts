import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    maxWorkers: 2,
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
    },
  },
});
