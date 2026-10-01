const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData, TEST_UID } = require('./helpers');

// Blocking (App Store guideline 1.2): a raver can block another from a Huddle
// message or their profile. The block is private and one-way — the blocker
// stops seeing the blocked user's messages and notifications, and can undo it
// from Settings.

const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60000).toISOString();

function seedWithChat(over = {}) {
  const data = seedData();
  data.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
  ];
  data.huddle_messages = [
    { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'kai says hi', reactions: {}, created_at: minsAgo(20), deleted_at: null, mentions: [] },
    { id: 'm2', room_id: 'room-main', crew_id: 'c1', sender_id: TEST_UID, kind: 'text', body: 'riding with you', reactions: {}, created_at: minsAgo(15), deleted_at: null, mentions: [] },
    { id: 'm3', room_id: 'room-main', crew_id: 'c1', sender_id: TEST_UID, kind: 'text', body: 'replying to kai', reply_to_id: 'm1', reactions: {}, created_at: minsAgo(10), deleted_at: null, mentions: [] },
  ];
  data.huddle_room_reads = [{ room_id: 'room-main', user_id: TEST_UID, last_read_at: minsAgo(1) }];
  return Object.assign(data, over);
}

const SESSION_OVER = { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } };

async function openChat(page, data) {
  await bootAuthedApp(page, { data, sessionOver: SESSION_OVER });
  await page.evaluate(async () => { await openHuddle('c1'); });
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
}

test.describe('blocking users', () => {
  test('blocking from a Huddle message hides their messages; unblocking from Settings brings them back', async ({ page }) => {
    const errors = collectPageErrors(page);
    await openChat(page, seedWithChat());
    const stream = page.locator('#hd-stream');
    await expect(stream).toContainText('kai says hi');

    // The bubble menu is a hover affordance the stream overlaps in a headless
    // viewport, so fire the rendered row's own click handler.
    await page.locator('#huddle-bubble-menu-m1').getByText('🚫 Block').dispatchEvent('click');
    await expect(page.locator('#confirm-title')).toContainText('Block Kai');
    await page.locator('#confirm-ok-btn').click();

    await expect(stream).not.toContainText('kai says hi');
    await expect(stream).toContainText('riding with you');
    // A reply quoting the blocked message no longer shows its text.
    await expect(stream.locator('.hd-quote')).toContainText('Original message unavailable');
    const rows = await page.evaluate(() => window.__store.user_blocks);
    expect(rows).toEqual([expect.objectContaining({ blocker_id: 'test-user-id', blocked_id: 'kai-uid' })]);

    await page.evaluate(() => { closeHuddleScreen(); openPrivacySettingsModal('r-you'); });
    const blocked = page.locator('#blocked-ravers-settings');
    await expect(blocked).toContainText('Kai M.');
    await blocked.getByRole('button', { name: 'Unblock' }).click();
    await expect(blocked).not.toContainText('Kai M.');
    expect(await page.evaluate(() => window.__store.user_blocks.length)).toBe(0);
    expect(await page.evaluate(() => isBlockedUser('kai-uid'))).toBe(false);
    expect(errors).toEqual([]);
  });

  test('an existing block hides their messages and notifications at boot', async ({ page }) => {
    const data = seedWithChat({
      user_blocks: [{ blocker_id: TEST_UID, blocked_id: 'kai-uid', created_at: minsAgo(60) }],
      notifications: [
        { id: 'n1', user_id: TEST_UID, crew_id: 'c1', message: 'Kai added you to a rave', read: false, type: null, data: { actor_id: 'kai-uid' }, created_at: minsAgo(5) },
        { id: 'n2', user_id: TEST_UID, crew_id: 'c1', message: 'Sam voted in a poll', read: false, type: null, data: { actor_id: 'sam-uid' }, created_at: minsAgo(4) },
        { id: 'n3', user_id: TEST_UID, crew_id: null, message: 'Set times are up', read: false, type: null, data: null, created_at: minsAgo(3) },
      ],
    });
    await openChat(page, data);
    await expect(page.locator('#hd-stream')).toContainText('riding with you');
    await expect(page.locator('#hd-stream')).not.toContainText('kai says hi');

    await expect.poll(() => page.evaluate(() => _notifications.map(n => n.message).sort()))
      .toEqual(['Sam voted in a poll', 'Set times are up']);
  });

  test('the profile Block button blocks and unblocks', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithChat(), sessionOver: SESSION_OVER });
    await page.evaluate(() => openProfile('r-kai'));
    const btn = page.locator('.profile-actions [data-block-uid="kai-uid"]');
    await expect(btn).toHaveAttribute('title', 'Block');

    await btn.click();
    await page.locator('#confirm-ok-btn').click();
    await expect(btn).toHaveAttribute('title', 'Unblock');
    expect(await page.evaluate(() => isBlockedUser('kai-uid'))).toBe(true);

    await btn.click();
    await expect(btn).toHaveAttribute('title', 'Block');
    expect(await page.evaluate(() => isBlockedUser('kai-uid'))).toBe(false);
  });

  test('your own and unclaimed profiles have no Block button', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithChat(), sessionOver: SESSION_OVER });
    await page.evaluate(() => openProfile('r-you'));
    await expect(page.locator('.profile-actions')).toBeVisible();
    await expect(page.locator('.profile-actions [data-block-uid]')).toHaveCount(0);
    await page.evaluate(() => openProfile('r-sam'));
    await expect(page.locator('.profile-actions[data-raver-id="r-sam"]')).toBeVisible();
    await expect(page.locator('.profile-actions [data-block-uid]')).toHaveCount(0);
  });

  test('notifications you send are stamped with you as the actor', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithChat(), sessionOver: SESSION_OVER });
    await page.evaluate(() => dbAddNotification('kai-uid', 'c1', 'hello kai'));
    const row = await page.evaluate(() => window.__store.notifications.find(n => n.message === 'hello kai'));
    expect(row.data).toEqual({ actor_id: 'test-user-id' });
  });
});
