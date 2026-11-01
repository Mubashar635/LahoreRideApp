import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    // Integration test files share one database; run files one at a time.
    // (Concurrency is still exercised *within* tests, against real Postgres.)
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
