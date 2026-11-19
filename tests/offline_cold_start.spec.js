// Offline cold start: the last good load is kept on the device, so opening the
// app with no signal shows the crew instead of an empty app or a login screen.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, installSupabaseStub, makeSession, seedData, TEST_UID } = require('./helpers');

// A reload must reach the stub, not a service-worker copy of supabase-js.
test.use({ serviceWorkers: 'block' });

const AUTH_KEY = 'sb-tvpgopciioqbqmjjjigh-auth-token';
const snapshot = page => page.evaluate(() => JSON.parse(localStorage.getItem('rf_offline_snapshot_v1') || 'null'));

test('a good load saves a snapshot for this account', async ({ page }) => {
  await bootAuthedApp(page);
  const snap = await snapshot(page);
  expect(snap && snap.uid).toBe(TEST_UID);
  expect(snap.crews.map(c => c.name)).toContain('Bass Syndicate');
});

test('when the first load fails, the app shows the last synced crews', async ({ page }) => {
  await bootAuthedApp(page);
  await page.addInitScript(() => { window.__stubOffline = true; });
  await page.reload();
  await page.locator('#main-app').waitFor({ state: 'visible' });
  await expect(page.locator('#toast')).toContainText('No signal');
  expect(await page.evaluate(() => crews.map(c => c.name))).toContain('Bass Syndicate');
  // Crews is the page the app opens on.
  await expect(page.locator('#page-crews')).toContainText('Bass Syndicate');
});

test('saved crews stay flagged by a banner until a live load replaces them', async ({ page }) => {
  await bootAuthedApp(page);
  await page.addInitScript(() => { window.__stubOffline = true; });
  await page.reload();
  const banner = page.locator('#offline-banner');
  // Shown even though the browser counts itself as online, and not dismissable.
  await expect(banner).toHaveClass(/visible/);
  await expect(banner).toContainText('Showing saved crews from');
  await expect(page.locator('#offline-banner-close')).toBeHidden();

  await page.evaluate(() => { window.__stubOffline = false; window.dispatchEvent(new Event('online')); });
  await expect(page.locator('#toast')).toContainText('Back online', { timeout: 15000 });
  await expect(banner).not.toHaveClass(/visible/);
  await expect(page.locator('#offline-banner-text')).toHaveText(/No connection/);
});

test('offline with an expired login, it opens from the snapshot instead of the login screen', async ({ page }) => {
  await bootAuthedApp(page);
  // Next start: supabase-js reports no session (it could not refresh) but the
  // session is still stored, and every request fails.
  await installSupabaseStub(page, { session: null, data: seedData() });
  const stored = makeSession();
  await page.addInitScript(([key, val]) => {
    localStorage.setItem(key, val);
    window.__stubOffline = true;
  }, [AUTH_KEY, JSON.stringify(stored)]);
  await page.reload();
  await page.locator('#main-app').waitFor({ state: 'visible' });
  await expect(page.locator('#auth-screen')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => crews.map(c => c.name))).toContain('Bass Syndicate');
});

test('with no snapshot, an expired login still shows the login screen', async ({ page }) => {
  await installSupabaseStub(page, { session: null, data: seedData() });
  await page.addInitScript(([key, val]) => {
    localStorage.setItem(key, val);
    window.__stubOffline = true;
  }, [AUTH_KEY, JSON.stringify(makeSession())]);
  await page.goto('/app.html');
  await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);
});

test('signing out removes the snapshot', async ({ page }) => {
  await bootAuthedApp(page);
  expect(await snapshot(page)).not.toBeNull();
  await page.evaluate(() => doLogout());
  await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);
  expect(await snapshot(page)).toBeNull();
});
