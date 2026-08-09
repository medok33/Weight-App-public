import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/test-support/vitest-disposable-db-setup.ts'],
    // Persistence specs are sequential by package script; keep defaults otherwise.
    passWithNoTests: true,
  },
});
