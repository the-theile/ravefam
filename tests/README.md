# RaveFam test harness

Offline Playwright smoke tests for the single-file app (`app.html`). The Supabase
CDN script and client are **stubbed** (see `tests/helpers.js`), so tests run with
no backend, no auth, and no external network.

## What's covered

- **App boot** — `app.html` loads to the auth screen with **zero uncaught JS
  errors**, and the core tab/render functions are exposed on `window`. This is a
  broad regression net: any new init-time crash anywhere in the script fails here.
- **Double-tap to refresh** — two fast taps on the same tab fire exactly one
  server re-fetch; slow taps, different-tab taps, and the Coming Soon tab do not.

## Running

```bash
npm install
npm test
```

### Browser binary

`npm test` needs a Chromium build matching `@playwright/test@1.56.0`
(Playwright chromium build **1194**).

- If `npx playwright install chromium` is allowed by your network, just run it.
- In sandboxes where Playwright's download CDN is blocked but a browser is
  pre-provisioned, point Playwright at it:

  ```bash
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm test
  ```

  `playwright.config.js` already defaults `PLAYWRIGHT_BROWSERS_PATH` to
  `/opt/pw-browsers` when it isn't set.

## Adding tests

`tests/helpers.js` exports `installSupabaseStub(page, { session })`:

- `session: null` → app shows the auth screen (default).
- `session: { user: { id, ... } }` → app boots the main shell; all queries
  resolve to empty data, so you can drive booted-app flows.

Call it **before** `page.goto('/app.html')`.
