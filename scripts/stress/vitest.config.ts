import { defineConfig } from 'vitest/config';

// The stress tests: `npx vitest run --config scripts/stress/vitest.config.ts` (after make-docs.py and make-audio.mjs).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/stress/**/*.stress.ts'],
    testTimeout: 30 * 60 * 1000,
    // One at a time: they measure time and memory.
    fileParallelism: false,
  },
});
