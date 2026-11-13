// Captures the Huddle push-notification carousel screens from the real app with demo data.
// To re-run: copy into tests/ (it uses ./helpers) and run with --project=chromium. Not part of the suite.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');
const OUT = 'marketing/huddle-push-2026/_build/shots/';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } });

const NOW = new Date('2026-12-29T19:42:00');
const at = (minsAgo) => new Date(NOW.getTime() - minsAgo * 60000).toISOString();

function crewData() {
  const d = seedData();
  d.festivals[0] = { id: 'f1', name: 'Eternal NYE', date: '2026-12-30', location: 'Orlando, FL', color: '#FF2D78', days: 2, deleted_at: null, slug: 'eternal-nye-2026' };
  d.ravers.find(r => r.id === 'r-sam').claimed_by = 'sam-uid';
  d.ravers.find(r => r.id === 'r-sam').status = 'claimed';
  d.ravers.push({ ...d.ravers.find(r => r.id === 'r-kai'), id: 'r-jess', name: 'Jess R.', handle: 'jessglows', claimed_by: 'jess-uid', qr_token: 'qr-jess',
    gradient: 'linear-gradient(135deg,#39FF14,#00F5FF)' });
  d.crew_members.push({ crew_id: 'c1', raver_id: 'r-jess', added_at: '2024-01-01T00:00:00Z', added_by: TEST_UID, deleted_at: null });
  d.raver_festivals = ['r-you', 'r-sam', 'r-kai', 'r-jess'].map(r => ({ raver_id: r, festival_id: 'f1' }));
  d.huddle_rooms = [{ id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' }];
  return d;
}
const msg = (id, sender, minsAgo, kind, body, extra = {}) => ({ id, room_id: 'room-main', crew_id: 'c1', sender_id: sender, kind, body,
  reactions: {}, created_at: at(minsAgo), deleted_at: null, mentions: [], ...extra });

async function openChat(page, d, readMinsAgo) {
  await page.clock.setFixedTime(NOW);
  d.huddle_room_reads = [{ room_id: 'room-main', user_id: TEST_UID, last_read_at: at(readMinsAgo) }];
  await bootAuthedApp(page, { data: d, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; } .coachmark, .toast { display: none !important; }' });
  await page.evaluate(async () => { await openHuddle('c1'); });
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
  await page.waitForTimeout(500);
}

test('huddle: plan drop', async ({ page }) => {
  const d = crewData();
  d.huddle_messages = [
    msg('a1', 'kai-uid', 190, 'text', 'ok who is actually locked in for eternal 👀'),
    msg('a2', 'jess-uid', 186, 'text', 'me!! bought my ticket at 2am like a responsible adult', { reactions: { '😂': ['kai-uid', TEST_UID] } }),
    msg('a3', TEST_UID, 30, 'system', '📋 The Rave Plan is up (Eternal NYE) — claim what you\'ll handle'),
    msg('a4', 'sam-uid', 26, 'system', '🚗 Sam is driving (3 seats)'),
    msg('a5', 'kai-uid', 22, 'system', '🎟️ Kai joined a ride'),
    msg('a6', 'jess-uid', 18, 'system', '🎒 Jess added "glow sticks + kandi kit" to crew gear'),
    msg('a7', 'jess-uid', 17, 'text', 'claiming kandi duty 🫶 bracelets for everyone'),
    msg('a8', 'kai-uid', 3, 'text', 'plan is looking STACKED', { reactions: { '🔥': ['jess-uid', 'sam-uid'] } }),
  ];
  await openChat(page, d, 35);
  await page.locator('.hd-actrun-head').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'huddle-plan.png' });
});

test('huddle: pre-fest spot', async ({ page }) => {
  const d = crewData();
  d.huddle_messages = [
    msg('b1', 'sam-uid', 95, 'text', 'where are we pregaming before day 1?'),
    msg('b2', TEST_UID, 90, 'text', 'somewhere close to the gates pls 🙏'),
    msg('b3', 'jess-uid', 12, 'text', 'FOUND IT. taco truck lot across from the entrance, shade + space for all of us 🌮'),
    msg('b4', 'jess-uid', 11, 'meetup', 'Pre-fest: taco truck lot', { meetup_at: new Date('2026-12-30T16:30:00').toISOString() }),
    msg('b5', 'jess-uid', 10, 'text', '@Theile you better not be late this time 😤', { mentions: [TEST_UID] }),
    msg('b6', 'kai-uid', 4, 'text', 'say less, i\'m there 4:30', { reactions: { '🙌': ['jess-uid', 'sam-uid', TEST_UID] } }),
  ];
  await openChat(page, d, 20);
  await page.screenshot({ path: OUT + 'huddle-spot.png' });
});

test('poll results', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const d = crewData();
  d.crew_polls = [{
    id: 'p1', crew_id: 'c1', created_by: 'kai-uid', question: 'Matching fits for night 2?', poll_type: 'choice', festival_id: null,
    options: ['All neon pink 💖', 'Full cyberpunk 🤖', 'Kandi overload 🌈'],
    is_anonymous: false, expires_at: '2026-12-29T18:00:00Z', is_locked: false, is_pinned: false, reactions: {}, created_at: at(600), deleted_at: null,
  }];
  d.crew_poll_votes = [['r-you', 0], ['r-kai', 0], ['r-jess', 0], ['r-sam', 2]].map(([r, o], i) => ({ id: 'v' + i, poll_id: 'p1', raver_id: r, user_id: { 'r-you': TEST_UID, 'r-kai': 'kai-uid', 'r-jess': 'jess-uid', 'r-sam': 'sam-uid' }[r], vote_value: String(o), created_at: at(500 - i) }));
  await bootAuthedApp(page, { data: d });
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; } #toast { display: none !important; }' });
  await page.evaluate(async () => { await openDetail('c1'); await dbLoadPolls('c1'); rerenderPolls('c1'); });
  await page.locator(".crew-feature-tile[onclick*=\"'poll'\"]").click();
  await expect(page.locator('#crew-feature-panel-poll')).toBeVisible();
  await page.waitForTimeout(400);
  await page.locator('#poll-card-p1').evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.locator('#poll-card-p1').screenshot({ path: OUT + 'poll-card.png' });
  await page.screenshot({ path: OUT + 'poll-full.png' });
});
