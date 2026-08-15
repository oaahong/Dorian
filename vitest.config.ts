import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The simulation layer must run headless in Node. If a test here ever needs
    // jsdom, that is a signal that Phaser/DOM leaked into src/sim — fix the leak,
    // not the config.
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.test.ts',
      'server/**/__tests__/**/*.test.ts',
    ],
    // Playwright owns e2e/; vitest must never try to run those specs.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html'],
      // Coverage is only meaningful where logic is pure. Phaser scenes and views
      // are covered by smoke/e2e instead — measuring line coverage on rendering
      // code produces a number that does not mean anything.
      include: ['src/sim/**', 'src/net/**', 'server/**'],
      exclude: ['**/__tests__/**', '**/__fixtures__/**'],
      thresholds: {
        'src/sim/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'server/**': { statements: 85, branches: 80, functions: 85, lines: 85 },
      },
    },
  },
});
