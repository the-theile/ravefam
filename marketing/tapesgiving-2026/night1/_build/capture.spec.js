// Captures the Tapesgiving Night 1 story screenshots from the real app (app.html)
// with a demo crew. Not part of the suite. To re-run from the repo root:
//   cp marketing/tapesgiving-2026/night1/_build/capture.spec.js tests/zz_tapesgiving_capture.spec.js
//   npx playwright test tests/zz_tapesgiving_capture.spec.js --project=chromium --trace off
//   rm tests/zz_tapesgiving_capture.spec.js
// Lineup rows mirror Supabase artist_festival_appearances for tapesgiving-2026
// (checked Nov 27 2026: 9 rows, no set times or stages posted yet).
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');
const OUT = 'marketing/tapesgiving-2026/night1/_build/shots/';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, timezoneId: 'America/New_York',
  launchOptions: { executablePath: '/opt/pw-browsers/chromium' } });

const FID = '0a58fa03-0d13-43d4-8830-664b68e699dc';
// Real venue map (festivals.map_url, uploaded Nov 27 2026); served from the local copy in map/.
const MAP_URL = `https://tvpgopciioqbqmjjjigh.supabase.co/storage/v1/object/public/festival-maps/festivals/${FID}.jpg`;
const MAP_FILE = require('path').join(__dirname, '../marketing/tapesgiving-2026/night1/_build/map/tapesgiving-map.jpg');
const LINEUP = [ // [appearance id, artist id, name, night, headliner, note]
  [384, 350, 'Tape B', 'fri', true, 'Friday headliner'],
  [385, 104, 'EAZYBAKED', 'fri', false, 'b2b set'],
  [386, 89, 'Distinct Motive', 'fri', false, 'b2b set'],
  [387, 336, 'Space Wizard', 'fri', false, null],
  [388, 61, 'Claybrook', 'fri', false, null],
  [389, 350, 'Tape B', 'sat', true, 'Saturday headliner'],
  [390, 130, 'G Jones', 'sat', false, null],
  [391, 256, 'Moody Good', 'sat', false, null],
  [392, 100, 'Dr. Ushuu', 'sat', false, null],
];
const NIGHT1_PICKS = [350, 104, 89, 336]; // Tape B, EAZYBAKED b2b Distinct Motive, Space Wizard

function tgData() {
  const d = seedData();
  // Demo crew only: no real people.
  Object.assign(d.ravers[0], { name: 'Nova', handle: 'novaglow', instagram: '', base: 'Tampa, FL', genres: ['Bass', 'Riddim'] });
  Object.assign(d.ravers[1], { name: 'Sam', base: 'St. Pete, FL' });
  Object.assign(d.ravers[2], { name: 'Kai', base: 'Clearwater, FL' });
  d.ravers.push({ ...d.ravers[2], id: 'r-jess', name: 'Jess', handle: 'jessbass', claimed_by: 'jess-uid', qr_token: 'qr-jess',
    gradient: 'linear-gradient(135deg,#39FF14,#00F5FF)', base: 'Tampa, FL' });
  d.crew_members.push({ crew_id: 'c1', raver_id: 'r-jess', added_at: '2024-01-01T00:00:00Z', added_by: TEST_UID, deleted_at: null });
  d.festivals = [{ id: FID, slug: 'tapesgiving-2026', name: 'Tapesgiving', date: '2026-11-27', days: 2, location: 'Clearwater, Florida, United States',
    color: '#FFE600', timezone: 'America/New_York', map_url: MAP_URL, deleted_at: null }];
  d.raver_festivals = ['r-you', 'r-sam', 'r-kai', 'r-jess'].map(r => ({ raver_id: r, festival_id: FID }));
  d.raver_festival_interest = [];
  const seen = new Set();
  d.artists = LINEUP.filter(([, aid]) => !seen.has(aid) && seen.add(aid)).map(([, aid, n]) => ({ id: aid, name: n, genres: [] }));
  d.raver_favorite_artists = [{ raver_id: 'r-you', artist_id: 350 }];
  d.artist_festival_appearances = LINEUP.map(([id, artist_id, , night, is_headliner, note]) => ({ id, artist_id, festival_id: FID, is_headliner, night, note,
    start_at: null, end_at: null, stage: null, b2b_group: null, time_official: false }));
  d.raver_artist_plans = [
    ...NIGHT1_PICKS.map(a => ({ raver_id: 'r-you', artist_id: a, festival_id: FID })),
    ...[[ 'r-sam', 350 ], [ 'r-sam', 336 ], [ 'r-kai', 350 ], [ 'r-kai', 104 ], [ 'r-kai', 89 ], [ 'r-jess', 350 ], [ 'r-jess', 61 ]]
      .map(([r, a]) => ({ raver_id: r, artist_id: a, festival_id: FID })),
  ];
  d.set_meetups = [];
  return d;
}

