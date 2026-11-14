const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

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

  test('opening the drawer keeps rows unread until they are tapped', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { addNotification('Drawer item ✨'); openNotifDrawer(); });

    await expect(page.locator('#notif-drawer-overlay')).toHaveClass(/open/);
    await expect(page.locator('#notif-list')).toContainText('Drawer item ✨');
    const row = page.locator('#notif-list .notif-row', { hasText: 'Drawer item ✨' });
    await expect(row).toHaveClass(/unread/);
    await expect(page.locator('#notif-badge')).toHaveClass(/has-unread/);
    await expect(page.locator('#notif-badge')).toHaveText('1');

    await row.locator('.notif-text').click();
    await expect(row).toHaveClass(/notif-read/);
    await expect(row.locator('.notif-dot')).toHaveCount(0);
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

  test('Mark all read clears every dot and persists', async ({ page }) => {
    const data = seedData();
    data.notifications = ['one', 'two'].map((message, i) => ({
      id: [UUID_A, UUID_B][i], user_id: TEST_UID, crew_id: null, read: false,
      created_at: new Date().toISOString(), message, type: null, data: null,
    }));
    await bootAuthedApp(page, { data });
    await page.evaluate(() => openNotifDrawer());
    await expect(page.locator('#notif-list .notif-row.unread')).toHaveCount(2);
    await expect(page.locator('#notif-drawer-sub')).toHaveText('2 unread');

    await page.locator('#notif-mark-read-btn').click();
    await expect(page.locator('#notif-list .notif-row.unread')).toHaveCount(0);
    await expect(page.locator('#notif-drawer-sub')).toHaveText('All caught up');
    await expect(page.locator('#notif-mark-read-btn')).toBeDisabled();
    await expect(page.locator('#notif-badge')).not.toHaveClass(/has-unread/);
    await expect.poll(() => page.evaluate(() =>
      (window.__store.notifications || []).filter(n => !n.read).length)).toBe(0);
  });

  test('hiding a row can be undone, and only deletes after the undo window', async ({ page }) => {
    const data = seedData();
    data.notifications = [
      { id: UUID_A, user_id: TEST_UID, crew_id: null, read: true, created_at: new Date().toISOString(), message: 'keep me', type: null, data: null },
      { id: UUID_B, user_id: TEST_UID, crew_id: null, read: true, created_at: new Date().toISOString(), message: 'hide me', type: null, data: null },
    ];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => openNotifDrawer());

    const hideBtn = () => page.locator('#notif-list .notif-row', { hasText: 'hide me' }).locator('.notif-hide-btn');
    await hideBtn().click();
    await expect(page.locator('#notif-list')).not.toContainText('hide me');
    await expect(page.locator('#notif-undo')).toBeVisible();
    // Still in the DB during the undo window.
    expect(await page.evaluate(id => window.__store.notifications.some(n => n.id === id), UUID_B)).toBe(true);

    await page.locator('#notif-undo button').click();
    await expect(page.locator('#notif-list')).toContainText('hide me');
    await expect(page.locator('#notif-undo')).toBeHidden();

    // Hide again and close the drawer — closing commits the delete.
    await hideBtn().click();
    await page.evaluate(() => closeNotifDrawer());
    await expect.poll(() => page.evaluate(id => window.__store.notifications.some(n => n.id === id), UUID_B)).toBe(false);
    expect(await page.evaluate(id => window.__store.notifications.some(n => n.id === id), UUID_A)).toBe(true);
  });

  test('rows group under Today / This week / Earlier with compact times', async ({ page }) => {
    const data = seedData();
    const ago = days => new Date(Date.now() - days * 86400000).toISOString();
    data.notifications = [
      { id: 'n1', user_id: TEST_UID, read: true, created_at: new Date(Date.now() - 5 * 60000).toISOString(), message: 'fresh', type: null, data: null },
      { id: 'n2', user_id: TEST_UID, read: true, created_at: ago(3), message: 'midweek', type: null, data: null },
      { id: 'n3', user_id: TEST_UID, read: true, created_at: ago(40), message: 'ancient', type: null, data: null },
    ];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => openNotifDrawer());

    const labels = page.locator('#notif-list .notif-group-label');
    await expect(labels).toHaveText(['Today', 'This week', 'Earlier']);
    await expect(page.locator('.notif-row', { hasText: 'fresh' }).locator('.notif-time')).toHaveText('5m');
    await expect(page.locator('.notif-row', { hasText: 'ancient' }).locator('.notif-time')).not.toContainText('ago');
  });

  test('tabs filter by category and show their own unread counts', async ({ page }) => {
    const data = seedData();
    const now = new Date().toISOString();
    data.notifications = [
      { id: 'p1', user_id: TEST_UID, read: false, created_at: now, message: '☮️ +10 Peace points', type: 'points_earned', data: { track: 'peace', amount: 10 } },
      { id: 'r1', user_id: TEST_UID, read: false, created_at: now, message: '🗓️ Tomorrowland is coming up', type: null, data: { links: [{ t: 'Tomorrowland', k: 'rave', id: 'f1' }] } },
    ];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => openNotifDrawer());

    const tab = name => page.locator('#notif-tabs .notif-tab', { hasText: name });
    await expect(tab('All')).toContainText('2');
    await expect(tab('PLUR')).toContainText('1');
    await tab('Raves').click();
    await expect(page.locator('#notif-list')).toContainText('Tomorrowland is coming up');
    await expect(page.locator('#notif-list')).not.toContainText('Peace points');
    await tab('Mentions').click();
    await expect(page.locator('#notif-list')).toContainText('Nothing in Mentions yet');
  });

  test('a decision stays pinned under Needs you until an action is used', async ({ page }) => {
    const data = seedData();
    data.notifications = [{
      id: UUID_A, user_id: TEST_UID, crew_id: null, read: false,
      created_at: new Date().toISOString(),
      message: "🎪 Kai added you to Tomorrowland! You're on the lineup.",
      type: 'festival_add',
      data: { festival_id: 'f1', raver_id: 'r-you', festival_name: 'Tomorrowland' },
    }];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => { openNotifDrawer(); markAllNotifsRead(); });

    // Mark all read clears the dot but keeps it pinned, with no hide button.
    const pinned = page.locator('#notif-list .notif-pinned');
    await expect(page.locator('#notif-list .notif-group-label').first()).toHaveText('Needs you · 1');
    await expect(pinned).toHaveCount(1);
    await expect(pinned.locator('.notif-hide-btn')).toHaveCount(0);

    await pinned.locator('.notif-action-btn', { hasText: 'All good' }).click();
    await expect(page.locator('#notif-list .notif-pinned')).toHaveCount(0);
    await expect(page.locator('#notif-list .notif-group-label').first()).toHaveText('Today');
    await expect.poll(() => page.evaluate(id =>
      window.__store.notifications.find(n => n.id === id)?.data?.resolved, UUID_A)).toBe(true);
  });

  test('the same update from different crewmates folds into one row', async ({ page }) => {
    const data = seedData();
    data.ravers.push({ ...data.ravers[2], id: 'r-lex', name: 'Lexi', handle: 'lexi', claimed_by: 'lex-uid', qr_token: 'qr-lex' });
    data.crew_members.push({ crew_id: 'c1', raver_id: 'r-lex', added_at: '2024-01-01T00:00:00Z', added_by: TEST_UID, deleted_at: null });
    const now = Date.now();
    data.notifications = [
      { id: 'g1', user_id: TEST_UID, read: false, created_at: new Date(now - 60000).toISOString(), message: "🎟️ Kai M. RSVP'd to Tomorrowland", type: null, data: { actor_id: 'kai-uid' } },
      { id: 'g2', user_id: TEST_UID, read: false, created_at: new Date(now - 120000).toISOString(), message: "🎟️ Lexi RSVP'd to Tomorrowland", type: null, data: { actor_id: 'lex-uid' } },
    ];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => openNotifDrawer());

    const rows = page.locator('#notif-list .notif-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.notif-text')).toHaveText("Kai M. and 1 other RSVP'd to Tomorrowland");
    await rows.first().locator('.notif-more-btn').click();
    await expect(page.locator('#notif-list .notif-sub-row')).toHaveCount(2);

    // Tapping the folded row marks every notification in it read.
    await rows.first().locator('.notif-text').click();
    await expect(page.locator('#notif-badge')).not.toHaveClass(/has-unread/);
  });

  test('the footer opens the Settings hub, where Delete my account is reachable', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { openNotifDrawer(); });
    await page.locator('.notif-drawer-footer button', { hasText: 'Settings' }).click();
    await expect(page.locator('#notif-drawer-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#privacy-settings-overlay')).toHaveClass(/open/);
    await expect(page.locator('#settings-title')).toHaveText('⚙️ Settings');
    await page.locator('#delete-account-btn').scrollIntoViewIfNeeded();
    await expect(page.locator('#delete-account-btn')).toBeVisible();
  });
});
