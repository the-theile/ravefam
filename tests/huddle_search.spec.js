const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData, TEST_UID } = require('./helpers');

// Huddle search: finding where someone said something, across every room the
// crew has, and jumping into the conversation around that message rather than
// just at it.

const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60000).toISOString();

function seedWithRooms(extraMessages = []) {
  const data = seedData();
  data.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
    { id: 'room-f1', crew_id: 'c1', room_key: 'festival:f1', kind: 'festival', name: 'Tomorrowland Huddle', festival_id: 'f1', created_by: TEST_UID, created_at: '2024-01-02T00:00:00Z' },
  ];
  data.huddle_messages = [
    { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'anyone got a spare wristband for saturday', reactions: {}, created_at: minsAgo(600), deleted_at: null, mentions: [] },
    { id: 'm2', room_id: 'room-main', crew_id: 'c1', sender_id: TEST_UID, kind: 'text', body: 'bringing the good speakers', reactions: {}, created_at: minsAgo(500), deleted_at: null, mentions: [] },
    { id: 'm3', room_id: 'room-f1', crew_id: 'c1', sender_id: TEST_UID, kind: 'text', body: 'wristband pickup is at gate C until 8pm', reactions: {}, created_at: minsAgo(400), deleted_at: null, mentions: [] },
    { id: 'm4', room_id: 'room-f1', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'see you at the campsite', reactions: {}, created_at: minsAgo(300), deleted_at: null, mentions: [] },
    ...extraMessages,
  ];
  data.huddle_room_reads = [{ room_id: 'room-main', user_id: TEST_UID, last_read_at: minsAgo(30) }];
  return data;
}

