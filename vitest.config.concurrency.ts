import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    env: {
      NODE_ENV: 'test',
    },
    globals: true,
    root: './',
    include: ['test/concurrency/**/*.concurrency-spec.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
