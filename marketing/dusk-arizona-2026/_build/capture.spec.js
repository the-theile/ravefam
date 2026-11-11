// Captures the DUSK Arizona campaign screenshots with demo data. To re-run: copy into tests/ (it uses ./helpers) and run with --project=chromium.
// (marketing/dusk-arizona-2026/_build/shots). Not part of the suite. Set times weren't out when this ran, so no set-time screens.
const { test, expect } = require('@playwright/test');
const { installSupabaseStub, makeSession, TEST_UID } = require('./helpers');
const OUT = 'marketing/dusk-arizona-2026/_build/shots/';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {} });

const NAMES = ['Knock2', 'Fetty Wap', 'BigXthaPlug', 'Horsegiirl', 'Phantogram', '54 Ultra', 'Sudan Archives',
  'HOL!', 'Ship Wrek', 'The Aces', 'Avello', 'LaVern'];
const ID = Object.fromEntries(NAMES.map((n, i) => [n, i + 1]));
const PULSE = { ok: true, crews: [{ id: 'c1', n: 'Desert Rats', col: '#FF2D78' }],
  mates: { m1: { n: 'Sam', s: 'going', u: false, c: ['c1'] }, m2: { n: 'Kai', s: 'going', u: false, c: ['c1'] },
           m3: { n: 'Jess', s: 'going', u: false, c: ['c1'] }, m4: { n: 'Theo', s: 'interested', u: false, c: ['c1'] } },
  going: ['m1', 'm2', 'm3'], interested: ['m4'],
  picks: { [ID['Knock2']]: ['m1', 'm2', 'm3'], [ID['BigXthaPlug']]: ['m1', 'm4'], [ID['Horsegiirl']]: ['m2', 'm4'],
           [ID['HOL!']]: ['m3'], [ID['Phantogram']]: ['m1', 'm3'], [ID['Ship Wrek']]: ['m2'] } };
const VOTES = { ok: true, can_vote: true, crews: [{ id: 'c1', n: 'Desert Rats', col: '#FF2D78' }], votes: [{
  id: 'p1', crew_id: 'c1', crew: 'Desert Rats', col: '#FF2D78', q: 'Which sets are we hitting at DUSK Arizona 2026?', max: 3,
  closes: '2026-11-13T21:00:00Z', closed: false, own: false, voters: 4, faves: [], my: null,
  options: [['Knock2', 4], ['BigXthaPlug', 3], ['Horsegiirl', 2], ['Phantogram', 2], ['HOL!', 1]].map(([n, v]) => ({ id: ID[n], n, v })) }] };
const WANT = { ok: true, slug: 'dusk-arizona-2026', total_plans: 164, artists: [
  ['Knock2', 41, 9], ['BigXthaPlug', 37, 8], ['Horsegiirl', 26, 5], ['Phantogram', 22, 3], ['HOL!', 18, 4]]
  .map(([n, want, gain_7d]) => ({ artist_id: ID[n], name: n, want, gain_7d })) };
const NO_TIMES = { ok: true, tz: 'America/Phoenix', date: '2026-11-13', days: 2, sets: [] };

function data(extra = {}) {
  const myPicks = extra.picks || ['Knock2', 'BigXthaPlug', 'Horsegiirl', 'Phantogram', 'HOL!'];
  delete extra.picks;
  const rpc = extra.__rpc || {};
  delete extra.__rpc;
  return {
    ravers: [{ id: 'r1', claimed_by: TEST_UID, created_by: TEST_UID, is_you: true, status: 'claimed' }],
    festivals: [{ id: 'f1', slug: 'dusk-arizona-2026', name: 'DUSK Arizona 2026', date: '2026-11-13', deleted_at: null }],
    artists: NAMES.map(n => ({ id: ID[n], name: n, name_lower: n.toLowerCase() })),
    raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }], raver_festival_interest: [],
    raver_artist_plans: myPicks.map(n => ({ raver_id: 'r1', artist_id: ID[n], festival_id: 'f1' })),
    raver_favorite_artists: [{ raver_id: 'r1', artist_id: ID['Knock2'] }],
    raver_clash_choices: [], raver_artist_sightings: [], raver_postfest_checkoffs: [],
    __rpc: { get_lineup_crew_pulse: PULSE, get_lineup_crew_votes: VOTES, get_lineup_want_counts: WANT,
             get_lineup_set_times: NO_TIMES, ...rpc },
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
const DUSK = '/lineup-explorer/dusk-arizona-2026.html';
const WHEN = '2026-11-11T22:00:00Z';

test('hero', async ({ page }) => {
  await go(page, DUSK, WHEN, data());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: OUT + 'explorer-hero.png' });
});
test('day split', async ({ page }) => {
  await go(page, DUSK, WHEN, data());
  await page.locator('#nights .night[data-key="fri"]').click();
  await page.waitForTimeout(300);
  await page.locator('#nights').evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 40));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + 'explorer-fri.png' });
});
test('picks on the lineup', async ({ page }) => {
  await go(page, DUSK, WHEN, data());
  await page.locator('.lp-f[data-v="picks"]').click();
  await page.waitForTimeout(300);
  await page.locator('.lp-bar').evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 12));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + 'explorer-picks.png' });
});
test('most wanted', async ({ page }) => {
  await go(page, DUSK, WHEN, data());
  await page.locator('.lp-mw').screenshot({ path: OUT + 'explorer-mostwanted.png' });
});
test('crew panel', async ({ page }) => {
  await go(page, DUSK, WHEN, data({ picks: ['Knock2', 'BigXthaPlug', 'Horsegiirl', 'HOL!', 'Ship Wrek'] }));
  await page.locator('.lp-crew').screenshot({ path: OUT + 'explorer-crew.png' });
});
test('crew vote', async ({ page }) => {
  await go(page, DUSK, WHEN, data());
  await page.locator('.lp-vote').first().screenshot({ path: OUT + 'explorer-vote.png' });
});
test('check-off', async ({ page }) => {
  await go(page, DUSK, '2026-11-15T17:00:00Z', data({ raver_artist_sightings: [{ raver_id: 'r1', artist_id: ID['Knock2'], festival_id: 'f1' }] }));
  await expect(page.locator('.lp-check')).toBeVisible();
  await page.locator('.lp-check').screenshot({ path: OUT + 'explorer-checkoff.png' });
});
test('artist page', async ({ page }) => {
  await go(page, '/lineup-explorer/artist/knock2.html', WHEN, data({ __rpc: { get_artist_member_info: {
    ok: true, artist_id: 1, fav: true, seen: 2, my_plans: ['dusk-arizona-2026'],
    crew: [{ n: 'Sam', slug: 'dusk-arizona-2026' }, { n: 'Kai', slug: 'dusk-arizona-2026' }, { n: 'Jess', slug: 'dusk-arizona-2026' }] } } }), false);
  await expect(page.locator('#arMember')).toBeVisible();
  await page.screenshot({ path: OUT + 'artist-page.png' });
});
// app-alerts.png is reused from marketing/hulaween-2026/_build/shots (the alert settings aren't festival-specific).