async function openChat(page, data) {
  await bootAuthedApp(page, { data, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  await page.evaluate(async () => { await openHuddle('c1'); });
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
  await page.waitForTimeout(300);
}

async function search(page, term) {
  await page.click('.hd-search-btn');
  await expect(page.locator('#hd-search-panel')).toBeVisible();
  await page.fill('#hd-search-input', term);
  await page.waitForTimeout(500); // debounce + query
}

test.describe('huddle search · finding a message', () => {
  test('searches every room in the crew and says which room each hit came from', async ({ page }) => {
    const errors = collectPageErrors(page);
    await openChat(page, seedWithRooms());
    await search(page, 'wristband');

    const results = page.locator('.hd-search-result');
    await expect(results).toHaveCount(2);
    // Newest first, so the rave room's message leads.
    await expect(results.nth(0).locator('.hd-search-room')).toContainText('Tomorrowland');
    await expect(results.nth(0).locator('.hd-search-who')).toHaveText('You');
    await expect(results.nth(1).locator('.hd-search-room')).toContainText('Main Huddle');
    await expect(results.nth(1).locator('.hd-search-who')).toHaveText('Kai');

    // The matched term is highlighted inside a window of the message body.
    await expect(results.nth(0).locator('.hd-search-mark')).toHaveText('wristband');
    expect(errors).toEqual([]);
  });

  test('the "This room" scope narrows results to the room you are in', async ({ page }) => {
    await openChat(page, seedWithRooms());
    await search(page, 'wristband');
    await expect(page.locator('.hd-search-result')).toHaveCount(2);

    await page.click('.hd-search-filters .huddle-room-pill:has-text("This room")');
    await page.waitForTimeout(400);

    const results = page.locator('.hd-search-result');
    await expect(results).toHaveCount(1);
    await expect(results.nth(0).locator('.hd-search-room')).toContainText('Main Huddle');
  });

  test('the sender filter answers "where did THEY say it"', async ({ page }) => {
    await openChat(page, seedWithRooms());
    await search(page, 'wristband');
    await expect(page.locator('.hd-search-result')).toHaveCount(2);

    await page.selectOption('#hd-search-from', 'kai-uid');
    await page.waitForTimeout(400);

    const results = page.locator('.hd-search-result');
    await expect(results).toHaveCount(1);
    await expect(results.nth(0).locator('.hd-search-who')).toHaveText('Kai');
    await expect(results.nth(0).locator('.hd-search-room')).toContainText('Main Huddle');
  });

  test('auto-posted activity lines stay out of the results — they have no bubble to jump to', async ({ page }) => {
    const data = seedWithRooms([{
      id: 's1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'system',
      body: 'Kai picked up a wristband', reactions: {}, created_at: minsAgo(100), deleted_at: null, mentions: [],
    }]);
    await openChat(page, data);
    await search(page, 'wristband');

    const results = page.locator('.hd-search-result');
    await expect(results).toHaveCount(2);
    await expect(page.locator('#hd-search-results')).not.toContainText('picked up a wristband');
  });

  test('a term nothing matches gets an empty state, not an empty list', async ({ page }) => {
    await openChat(page, seedWithRooms());
    await search(page, 'helicopter');

    await expect(page.locator('.hd-search-result')).toHaveCount(0);
    await expect(page.locator('#hd-search-results')).toContainText('Nothing matches');
  });
});

test.describe('huddle search · jumping to a result', () => {
  test('tapping a result opens that room on the message, with the history around it', async ({ page }) => {
    await openChat(page, seedWithRooms());
    await search(page, 'wristband');

    // The Tomorrowland hit — a different room than the one currently open.
    await page.click('.hd-search-result:has(.hd-search-room:has-text("Tomorrowland"))');
    await page.waitForTimeout(600);

    // Search closes, the room switcher follows, and the message is on screen.
    await expect(page.locator('#hd-search-panel')).toBeHidden();
    await expect(page.locator('.hd-room-name')).toContainText('Tomorrowland');
    await expect(page.locator('#hd-bub-m3')).toHaveCount(1);
    await expect(page.locator('#hd-bub-m3')).toHaveClass(/hd-bub-highlight/);

    // Both directions of the conversation are loaded — you land inside it.
    await expect(page.locator('#hd-bub-m4')).toHaveCount(1);
  });

  test('landing mid-history keeps the live end honest: newer messages page in, and are not silently marked read', async ({ page }) => {
    // 25 messages after the target, so more than the half-page loaded around it.
    const newer = Array.from({ length: 25 }, (_, i) => ({
      id: `n${i}`, room_id: 'room-f1', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text',
      body: `later chatter ${i}`, reactions: {}, created_at: minsAgo(200 - i), deleted_at: null, mentions: [],
    }));
    await openChat(page, seedWithRooms(newer));
    await search(page, 'wristband');
    await page.click('.hd-search-result:has(.hd-search-room:has-text("Tomorrowland"))');
    await page.waitForTimeout(600);

    // Parked on older history: the stream offers a way forward instead of
    // pretending its last message is the newest one.
    await expect(page.locator('#hd-loadnewer')).toHaveCount(1);
    expect(await page.evaluate(() => _huddleHasNewer)).toBe(true);

    // Nothing was marked read for a room whose newest messages we never showed.
    const readRow = await page.evaluate(() =>
      (window.__store.huddle_room_reads || []).find(r => r.room_id === 'room-f1'));
    expect(readRow).toBeFalsy();

    // Reading forward reaches the live end, and then the room does count as read.
    await page.click('#hd-loadnewer');
    await page.waitForTimeout(400);
    await expect(page.locator('#hd-loadnewer')).toHaveCount(0);
    expect(await page.evaluate(() => _huddleHasNewer)).toBe(false);
    const readAfter = await page.evaluate(() =>
      (window.__store.huddle_room_reads || []).find(r => r.room_id === 'room-f1'));
    expect(readAfter).toBeTruthy();
  });

  test('sending from a historical window snaps back to the live end first', async ({ page }) => {
    const newer = Array.from({ length: 25 }, (_, i) => ({
      id: `n${i}`, room_id: 'room-f1', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text',
      body: `later chatter ${i}`, reactions: {}, created_at: minsAgo(200 - i), deleted_at: null, mentions: [],
    }));
    await openChat(page, seedWithRooms(newer));
    await search(page, 'wristband');
    await page.click('.hd-search-result:has(.hd-search-room:has-text("Tomorrowland"))');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => _huddleHasNewer)).toBe(true);

    await page.fill('#huddle-text-input', 'found it, thanks');
    await page.evaluate(() => submitHuddleTextMessage());
    await page.waitForTimeout(600);

    // The message is stored, and the stream is back at the live end — not
    // rendering a reply directly after messages it does not actually follow.
    const sent = await page.evaluate(() =>
      (window.__store.huddle_messages || []).find(m => m.body === 'found it, thanks'));
    expect(sent.room_id).toBe('room-f1');
    expect(await page.evaluate(() => _huddleHasNewer)).toBe(false);
    await expect(page.locator('.hd-bub-body').last()).toContainText('found it, thanks');
  });
});
