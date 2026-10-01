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

  test('a long list scrolls inside the drawer', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { for (let i = 0; i < 40; i++) addNotification(`Ping #${i}`); openNotifDrawer(); });
    const list = page.locator('#notif-list');
    await expect(list).toContainText('Ping #39');
    // overflow:hidden still lets script set scrollTop, so scroll the way a
    // person does (wheel over the list) and check the list actually moved.
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await list.evaluate(el => getComputedStyle(el).overflowY)).not.toBe('hidden');
    // The drawer slides in; wheel only once it has settled, and retry the
    // gesture so a slow machine can't land it beside the list.
    await expect.poll(() => page.locator('.notif-drawer').evaluate(el => getComputedStyle(el).transform))
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await expect(async () => {
      const box = await list.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 600);
      expect(await list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
  });

  test('clearing notifications empties the list', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { addNotification('one'); addNotification('two'); openNotifDrawer(); clearAllNotifs(); });
    await expect(page.locator('#notif-list')).not.toContainText('one');
    await expect(page.locator('#notif-list')).toContainText('All quiet on the dancefloor');
  });
});
