// Playwright smoke-test harness for the RaveFam single-page app.
//
// The app (app.html) is a static file that talks to Supabase. To keep tests
// hermetic and runnable with no network/backend, the tests stub the Supabase
// CDN script and client (see tests/helpers.js). They are served over a tiny
// local static server so that service-worker registration and relative paths
// behave like production.
const { defineConfig, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Some sandboxes ship browsers in a shared, pre-installed location instead of
// the default per-project cache. If the caller hasn't set PLAYWRIGHT_BROWSERS_PATH
// and that shared path exists, use it. On CI / normal dev it won't exist, so we
// fall through to Playwright's standard cache (populated by `playwright install`).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}

const PORT = 4173;

// ─── Mobile coverage ────────────────────────────────────────────────────────
// Most specs are viewport-agnostic and re-running all ~340 of them at phone
// width would double the suite's runtime for no signal. These are the ones
// where layout, touch, or the signed-out entry points actually differ — the
// screens a new user meets on a phone, which is how most people arrive.
const MOBILE_SPECS = [
  '**/mobile_layout.spec.js',            // phone-only: safe areas, no h-scroll, tap targets
  '**/ios_input_zoom.spec.js',           // sets its own iPhone viewport; pinned here too
  '**/smoke.spec.js',                    // boot with zero uncaught errors
  '**/auth.spec.js',                     // login/signup is mostly a phone screen
  '**/onboarding.spec.js',
  '**/claim_preview_status.spec.js',     // the claim flow is overwhelmingly mobile
  '**/invite_prompt_crew_status.spec.js',
  '**/escape_closes_overlays.spec.js',
  '**/focus_containment.spec.js',
];

// Real Mobile Safari needs the WebKit build. It is absent in some sandboxes and
// the download CDN may be blocked there, so this project is added only when the
// binary is actually present — `npx playwright install webkit` enables it. On a
// machine without it the suite still runs; it just skips the WebKit pass rather
// than failing to start.
function webkitAvailable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    if (root && root !== '0') {
      return fs.readdirSync(root).some(d => d.startsWith('webkit'));
    }
    // Default per-user cache location.
    const home = process.env.HOME || '';
    const cache = path.join(home, '.cache', 'ms-playwright');
    return fs.existsSync(cache) && fs.readdirSync(cache).some(d => d.startsWith('webkit'));
  } catch {
    return false;
  }
}

const projects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
    // mobile_layout asserts phone-only rules; it has nothing to say at 1280px.
    testIgnore: ['**/mobile_layout.spec.js'],
  },
  {
    // iPhone 13 metrics (viewport, DPR, touch, mobile UA) on the Chromium that
    // is always available. Catches layout/touch regressions everywhere, but it
    // is NOT WebKit — see mobile-safari below for the real engine.
    name: 'mobile-chromium',
    use: {
      ...devices['iPhone 13'],
      browserName: 'chromium',
      // devices['iPhone 13'] carries defaultBrowserType 'webkit'; the explicit
      // browserName above overrides it. isMobile/hasTouch still drive the
      // (hover:none) and (pointer:coarse) queries the app's touch rules use.
    },
    testMatch: MOBILE_SPECS,
  },
];

if (webkitAvailable()) {
  projects.push({
    name: 'mobile-safari',
    use: { ...devices['iPhone 13'] }, // real WebKit
    testMatch: MOBILE_SPECS,
  });
}

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
  projects,
  webServer: {
    command: `node tests/static-server.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/app.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
