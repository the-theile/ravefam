const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// iOS share sheet → RaveFAM: the Share Extension saves the link, the local
// ShareInbox plugin hands it to the page, and checkShareInbox() asks which
// Huddle it goes to, then opens that room with it waiting in the composer.

async function installCapacitorStub(page, inbox) {
  await page.addInitScript((inbox) => {
    const native = window.__native = { calls: [], inbox };
    const rec = (name, arg) => native.calls.push({ name, arg });
    const addListener = () => Promise.resolve({ remove() {} });
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { addListener, getLaunchUrl: async () => undefined },
        PushNotifications: { addListener, checkPermissions: async () => ({ receive: 'denied' }) },
        ShareInbox: {
          read: async () => { rec('read'); return native.inbox || {}; },
          clear: async () => { rec('clear'); native.inbox = null; },
        },
      },
    };
  }, inbox);
}

const SESSION_OVER = { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } };
const ROOMS = [{ id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' }];

function seed() {
  const data = seedData();
  data.huddle_rooms = ROOMS.slice();
  data.huddle_messages = [];
  return data;
}

test.describe('native share inbox', () => {
  // Opening the app (shared while it was closed, or back from the background)
  // asks which Huddle, then opens that room with the share in the composer.
  // bootAuthedApp closes any overlay boot opened, so the share lands after it.
  test('a shared link opens the Huddle picker, then the room with it in the composer', async ({ page }) => {
    const url = 'https://www.instagram.com/reel/abc123/';
    await installCapacitorStub(page, null);
    await bootAuthedApp(page, { data: seed(), sessionOver: SESSION_OVER });
    await page.evaluate((url) => {
      window.__native.inbox = { url, text: 'this set 🔥', at: Date.now() };
      document.dispatchEvent(new Event('visibilitychange'));
    }, url);

    await expect(page.locator('#share-inbox-overlay')).toHaveClass(/open/);
    await expect(page.locator('#share-inbox-modal')).toContainText('instagram.com/reel/abc123');
    // Cleared as soon as it's shown, so it never pops up twice.
    expect(await page.evaluate(() => window.__native.inbox)).toBeNull();

    await page.locator('#share-inbox-modal .crew-pick-item', { hasText: 'Bass Syndicate' }).first().click();
    await expect(page.locator('#share-inbox-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
    await expect(page.locator('#huddle-text-input')).toHaveValue(`this set 🔥\n${url}`);

    await page.locator('#huddle-text-input').press('Enter');
    await expect.poll(() => page.evaluate(() => (window.__store.huddle_messages || []).map(m => m.body))).toContain(`this set 🔥\n${url}`);
  });

  test('a share saved while the app was closed is picked up on boot', async ({ page }) => {
    await installCapacitorStub(page, { url: 'https://www.facebook.com/share/p/xyz/', at: Date.now() });
    await bootAuthedApp(page, { data: seed(), sessionOver: SESSION_OVER });
    await expect.poll(() => page.evaluate(() => window.__native.calls.map(c => c.name))).toEqual(['read', 'clear']);
  });

  test('a share older than 3 days is dropped without asking', async ({ page }) => {
    await installCapacitorStub(page, { url: 'https://example.com/old', at: Date.now() - 4 * 24 * 3600 * 1000 });
    await bootAuthedApp(page, { data: seed(), sessionOver: SESSION_OVER });
    await expect.poll(() => page.evaluate(() => window.__native.inbox)).toBeNull();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    await expect(page.locator('#share-inbox-overlay')).not.toHaveClass(/open/);
  });

  test('coming back to the app picks up a new share; Not now dismisses it', async ({ page }) => {
    await installCapacitorStub(page, null);
    await bootAuthedApp(page, { data: seed(), sessionOver: SESSION_OVER });
    await expect(page.locator('#share-inbox-overlay')).not.toHaveClass(/open/);

    await page.evaluate(() => {
      window.__native.inbox = { url: 'https://www.tiktok.com/@dj/video/1', at: Date.now() };
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('#share-inbox-overlay')).toHaveClass(/open/);
    await page.locator('#share-inbox-modal button', { hasText: 'Not now' }).click();
    await expect(page.locator('#share-inbox-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#huddle-screen.open')).toHaveCount(0);
  });

  test('older app builds without the plugin are unaffected', async ({ page }) => {
    await page.addInitScript(() => {
      const addListener = () => Promise.resolve({ remove() {} });
      window.Capacitor = { isNativePlatform: () => true, Plugins: { App: { addListener, getLaunchUrl: async () => undefined } } };
    });
    await bootAuthedApp(page, { data: seed(), sessionOver: SESSION_OVER });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    await expect(page.locator('#share-inbox-overlay')).not.toHaveClass(/open/);
  });
});