const at = (hhmm) => new Date(`2026-11-27T${hhmm}:00-05:00`).toISOString();
function withHuddle(d) {
  d.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
    { id: 'room-tg', crew_id: 'c1', room_key: `festival:${FID}`, kind: 'festival', name: 'Tapesgiving Huddle', festival_id: FID, created_by: TEST_UID, created_at: '2026-11-01T00:00:00Z' },
  ];
  const msg = (id, sender, body, hhmm, extra = {}) => ({ id, room_id: 'room-tg', crew_id: 'c1', sender_id: sender, kind: 'text', body, reactions: {},
    created_at: at(hhmm), deleted_at: null, mentions: [], ...extra });
  d.huddle_messages = [
    msg('t1', 'kai-uid', 'TAPESGIVING DAY ONE 🦃🔊', '15:02'),
    msg('t2', 'jess-uid', 'outfits are DONE', '15:04', { reactions: { '🔥': ['kai-uid', TEST_UID] } }),
    msg('t3', TEST_UID, 'who is grabbing who', '15:10'),
    msg('t4', 'kai-uid', 'i can take 3, leaving at 6:30', '15:11'),
    msg('t5', TEST_UID, 'dropping our meetup spot so nobody gets lost', '15:20'),
    msg('t6', TEST_UID, 'Plaza, by the food trucks', '15:20', { kind: 'meetup', meetup_at: at('19:30'), pin_x: 0.80, pin_y: 0.75, meetup_status: 'here', pinned_at: at('15:21'), pinned_by: TEST_UID }),
    msg('t7', 'jess-uid', 'locked in 💚', '15:23', { reactions: { '💚': ['kai-uid', TEST_UID] } }),
    msg('t8', 'kai-uid', 'see yall at the plaza 🫶', '15:24'),
  ];
  d.huddle_room_reads = [{ room_id: 'room-tg', user_id: TEST_UID, last_read_at: at('15:30') }, { room_id: 'room-main', user_id: TEST_UID, last_read_at: at('15:30') }];
  return d;
}

const CLEAN = '*, *::before, *::after { animation: none !important; transition: none !important; } .toast, #toast { display: none !important; }';
async function boot(page, d) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.request().url() === MAP_URL ? r.fulfill({ path: MAP_FILE, contentType: 'image/jpeg' }) : r.abort());
  await page.clock.setFixedTime(new Date(at('15:31')));
  const errors = await bootAuthedApp(page, { data: d, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  await page.addStyleTag({ content: CLEAN });
  return errors;
}

test('huddle with pinned meetup', async ({ page }) => {
  await boot(page, withHuddle(tgData()));
  await page.evaluate(async () => { await openHuddle('c1'); });
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
  if (await page.locator('.hd-meetup').count() === 0) {
    await page.evaluate(async () => { if (typeof switchHuddleRoom === 'function') await switchHuddleRoom('room-tg'); });
  }
  await expect(page.locator('.hd-meetup')).toBeVisible();
  await expect(page.locator('.hd-pinned')).toBeVisible();
  await expect(page.locator('.hd-meetup-map img')).toHaveJSProperty('complete', true);
  await page.locator('.hd-meetup').evaluate(e => e.closest('.hd-row, .hd-grp, div').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + 'huddle-meetup.png' });
});

test('rave focus lineup', async ({ page }) => {
  await boot(page, tgData());
  await page.evaluate((fid) => openRaveFocus(fid), FID);
  await page.waitForTimeout(600);
  await page.getByRole('tab', { name: /Lineup/ }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + 'focus-lineup.png' });
});

