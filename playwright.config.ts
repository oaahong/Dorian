import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * Point the suite at an already-deployed instance, e.g.
 * `E2E_BASE_URL=https://meme-cat-fighter.onrender.com npm run test:e2e`.
 *
 * Worth having as a first-class option: TLS, the wss:// upgrade and NAT
 * traversal across a real network are exactly the things a loopback server
 * cannot exercise, and they are where a deployment actually breaks.
 */
const REMOTE_BASE_URL = process.env.E2E_BASE_URL;

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
    baseURL: REMOTE_BASE_URL ?? `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Nothing to start when testing a deployed instance.
  webServer: REMOTE_BASE_URL ? undefined : {
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
