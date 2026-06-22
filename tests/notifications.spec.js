const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

test.describe('notifications', () => {
  test('adding a notification sets the unread badge and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => addNotification('Test ping 🔔'));

    await expect(page.locator('#notif-badge')).toHaveClass(/has-unread/);
    // persisted to the (fake) DB
    const stored = await page.evaluate(() =>
      (window.__store.notifications || []).some(n => n.message === 'Test ping 🔔'));
    expect(stored).toBe(true);
  });

  test('opening the drawer renders items and clears the unread badge', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { addNotification('Drawer item ✨'); openNotifDrawer(); });

    await expect(page.locator('#notif-drawer-overlay')).toHaveClass(/open/);
    await expect(page.locator('#notif-list')).toContainText('Drawer item ✨');
    await expect(page.locator('#notif-badge')).not.toHaveClass(/has-unread/);
  });

  test('clearing notifications empties the list', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { addNotification('one'); addNotification('two'); openNotifDrawer(); clearAllNotifs(); });
    await expect(page.locator('#notif-list')).not.toContainText('one');
    await expect(page.locator('#notif-list')).toContainText('All quiet on the dancefloor');
  });
});
