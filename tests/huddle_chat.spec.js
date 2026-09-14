const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData, TEST_UID } = require('./helpers');

// The Huddle used to render as an accordion panel inside crew detail that
// rebuilt its entire root — composer included — on every event. These cover
// the full-screen chat that replaced it: grouping, day separators, the unread
// divider, replies, mentions, and the draft-preservation regression that
// motivated the rewrite.

const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60000).toISOString();
const daysAgo = (d, m = 0) => new Date(now - d * 86400000 - m * 60000).toISOString();

function seedWithChat(over = {}) {
  const data = seedData();
  data.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
  ];
  data.huddle_messages = [
    { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'who is driving tomorrow', reactions: {}, created_at: daysAgo(1, 90), deleted_at: null, mentions: [] },
    { id: 'm2', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'i can take four', reactions: {}, created_at: daysAgo(1, 89), deleted_at: null, mentions: [] },
    { id: 'm3', room_id: 'room-main', crew_id: 'c1', sender_id: TEST_UID, kind: 'text', body: 'riding with you', reactions: {}, created_at: daysAgo(1, 87), deleted_at: null, mentions: [] },
    { id: 'm4', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'do not be late', reactions: {}, created_at: minsAgo(5), deleted_at: null, mentions: [] },
  ];
  data.huddle_room_reads = [{ room_id: 'room-main', user_id: TEST_UID, last_read_at: minsAgo(30) }];
  return Object.assign(data, over);
}

// A crew with a rave history: one upcoming, one that happened last night
// (inside the 3-day grace window) and two well past it.
function seedWithRaveHistory() {
  const data = seedWithChat();
  const ymd = (d) => new Date(now - d * 86400000).toISOString().slice(0, 10);
  data.festivals = data.festivals.concat([
    { id: 'f-last', name: 'Last Night Fest', date: ymd(1), location: 'Tampa, FL', color: '#00F5FF', days: null, deleted_at: null },
    { id: 'f-old', name: 'Old Fest', date: ymd(30), location: 'Miami, FL', color: '#B14BFF', days: null, deleted_at: null },
    { id: 'f-ancient', name: 'Ancient Fest', date: ymd(400), location: 'Orlando, FL', color: '#FFD93D', days: null, deleted_at: null },
  ]);
  // Shared attendance is what earns a rave its room: you plus a crewmate.
  ['f-last', 'f-old', 'f-ancient'].forEach(fid => {
    data.raver_festivals = data.raver_festivals.concat([
      { raver_id: 'r-you', festival_id: fid },
      { raver_id: 'r-sam', festival_id: fid },
    ]);
  });
  // Past rooms are never re-materialized by ensureHuddleRooms — they simply
  // persist from when the rave was still upcoming, which is what this seeds.
  data.huddle_rooms = data.huddle_rooms.concat([
    { id: 'room-last', crew_id: 'c1', room_key: 'festival:f-last', kind: 'festival', name: 'Last Night Fest Huddle', festival_id: 'f-last', created_by: TEST_UID, created_at: '2024-01-02T00:00:00Z' },
    { id: 'room-old', crew_id: 'c1', room_key: 'festival:f-old', kind: 'festival', name: 'Old Fest Huddle', festival_id: 'f-old', created_by: TEST_UID, created_at: '2024-01-03T00:00:00Z' },
    { id: 'room-ancient', crew_id: 'c1', room_key: 'festival:f-ancient', kind: 'festival', name: 'Ancient Fest Huddle', festival_id: 'f-ancient', created_by: TEST_UID, created_at: '2024-01-04T00:00:00Z' },
  ]);
  data.huddle_messages = data.huddle_messages.concat([
    { id: 'm-old-1', room_id: 'room-old', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'found your fanny pack', reactions: {}, created_at: minsAgo(10), deleted_at: null, mentions: [] },
  ]);
  return data;
}

