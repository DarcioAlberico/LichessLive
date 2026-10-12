import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/contract/**/*.test.ts',
      'tests/integration/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
