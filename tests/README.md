# RaveFam test harness

Offline Playwright smoke tests for the single-file app (`app.html`). The Supabase
CDN script and client are **stubbed** (see `tests/helpers.js`), so tests run with
no backend, no auth, and no external network.

## What's covered

`tests/smoke.spec.js` (signed-out):
- **App boot** — `app.html` loads to the auth screen with **zero uncaught JS
  errors**, and the core tab/render functions are exposed on `window`. This is a
  broad regression net: any new init-time crash anywhere in the script fails here.
- **Double-tap to refresh** — two fast taps on the same tab fire exactly one
  server re-fetch; slow taps, different-tab taps, and the Coming Soon tab do not.

`tests/authed.spec.js` (signed-in, with seeded mock data):
- **Boot** into the main app on the Crews tab, no uncaught errors.
- **Tab content** — Crews / Raves / Ravers render their seeded rows; Stats loads.
- **Crew search** filters the grid.
- **Navigation** — tapping a crew card opens its detail view.
- **Double-tap refresh** while authenticated shows the refresh toast.
- **eruda gating** — the debug console inits only for the maintainer email (or
  the `rf_eruda=1` localStorage escape hatch), not for other accounts.

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

`tests/helpers.js` exports:

- `installSupabaseStub(page, { session, data, eruda })` — low-level stub. Call it
  **before** `page.goto('/app.html')`. `session: null` → auth screen;
  `data` → per-table mock rows; `eruda` → JS body for the eruda CDN.
- `makeSession({ email })` — a fake authenticated session (sets
  `user_metadata.onboarded` so the wizard is skipped).
- `seedData()` — a realistic dataset (festivals, ravers incl. "you", a crew).
  `from(table)` resolves to `seedData()[table]`, so add/extend rows there to
  cover more flows.
- `bootAuthedApp(page, { data, sessionOver })` — installs the stub with a session
  + seed data, navigates, waits for the main shell, and dismisses the welcome
  popup. Returns the collected page-error array for assertions.

To beta-test a new flow: extend `seedData()` with the rows it needs, then add a
test that calls `bootAuthedApp(page)` and drives the UI.
