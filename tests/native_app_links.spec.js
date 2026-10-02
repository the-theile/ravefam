const { test, expect } = require('@playwright/test');
const { installSupabaseStub, seedData } = require('./helpers');

// In the Capacitor iOS shell, a Universal Link (crew invite, claim, magic link)
// opens the app at its start URL and hands the real link to the App plugin —
// via getLaunchUrl() on a cold start or 'appUrlOpen' while running. The page
// must navigate the webview there, once, and only for its own host.

async function installCapacitorStub(page, launchPath) {
  await page.addInitScript((launchPath) => {
    const listeners = {};
    window.__fireAppUrlOpen = (url) => listeners.appUrlOpen && listeners.appUrlOpen({ url });
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { App: {
        addListener: (name, fn) => { listeners[name] = fn; },
        getLaunchUrl: async () => (launchPath ? { url: location.origin + launchPath } : undefined),
      } },
    };
  }, launchPath);
}

test.describe('native app Universal Links', () => {
  test('a cold-start invite link opens the invite, without a reload loop', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: seedData() });
    await installCapacitorStub(page, '/app.html?join=inv-c1');
    await page.goto('/app.html');

    await expect(page.locator('#claim-intercept')).toHaveClass(/open/);
    await expect(page.locator('#intercept-title')).toContainText('Bass Syndicate');

    // getLaunchUrl() keeps returning the same link for the app's lifetime; once
    // the URL is cleaned up, a reload must not bounce back to it.
    await page.evaluate(() => history.replaceState(null, '', '/app.html'));
    await page.reload();
    await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).search).toBe('');
  });

  test('appUrlOpen navigates to same-host links and ignores other hosts', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: seedData() });
    await installCapacitorStub(page, null);
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);

    await page.evaluate(() => window.__fireAppUrlOpen('https://example.com/app?join=inv-c1'));
    await page.waitForTimeout(500);
    expect(new URL(page.url()).search).toBe('');

    await page.evaluate(() => window.__fireAppUrlOpen(location.origin + '/app.html?join=inv-c1'));
    await expect(page.locator('#claim-intercept')).toHaveClass(/open/);
  });
});

// Lineup Explorer pages share the origin with /app. In the iOS app a new
// window opens Safari (separate storage: no login or picks), so explorer links
// load in the app's own webview there, and the explorer adds a way back.
test.describe('Lineup Explorer in the native app', () => {
  const EXPLORER = '/lineup-explorer/bass-canyon-2026.html';
  const addExplorerLink = (page) => page.evaluate((href) => {
    document.body.insertAdjacentHTML('afterbegin', `<a id="le-test" class="lineup-explorer-btn" style="position:fixed;top:0;left:0;z-index:99999" href="${href}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🔭 Lineup Explorer</a>`);
  }, EXPLORER);

  test('explorer buttons stay in the app webview', async ({ page, context }) => {
    await installSupabaseStub(page, { session: null, data: seedData() });
    await installCapacitorStub(page, null);
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);

    let popups = 0;
    context.on('page', () => { popups++; });
    await addExplorerLink(page);
    await page.locator('#le-test').click();
    await expect(page).toHaveURL(new RegExp(EXPLORER));
    await page.goBack();
    await page.evaluate((url) => openLineupExplorer(url), EXPLORER);
    await expect(page).toHaveURL(new RegExp(EXPLORER));
    expect(popups).toBe(0);
  });

  test('on the web, explorer buttons still open a new tab', async ({ page, context }) => {
    await installSupabaseStub(page, { session: null, data: seedData() });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);
    await addExplorerLink(page);
    const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('#le-test').click()]);
    expect(popup.url()).toContain(EXPLORER);
    expect(page.url()).toContain('/app.html');
  });

  test('explorer page shows a back pill into /app and drops 📲 Save', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: seedData() });
    await installCapacitorStub(page, null);
    await page.goto(EXPLORER);
    const back = page.locator('.brandbar .lp-native-back');
    await expect(back).toHaveText('‹ RaveFAM');
    await expect(page.locator('.a2hs-btn')).toHaveCount(0);
    await expect(page.locator('.brandbar .brand')).toHaveAttribute('href', '/app');
    expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('viewport-fit=cover');
    await back.click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('explorer page is unchanged on the web', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: seedData() });
    await page.goto(EXPLORER);
    await expect(page.locator('.a2hs-btn')).toHaveCount(1);
    await expect(page.locator('.lp-native-back')).toHaveCount(0);
    await expect(page.locator('.brandbar .brand')).toHaveAttribute('href', 'https://myravefam.com/');
  });
});
