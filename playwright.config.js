// Playwright smoke-test harness for the RaveFam single-page app.
//
// The app (app.html) is a static file that talks to Supabase. To keep tests
// hermetic and runnable with no network/backend, the tests stub the Supabase
// CDN script and client (see tests/helpers.js). They are served over a tiny
// local static server so that service-worker registration and relative paths
// behave like production.
const { defineConfig, devices } = require('@playwright/test');
const fs = require('fs');

// Some sandboxes ship browsers in a shared, pre-installed location instead of
// the default per-project cache. If the caller hasn't set PLAYWRIGHT_BROWSERS_PATH
// and that shared path exists, use it. On CI / normal dev it won't exist, so we
// fall through to Playwright's standard cache (populated by `playwright install`).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) {
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
