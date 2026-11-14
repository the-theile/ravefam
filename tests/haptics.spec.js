const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

// Haptics in the Capacitor iOS app (nativeHaptics / hapticImpact / hapticSuccess /
// hapticError in app.html). The bridge is stubbed: window.Capacitor with a
// Haptics plugin that records each call. Settings → Haptics turns them off.
async function installHapticsStub(page, { withPlugin = true } = {}) {
  await page.addInitScript(({ withPlugin }) => {
    const native = window.__native = { calls: [] };
    const addListener = () => Promise.resolve({ remove() {} });
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { addListener, getLaunchUrl: async () => undefined },
        PushNotifications: { addListener, checkPermissions: async () => ({ receive: 'prompt' }) },
        ...(withPlugin ? { Haptics: {
          impact: async ({ style }) => native.calls.push('impact:' + style),
          notification: async ({ type }) => native.calls.push('notification:' + type),
        } } : {}),
      },
    };
  }, { withPlugin });
}

const hapticCalls = (page) => page.evaluate(() => window.__native.calls.slice());

test.describe('haptics', () => {
  test('errors buzz, and the Settings switch turns haptics off on this device', async ({ page }) => {
    await installHapticsStub(page);
    await bootAuthedApp(page);
    await page.evaluate(() => { window.__native.calls.length = 0; toastError('Could not save. Try again'); });
    await expect.poll(() => hapticCalls(page)).toContain('notification:ERROR');

    await page.evaluate(() => openPrivacySettingsModal(squad.find(r => r.isYou).id));
    const toggle = page.locator('#haptics-settings-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveClass(/(^|\s)on(\s|$)/);
    await toggle.click();
    await expect(toggle).not.toHaveClass(/(^|\s)on(\s|$)/);

    await page.evaluate(() => { window.__native.calls.length = 0; toastError('Could not save. Try again'); hapticSuccess(); });
    await page.waitForTimeout(100);
    expect(await hapticCalls(page)).toEqual([]);
  });

  test('builds without the plugin hide the Settings switch', async ({ page }) => {
    await installHapticsStub(page, { withPlugin: false });
    await bootAuthedApp(page);
    await page.evaluate(() => openPrivacySettingsModal(squad.find(r => r.isYou).id));
    await expect(page.locator('#haptics-settings-row')).toBeHidden();
  });

  test('bottom-nav taps tick, code-driven tab switches do not', async ({ page }) => {
    await installHapticsStub(page);
    await bootAuthedApp(page);
    await page.evaluate(() => { window.__native.calls.length = 0; switchTab('events', document.querySelector('.nav-tab.c-raves')); });
    await page.waitForTimeout(100);
    expect(await hapticCalls(page)).toEqual([]);
    await page.locator('nav .nav-tab.c-ravers').click();
    await expect.poll(() => hapticCalls(page)).toContain('impact:LIGHT');
  });
});
