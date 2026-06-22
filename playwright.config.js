// Playwright smoke-test harness for the RaveFam single-page app.
//
// The app (app.html) is a static file that talks to Supabase. To keep tests
// hermetic and runnable with no network/backend, the tests stub the Supabase
// CDN script and client (see tests/helpers.js). They are served over a tiny
// local static server so that service-worker registration and relative paths
// behave like production.
const { defineConfig, devices } = require('@playwright/test');

// In this environment the browser binaries live in a shared, pre-installed
// location rather than the default per-project cache. Respect an explicit
// PLAYWRIGHT_BROWSERS_PATH if set; otherwise fall back to the shared path.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}

const PORT = 4173;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node tests/static-server.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/app.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