async function openChat(page, data) {
  await bootAuthedApp(page, { data, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  await page.evaluate(async () => { await openHuddle('c1'); });
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
  await page.waitForTimeout(300);
}

test.describe('huddle chat · stream rendering', () => {
  test('opens as a full-screen surface with grouped senders, day separators and timestamps', async ({ page }) => {
    const errors = collectPageErrors(page);
    await openChat(page, seedWithChat());

    // Two consecutive messages from Kai collapse into ONE group: one avatar,
    // one name label, one timestamp — not two bubbles' worth of chrome.
    const groups = page.locator('.hd-grp');
    await expect(groups).toHaveCount(3); // Kai x2, you, Kai
    await expect(groups.nth(0).locator('.hd-row')).toHaveCount(2);
    await expect(groups.nth(0).locator('.hd-sender')).toHaveCount(1);

    // Your own group carries no name label — it's obviously yours.
    await expect(groups.nth(1)).toHaveClass(/hd-grp-you/);
    await expect(groups.nth(1).locator('.hd-sender')).toHaveCount(0);

    // Day separators bracket the two days, and every group is timestamped.
    await expect(page.locator('.hd-daysep')).toHaveCount(2);
    await expect(page.locator('.hd-daysep').last()).toContainText('Today');
    await expect(page.locator('.hd-meta')).toHaveCount(3);

    expect(errors).toEqual([]);
  });

  test('a "New messages" divider marks where the last read watermark was', async ({ page }) => {
    await openChat(page, seedWithChat());
    await expect(page.locator('.hd-unread')).toHaveCount(1);
    await expect(page.locator('.hd-unread')).toContainText('New messages');
    // It sits before the only message newer than the watermark.
    const dividerY = await page.locator('.hd-unread').boundingBox();
    const lastMsgY = await page.locator('.hd-grp').last().boundingBox();
    expect(dividerY.y).toBeLessThan(lastMsgY.y);
  });

  test('voice notes longer than a minute format as m:ss, not 0:84', async ({ page }) => {
    const data = seedWithChat();
    data.huddle_messages.push({
      id: 'm5', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'voice',
      body: null, media_url: 'https://example.com/v.webm', media_duration_ms: 84000,
      reactions: {}, created_at: minsAgo(2), deleted_at: null, mentions: [],
    });
    await openChat(page, data);
    await expect(page.locator('.hd-vdur')).toHaveText('1:24');
  });

  test('every room the crew has — Main and per-rave — lives in one switcher', async ({ page }) => {
    await openChat(page, seedWithChat());
    await page.evaluate(() => toggleHuddleRoomMenu());
    const pills = page.locator('#huddle-room-menu .huddle-room-pill');
    // Main plus the rave room materialized from shared attendance (f1).
    await expect(pills).toHaveCount(2);
    await expect(pills.nth(0)).toContainText('Main Huddle');
    await expect(pills.nth(1)).toContainText('Tomorrowland');
  });

  // A crew that rages every weekend piles up rave rooms, and the dead ones
  // used to sort above the live ones — five "past" rooms before "tomorrow".
  // Raves older than the grace window now nest behind one collapsed row.
  test('raves past the grace window nest under a collapsed group, live rooms stay up top', async ({ page }) => {
    await openChat(page, seedWithRaveHistory());
    await page.evaluate(() => toggleHuddleRoomMenu());

    // Main, the rave that only just happened, then the upcoming one. The
    // afterglow room stays in the live list through its grace window — and
    // leads it, because that's where the recap chat is actually happening.
    const pills = page.locator('#huddle-room-menu .huddle-room-pill');
    await expect(pills).toHaveCount(3);
    await expect(pills.nth(0)).toContainText('Main Huddle');
    await expect(pills.nth(1)).toContainText('Last Night Fest · ⏳ just wrapped');
    await expect(pills.nth(2)).toContainText('Tomorrowland');

    // The two archived raves fold into one row that carries their combined
    // unread count, so nothing is lost behind the fold.
    const toggle = page.locator('.huddle-room-group-toggle');
    await expect(toggle).toContainText('Past raves');
    await expect(toggle.locator('.huddle-room-group-count')).toHaveText('2');
    await expect(toggle.locator('.huddle-cta-count')).toHaveText('1');

    await toggle.click();
    await expect(pills).toHaveCount(5);
    // Most recent archived rave first.
    await expect(pills.nth(3)).toContainText('Old Fest');
    await expect(pills.nth(4)).toContainText('Ancient Fest');
    await expect(page.locator('#huddle-room-menu')).toBeVisible();
  });

  test('the switcher re-collapses past raves every time it is opened', async ({ page }) => {
    await openChat(page, seedWithRaveHistory());
    await page.evaluate(() => toggleHuddleRoomMenu());
    await page.locator('.huddle-room-group-toggle').click();
    await expect(page.locator('#huddle-room-menu .huddle-room-pill')).toHaveCount(5);

    await page.evaluate(() => toggleHuddleRoomMenu());  // close
    await page.evaluate(() => toggleHuddleRoomMenu());  // reopen
    await expect(page.locator('#huddle-room-menu .huddle-room-pill')).toHaveCount(3);
  });

  test('the room you are in is never nested away', async ({ page }) => {
    await openChat(page, seedWithRaveHistory());
    await page.evaluate(async () => { await switchHuddleRoom('room-old'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => toggleHuddleRoomMenu());

    const pills = page.locator('#huddle-room-menu .huddle-room-pill');
    await expect(pills).toHaveCount(4);
    await expect(pills.nth(3)).toContainText('Old Fest');
    await expect(pills.nth(3)).toHaveClass(/active/);
    await expect(page.locator('.huddle-room-group-count')).toHaveText('1');
  });
});

test.describe('huddle chat · composer', () => {
  // The regression that motivated the redesign: renderHuddleUI() used to blow
  // away the whole root, so an incoming message wiped your half-typed draft,
  // dropped focus, and closed the mobile keyboard mid-sentence.
  test('an incoming message does not clobber a draft in progress', async ({ page }) => {
    await openChat(page, seedWithChat());

    await page.fill('#huddle-text-input', 'half a thought');
    await page.focus('#huddle-text-input');

    // Exactly what the realtime INSERT handler does.
    await page.evaluate(() => {
      huddleMessages.push({
        id: 'incoming', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid',
        kind: 'text', body: 'from someone else', reactions: {},
        created_at: new Date().toISOString(), deleted_at: null, mentions: [],
      });
      renderHuddleUI();
    });
    await page.waitForTimeout(200);

    await expect(page.locator('#huddle-text-input')).toHaveValue('half a thought');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('huddle-text-input');
    await expect(page.locator('.hd-bub-body').last()).toContainText('from someone else');
  });

  test('replying stores reply_to_id and renders a tappable quote', async ({ page }) => {
    await openChat(page, seedWithChat());

    await page.evaluate(() => setHuddleReplyTarget('m4'));
    await expect(page.locator('.hd-replybar')).toContainText('Replying to Kai');

    await page.fill('#huddle-text-input', 'on my way');
    await page.evaluate(() => submitHuddleTextMessage());
    await page.waitForTimeout(300);

    const sent = await page.evaluate(() =>
      (window.__store.huddle_messages || []).find(m => m.body === 'on my way'));
    expect(sent.reply_to_id).toBe('m4');

    // The reply bar clears once sent, and the new bubble carries the quote.
    await expect(page.locator('.hd-replybar')).toHaveCount(0);
    await expect(page.locator('.hd-quote').last()).toContainText('do not be late');
  });
});

test.describe('huddle chat · mentions', () => {
  test('@-ing a crewmate records the mention and notifies them in-app', async ({ page }) => {
    await openChat(page, seedWithChat());

    await page.fill('#huddle-text-input', 'hey @Kai M. you around');
    await page.evaluate(() => submitHuddleTextMessage());
    await page.waitForTimeout(300);

    const sent = await page.evaluate(() =>
      (window.__store.huddle_messages || []).find(m => (m.body || '').includes('you around')));
    expect(sent.mentions).toEqual(['kai-uid']);

    const notif = await page.evaluate(() =>
      (window.__store.notifications || []).find(n => String(n.user_id) === 'kai-uid' && (n.message || '').includes('mentioned you')));
    expect(notif).toBeTruthy();
  });

  test('a mention of you is highlighted in the stream', async ({ page }) => {
    const data = seedWithChat();
    data.huddle_messages.push({
      id: 'm6', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text',
      body: '@Theile you driving?', reactions: {}, created_at: minsAgo(1), deleted_at: null, mentions: [TEST_UID],
    });
    await openChat(page, data);
    const mention = page.locator('.hd-mention').first();
    await expect(mention).toHaveText('@Theile');
    await expect(mention).toHaveClass(/hd-mention-me/);
  });

  test('the @ autocomplete offers crewmates but never yourself', async ({ page }) => {
    await openChat(page, seedWithChat());
    await page.fill('#huddle-text-input', 'hey @');
    await page.evaluate(() => {
      const el = document.getElementById('huddle-text-input');
      el.setSelectionRange(el.value.length, el.value.length);
      handleHuddleComposerInput(el);
    });
    await page.waitForTimeout(200);

    const rows = page.locator('.hd-mention-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Kai M.');
    // Theile is the signed-in user and Sam is an unclaimed placeholder with no
    // account to notify — neither belongs in the list.
    await expect(page.locator('.hd-mention-menu')).not.toContainText('Theile');
    await expect(page.locator('.hd-mention-menu')).not.toContainText('Sam');
  });
});

test.describe('huddle chat · crew detail entry', () => {
  test('the crew tile shows a preview with the unread count and launches the chat', async ({ page }) => {
    await bootAuthedApp(page, {
      data: seedWithChat(),
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } },
    });
    await page.evaluate(async () => { await openDetail('c1'); await loadHuddleActivityCache(); rerenderHuddleTilePreview('c1'); });
    await page.waitForTimeout(300);

    const preview = page.locator('.huddle-tile-preview');
    await expect(preview).toContainText('unread');
    await expect(preview.locator('.huddle-cta-count')).toHaveText('1');

    // The conversation itself is not inlined into crew detail anymore.
    await expect(page.locator('#huddle-screen')).toHaveCount(0);
    await preview.click();
    await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
  });

  test('bottom-nav navigation dismisses the chat instead of leaving it stranded', async ({ page }) => {
    await openChat(page, seedWithChat());
    await page.evaluate(() => switchTab('events'));
    await expect(page.locator('#huddle-screen')).toHaveCount(0);
  });
});
