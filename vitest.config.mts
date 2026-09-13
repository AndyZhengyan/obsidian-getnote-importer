import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(import.meta.dirname, 'tests/mocks/obsidian.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.spec.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
