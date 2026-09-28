// Captures the Hulaween campaign screenshots with demo data. To re-run: copy into tests/ (it uses ./helpers) and run with --project=chromium.
// (marketing/hulaween-2026/_build/shots). Not part of the suite.
const { test, expect } = require('@playwright/test');
const { installSupabaseStub, bootAuthedApp, seedData, makeSession, TEST_UID } = require('./helpers');
const OUT = 'marketing/hulaween-2026/_build/shots/';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

const NAMES = ['Pretty Lights', 'Green Velvet', 'My Morning Jacket', 'The String Cheese Incident', 'Lettuce', 'Levity',
  'Excision', 'STS9', 'Ben Böhmer', 'Dope Lemon', 'Kasablanca', 'Mountain Grass Unit'];
const ID = Object.fromEntries(NAMES.map((n, i) => [n, i + 1]));
const PULSE = { ok: true, crews: [{ id: 'c1', n: 'Lionhearts', col: '#FF2D78' }],
  mates: { m1: { n: 'Sam', s: 'going', u: false, c: ['c1'] }, m2: { n: 'Kai', s: 'going', u: false, c: ['c1'] },
           m3: { n: 'Jess', s: 'going', u: false, c: ['c1'] }, m4: { n: 'Theo', s: 'interested', u: false, c: ['c1'] } },
  going: ['m1', 'm2', 'm3'], interested: ['m4'],
  picks: { [ID['Pretty Lights']]: ['m1', 'm2', 'm3'], [ID['My Morning Jacket']]: ['m1', 'm4'], [ID['Green Velvet']]: ['m2', 'm4'],
           [ID['Excision']]: ['m3'], [ID['The String Cheese Incident']]: ['m1', 'm3'], [ID['STS9']]: ['m2'] } };
const VOTES = { ok: true, can_vote: true, crews: [{ id: 'c1', n: 'Lionhearts', col: '#FF2D78' }], votes: [{
  id: 'p1', crew_id: 'c1', crew: 'Lionhearts', col: '#FF2D78', q: 'Which sets are we hitting at Hulaween 2026?', max: 3,
  closes: '2026-10-21T23:00:00Z', closed: false, own: false, voters: 4, faves: [], my: null,
  options: [['Pretty Lights', 4], ['My Morning Jacket', 3], ['Green Velvet', 2], ['Excision', 1], ['Levity', 1]].map(([n, v]) => ({ id: ID[n], n, v })) }] };
const WANT = { ok: true, slug: 'hulaween-2026', total_plans: 212, artists: [
  ['Pretty Lights', 48, 9], ['The String Cheese Incident', 41, 6], ['My Morning Jacket', 33, 4], ['Excision', 29, 5], ['Green Velvet', 22, 3]]
  .map(([n, want, gain_7d]) => ({ artist_id: ID[n], name: n, want, gain_7d })) };

function data(extra = {}) {
  const myPicks = extra.picks || ['Pretty Lights', 'Green Velvet', 'My Morning Jacket', 'The String Cheese Incident', 'Excision'];
  delete extra.picks;
  return {
    ravers: [{ id: 'r1', claimed_by: TEST_UID, created_by: TEST_UID, is_you: true, status: 'claimed' }],
    festivals: [{ id: 'f1', slug: 'hulaween-2026', name: 'Hulaween 2026', date: '2026-10-22', deleted_at: null }],
    artists: NAMES.map(n => ({ id: ID[n], name: n, name_lower: n.toLowerCase() })),
    raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }], raver_festival_interest: [],
    raver_artist_plans: myPicks.map(n => ({ raver_id: 'r1', artist_id: ID[n], festival_id: 'f1' })),
    raver_favorite_artists: [{ raver_id: 'r1', artist_id: ID['Pretty Lights'] }],
    raver_clash_choices: [], raver_artist_sightings: [], raver_postfest_checkoffs: [],
    __rpc: { get_lineup_crew_pulse: PULSE, get_lineup_crew_votes: VOTES, get_lineup_want_counts: WANT,
             set_set_reminders: { ok: true, on: true, n: 5 } },
    ...extra,
  };
}
async function go(page, url, when, d, bar = true) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.clock.setFixedTime(new Date(when));
  await installSupabaseStub(page, { session: makeSession(), data: d });
  await page.goto(url);
  if (bar) await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');
  await page.addStyleTag({ content: '.a2hs-btn, .lp-toast, .cta-bar { display: none !important; } *, *::before { animation: none !important; transition: none !important; }' });
  await page.waitForTimeout(400);
}
const HUL = '/lineup-explorer/hulaween-2026.html';

