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
