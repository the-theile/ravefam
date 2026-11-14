// Beacon and mention pushes carry crewId / roomId / messageId, but tapping one
// only ever focused whatever window was already open — the notification told you
// where to look and then didn't take you there. Two arrival paths now: query
// params on a cold start, postMessage into a running tab.
const { test, expect } = require('@playwright/test');
const { installSupabaseStub, bootAuthedApp, makeSession, seedData, TEST_UID } = require('./helpers');

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

function seedWithRooms() {
  const data = seedData();
  data.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
    { id: 'room-side', crew_id: 'c1', room_key: 'side', kind: 'custom', name: 'Side Room', festival_id: null, created_by: TEST_UID, created_at: '2024-01-02T00:00:00Z' },
  ];
  data.huddle_messages = [
    { id: 'm-main', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'main room chatter', reactions: {}, created_at: minsAgo(30), deleted_at: null, mentions: [] },
    { id: 'm-side', room_id: 'room-side', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'beacon lives here', reactions: {}, created_at: minsAgo(10), deleted_at: null, mentions: [] },
  ];
  data.huddle_room_reads = [];
  return data;
}

const SESSION_OVER = { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true }, onboarded: true } };

test.describe('push notification deep links', () => {
  test('a cold start with ?crew&room lands in that room', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession(SESSION_OVER),
      data: seedWithRooms(),
    });
    await page.goto('/app.html?crew=c1&room=room-side&msg=m-side');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);

    expect(await page.evaluate(() => _huddleActiveCrewId)).toBe('c1');
    expect(await page.evaluate(() => _huddleActiveRoomId)).toBe('room-side');
  });

  test('the deep-link params are stripped so a reload does not reopen it', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession(SESSION_OVER),
      data: seedWithRooms(),
    });
    await page.goto('/app.html?crew=c1&room=room-side');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(800);

    const search = await page.evaluate(() => location.search);
    expect(search).not.toContain('crew=');
    expect(search).not.toContain('room=');
  });

  test('unrelated query params survive the strip', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession(SESSION_OVER),
      data: seedWithRooms(),
    });
    await page.goto('/app.html?utm_source=push&crew=c1&room=room-side');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(800);

    const search = await page.evaluate(() => location.search);
    expect(search).toContain('utm_source=push');
    expect(search).not.toContain('crew=');
  });

  test('a running tab routes on the service worker message', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithRooms(), sessionOver: SESSION_OVER });

    // What the worker posts when it focuses an existing window.
    await page.evaluate(() => openHuddleDeepLink({ crewId: 'c1', roomId: 'room-side', messageId: null }));
    await page.waitForTimeout(600);

    expect(await page.evaluate(() => _huddleActiveRoomId)).toBe('room-side');
  });

  test('a crew you are no longer in is ignored rather than erroring', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: seedWithRooms(), sessionOver: SESSION_OVER });

    await page.evaluate(() => openHuddleDeepLink({ crewId: 'c-gone', roomId: 'room-nope', messageId: null }));
    await page.waitForTimeout(400);

    expect(errors).toEqual([]);
    // Still on the page it booted to, not a broken half-open Huddle.
    expect(await page.evaluate(() => _huddleActiveRoomId ?? null)).not.toBe('room-nope');
  });
});
