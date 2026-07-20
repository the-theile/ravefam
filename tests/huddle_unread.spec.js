const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// A crew (c1) main-room message from a crewmate (r-kai / kai-uid), unread by
// the current user (r-you / TEST_UID) — the baseline fixture every test here
// starts from.
function seedWithHuddle() {
  const data = seedData();
  data.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
  ];
  data.huddle_messages = [
    { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'yo squad', reactions: {}, created_at: '2099-01-01T00:00:00Z', deleted_at: null },
  ];
  return data;
}

test.describe('huddle unread indicators', () => {
  test('an unread message from a crewmate shows a count on the crew card and the nav bell', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithHuddle() });
    await page.evaluate(() => loadHuddleActivityCache());
    await page.waitForTimeout(200);

    const cta = page.locator('.huddle-cta-btn[data-crew-id="c1"]');
    await expect(cta.locator('.huddle-cta-count')).toHaveText('1');

    const bell = page.locator('#notif-badge');
    await expect(bell).toHaveClass(/has-count/);
    await expect(bell).toHaveText('1');
  });

  test('a message the viewer sent themselves never counts as unread', async ({ page }) => {
    const data = seedWithHuddle();
    data.huddle_messages[0].sender_id = TEST_UID;
    await bootAuthedApp(page, { data });
    await page.evaluate(() => loadHuddleActivityCache());
    await page.waitForTimeout(200);

    await expect(page.locator('.huddle-cta-btn[data-crew-id="c1"]')).toHaveCount(0);
    await expect(page.locator('#notif-badge')).not.toHaveClass(/has-count/);
  });

  test('opening the huddle marks it read: badges clear and a read watermark persists server-side', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithHuddle() });
    await page.evaluate(() => loadHuddleActivityCache());
    await page.waitForTimeout(200);
    await expect(page.locator('.huddle-cta-count')).toHaveText('1');

    await page.evaluate(async () => { await openDetail('c1', { tab: 'huddle' }); });
    await page.waitForTimeout(300);

    await expect(page.locator('.huddle-cta-btn[data-crew-id="c1"]')).toHaveCount(0);
    await expect(page.locator('#notif-badge')).not.toHaveClass(/has-count/);

    const read = await page.evaluate(() =>
      (window.__store.huddle_room_reads || []).find(r => r.room_id === 'room-main' && String(r.user_id) === 'test-user-id'));
    expect(read).toBeTruthy();
  });

  test('a second, still-unread room keeps the crew badge lit after reading one room', async ({ page }) => {
    const data = seedWithHuddle();
    data.huddle_rooms.push({ id: 'room-custom', crew_id: 'c1', room_key: 'custom:extra', kind: 'custom', name: 'Side Chat', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' });
    data.huddle_messages.push({ id: 'm2', room_id: 'room-custom', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'also this', reactions: {}, created_at: '2099-01-02T00:00:00Z', deleted_at: null });
    await bootAuthedApp(page, { data });
    await page.evaluate(() => loadHuddleActivityCache());
    await page.waitForTimeout(200);
    await expect(page.locator('.huddle-cta-count')).toHaveText('2');

    // Reading just the main room (not the custom one) should leave 1 unread.
    await page.evaluate(async () => { await switchHuddleRoom('room-main'); });
    await page.waitForTimeout(300);
    await expect(page.locator('.huddle-cta-count')).toHaveText('1');
  });
});
