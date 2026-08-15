import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  // Boot decodes ~26 MB of card PNGs and runs 104 canvas extraction passes on the
  // main thread, so every spec starts with a slow, unavoidable warm-up.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // The real deployment artifact: one Node process serving the built client and
    // the WebSocket on the same origin. Using `vite preview` here would test a
    // server that does not exist in production and has no socket at all, so the
    // online tests could not run.
    command: `npm run build && npm run build:server && echo '{"type":"commonjs"}' > build/package.json && PORT=${PORT} node build/server/main.js`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
