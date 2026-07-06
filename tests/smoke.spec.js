const { test, expect } = require('@playwright/test');
const { installSupabaseStub, collectPageErrors } = require('./helpers');

test.describe('app boot', () => {
  test('loads to the auth screen with no uncaught errors', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, { session: null });

    await page.goto('/app.html');

    // The auth screen should become visible once onAuthStateChange fires null.
    const authScreen = page.locator('#auth-screen');
    await expect(authScreen).toBeVisible();
    await expect(page.locator('#auth-login-form')).toBeVisible();

    // No script crashed during init.
    expect(errors, `uncaught page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('exposes the core tab + render functions on window', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    const present = await page.evaluate(() =>
      ['switchTab', 'refreshTab', 'renderCrews', 'renderEvents', 'renderSquad',
       'loadStatsPage', 'loadAllData', 'showToast']
        .every(fn => typeof window[fn] === 'function'));
    expect(present).toBe(true);
  });
});

test.describe('double-tap tab to refresh', () => {
  // Drives switchTab directly with stubbed data/render functions so we can
  // assert the refresh behaviour without booting the full backend flow.
  async function setup(page) {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    await page.evaluate(() => {
      window.__refreshCount = 0;
      // Spy on the server re-fetch; keep it fast and side-effect free.
      window.loadAllData = async () => { window.__refreshCount++; };
      // Neutralise heavy re-renders during the test.
      window.renderSquad = () => {};
      window.renderCrews = () => {};
      window.renderEvents = () => {};
      window.loadStatsPage = () => {};
    });
  }

  test('two fast taps on the same tab trigger one refresh', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { switchTab('crews'); switchTab('crews'); });
    // refreshTab awaits loadAllData; give the microtask a tick.
    await expect.poll(() => page.evaluate(() => window.__refreshCount)).toBe(1);
  });

  test('two slow taps (>400ms apart) do NOT refresh', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => switchTab('crews'));
    await page.waitForTimeout(450);
    await page.evaluate(() => switchTab('crews'));
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__refreshCount)).toBe(0);
  });

  test('a fast tap of a different tab does NOT refresh', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { switchTab('crews'); switchTab('events'); });
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__refreshCount)).toBe(0);
  });

  test('the Coming Soon (checklist) tab never refreshes on double-tap', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { switchTab('checklist'); switchTab('checklist'); });
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__refreshCount)).toBe(0);
  });

  test('still does not refresh on double-tap after Vendor Village is unlocked', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      vendorVillageTap(); vendorVillageTap(); vendorVillageTap(); vendorVillageTap();
    });
    await page.evaluate(() => { switchTab('checklist'); switchTab('checklist'); });
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__refreshCount)).toBe(0);
  });
});