test('picks on the lineup', async ({ page }) => {
  await go(page, HUL, '2026-10-17T22:00:00Z', data());
  await page.locator('.lp-f[data-v="picks"]').click();
  await page.waitForTimeout(300);
  await page.locator('.lp-bar').evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 12));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + 'explorer-picks.png' });
});
test('most wanted', async ({ page }) => {
  await go(page, HUL, '2026-10-17T22:00:00Z', data());
  await page.locator('.lp-mw').screenshot({ path: OUT + 'explorer-mostwanted.png' });
});
test('crew panel', async ({ page }) => {
  await go(page, HUL, '2026-10-17T22:00:00Z', data({ picks: ['Pretty Lights', 'Green Velvet', 'My Morning Jacket', 'Excision', 'STS9'] }));
  await page.locator('.lp-crew').screenshot({ path: OUT + 'explorer-crew.png' });
  await page.locator('.act-cell', { has: page.locator('.pick[data-n="Pretty Lights"]') }).first().screenshot({ path: OUT + 'explorer-card-crew.png' });
});
test('crew vote', async ({ page }) => {
  await go(page, HUL, '2026-10-17T22:00:00Z', data());
  await page.locator('.lp-vote').first().screenshot({ path: OUT + 'explorer-vote.png' });
});
test('schedule clash', async ({ page }) => {
  await go(page, HUL + '?view=schedule', '2026-10-19T18:00:00Z', data({ picks: ['The String Cheese Incident', 'Kasablanca', 'Pretty Lights', 'Green Velvet', 'Mountain Grass Unit'] }));
  await page.locator('.lp-sched-days .lp-crew-chip', { hasText: 'Sat' }).click();
  await expect(page.locator('.lp-clash')).toHaveCount(1);
  await page.locator('.lp-sched').screenshot({ path: OUT + 'explorer-schedule.png' });
});
test('on deck', async ({ page }) => {
  await go(page, HUL, '2026-10-25T03:40:00Z', data({
    picks: ['Pretty Lights', 'Green Velvet', 'Mountain Grass Unit', 'Levity'],
    raver_clash_choices: [{ raver_id: 'r1', festival_id: 'f1', choices: { 'Green Velvet|Pretty Lights': 'Pretty Lights' } }],
    set_reminder_optins: [{ user_id: TEST_UID, festival_id: 'f1' }] }));
  await expect(page.locator('.lp-now')).toBeVisible();
  await page.locator('.lp-now').screenshot({ path: OUT + 'explorer-ondeck.png' });
});
test('check-off', async ({ page }) => {
  await go(page, HUL, '2026-10-26T15:00:00Z', data({ raver_artist_sightings: [{ raver_id: 'r1', artist_id: ID['Pretty Lights'], festival_id: 'f1' }],
    __rpc: { get_lineup_set_times: { ok: true, tz: 'America/New_York', date: '2026-10-22', days: 4, sets: [] }, get_lineup_crew_pulse: PULSE } }));
  await expect(page.locator('.lp-check')).toBeVisible();
  await page.locator('.lp-check').screenshot({ path: OUT + 'explorer-checkoff.png' });
});
test('artist page', async ({ page }) => {
  await go(page, '/lineup-explorer/artist/pretty-lights.html', '2026-10-17T22:00:00Z', data({ __rpc: { get_artist_member_info: {
    ok: true, artist_id: 1, fav: true, seen: 3, my_plans: ['hulaween-2026'],
    crew: [{ n: 'Sam', slug: 'hulaween-2026' }, { n: 'Kai', slug: 'hulaween-2026' }, { n: 'Jess', slug: 'hulaween-2026' }] } } }), false);
  await expect(page.locator('#arMember')).toBeVisible();
  await page.screenshot({ path: OUT + 'artist-page.png' });
});
test('app: rave check-off + alert settings', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T15:00:00'));
  const d = seedData();
  d.festivals.push({ id: 'f-hul', name: 'Hulaween 2026', date: '2026-10-22', location: 'Live Oak, FL', color: '#FF8A3C', days: 4, deleted_at: null, slug: 'hulaween-2026' });
  d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-hul' });
  d.artists.push(...['Pretty Lights', 'My Morning Jacket', 'Green Velvet', 'Excision'].map(n => ({ id: 'h' + ID[n], name: n, genres: [] })));
  d.artist_festival_appearances = ['Pretty Lights', 'My Morning Jacket', 'Green Velvet', 'Excision'].map(n => ({ artist_id: 'h' + ID[n], festival_id: 'f-hul' }));
  d.raver_artist_plans = ['Pretty Lights', 'My Morning Jacket', 'Green Velvet', 'Excision'].map(n => ({ raver_id: 'r-you', artist_id: 'h' + ID[n], festival_id: 'f-hul' }));
  d.raver_artist_sightings = [{ raver_id: 'r-you', artist_id: 'h' + ID['Pretty Lights'], festival_id: 'f-hul' }];
  d.raver_postfest_checkoffs = [];
  await bootAuthedApp(page, { data: d });
  await page.addStyleTag({ content: '*, *::before { animation: none !important; transition: none !important; }' });
  await page.evaluate(() => openRaveFocus('f-hul'));
  await expect(page.locator('#lineup-section .postfest-card')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'app-checkoff.png' });
  await page.evaluate(() => { closeRaveFocus(); openPrivacySettingsModal('r-you'); });
  await page.locator('#alert-toggle-postfest').scrollIntoViewIfNeeded();
  await page.locator('#push-settings-toggle').evaluate(e => e.closest('.poll-modal-settings').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  const top = await page.locator('#alert-toggle-artist_added').evaluate(e => e.closest('.poll-setting-row').getBoundingClientRect().top);
  const bot = await page.locator('#alert-toggle-postfest').evaluate(e => e.closest('.poll-setting-row').getBoundingClientRect().bottom);
  await page.screenshot({ path: OUT + 'app-alerts.png', clip: { x: 0, y: top - 14, width: 390, height: bot - top + 28 } });
});
