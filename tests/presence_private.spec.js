// L5: crew and Huddle presence (names, where, typing) ride private Realtime
// channels, which only the crew's members can join (RLS on realtime.messages).
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

test('crew and Huddle presence channels are private', async ({ page }) => {
  const data = seedData();
  data.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
  ];
  data.huddle_messages = [];
  data.huddle_room_reads = [];
  await bootAuthedApp(page, { data, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  await page.evaluate(async () => { await openHuddle('c1'); });
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);

  const channels = await page.evaluate(() => window.__channels);
  const presence = channels.filter(c => /^(crew|huddle)-presence:/.test(c.name));
  expect(presence.map(c => c.name)).toEqual(expect.arrayContaining(['crew-presence:c1', 'huddle-presence:room-main']));
  for (const c of presence) expect(c.opts.config?.private, c.name).toBe(true);
  // Postgres Changes channels are guarded by table RLS and stay public.
  expect(channels.find(c => c.name.startsWith('huddle:')).opts.config?.private).toBeFalsy();
});
