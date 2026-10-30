// Captures the EDC Orlando campaign screenshots with real set times and demo crew data. To re-run: copy into tests/ (it uses ./helpers) and run with --project=chromium.
// (marketing/edc-orlando-2026/_build/shots). Not part of the suite.
const { test, expect } = require('@playwright/test');
const { installSupabaseStub, makeSession, TEST_UID } = require('./helpers');
const SETS = require('../marketing/edc-orlando-2026/_build/set-times.js');
const OUT = 'marketing/edc-orlando-2026/_build/shots/';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } });

const NAMES = ['Kaskade', 'Alison Wonderland', 'Alan Walker', 'Steve Aoki', 'Skull Machine', 'Martin Garrix', 'TroyBoi',
  'Hardwell', 'ATLiens', 'Boogie T', 'Levity', 'Wooli', 'David Guetta', 'Mau P', 'Adventure Club', 'SLANDER', 'San Holo', 'Meduza'];
const ID = Object.fromEntries(NAMES.map((n, i) => [n, i + 1]));
const PULSE = { ok: true, crews: [{ id: 'c1', n: 'Lionhearts', col: '#FF2D78' }],
  mates: { m1: { n: 'Sam', s: 'going', u: false, c: ['c1'] }, m2: { n: 'Kai', s: 'going', u: false, c: ['c1'] },
           m3: { n: 'Jess', s: 'going', u: false, c: ['c1'] }, m4: { n: 'Theo', s: 'interested', u: false, c: ['c1'] } },
  going: ['m1', 'm2', 'm3'], interested: ['m4'],
  picks: { [ID['Kaskade']]: ['m1', 'm2', 'm3'], [ID['Martin Garrix']]: ['m1', 'm4'], [ID['Alison Wonderland']]: ['m2', 'm3'],
           [ID['Levity']]: ['m3'], [ID['Wooli']]: ['m2', 'm3'], [ID['ATLiens']]: ['m2'] } };
const VOTES = { ok: true, can_vote: true, crews: [{ id: 'c1', n: 'Lionhearts', col: '#FF2D78' }], votes: [{
  id: 'p1', crew_id: 'c1', crew: 'Lionhearts', col: '#FF2D78', q: 'Sunday closer: who are we ending EDC on?', max: 1,
  closes: '2026-11-05T23:00:00Z', closed: false, own: false, voters: 4, faves: [], my: null,
  options: [['Martin Garrix', 2], ['TroyBoi', 1], ['Holy Priest', 1]].map(([n, v]) => ({ id: ID[n] || 99, n, v })) }] };

function data(extra = {}) {
  const myPicks = extra.picks || ['Kaskade', 'Alison Wonderland', 'Levity', 'Wooli', 'Martin Garrix', 'ATLiens'];
  delete extra.picks;
  return {
    ravers: [{ id: 'r1', claimed_by: TEST_UID, created_by: TEST_UID, is_you: true, status: 'claimed' }],
    festivals: [{ id: 'f1', slug: 'edc-orlando-2026', name: 'EDC Orlando 2026', date: '2026-11-06', deleted_at: null }],
    artists: NAMES.map(n => ({ id: ID[n], name: n, name_lower: n.toLowerCase() })),
    raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }], raver_festival_interest: [],
    raver_artist_plans: myPicks.map(n => ({ raver_id: 'r1', artist_id: ID[n], festival_id: 'f1' })),
    raver_favorite_artists: [{ raver_id: 'r1', artist_id: ID['Kaskade'] }],
    raver_clash_choices: [], raver_artist_sightings: [], raver_postfest_checkoffs: [],
    __rpc: { get_lineup_crew_pulse: PULSE, get_lineup_crew_votes: VOTES, get_lineup_set_times: SETS,
             get_lineup_want_counts: { ok: true, slug: 'edc-orlando-2026', total_plans: 0, artists: [] },
             set_set_reminders: { ok: true, on: true, n: 6 } },
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
  await page.waitForTimeout(500);
}
const EDC = '/lineup-explorer/edc-orlando-2026.html';
const NOW = '2026-10-30T22:00:00Z';

test('lineup with set times', async ({ page }) => {
  await go(page, EDC, NOW, data());
  await page.locator('.lp-bar').evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 12));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + 'explorer-lineup.png' });
});
test('crew panel', async ({ page }) => {
  await go(page, EDC, NOW, data());
  await page.locator('.lp-crew').screenshot({ path: OUT + 'explorer-crew.png' });
});
test('schedule clash', async ({ page }) => {
  await go(page, EDC + '?view=schedule', NOW, data({ picks: ['Alan Walker', 'Steve Aoki', 'Kaskade', 'Alison Wonderland'] }));
  await expect(page.locator('.lp-clash')).toHaveCount(1);
  await page.locator('.lp-sched').screenshot({ path: OUT + 'explorer-schedule.png' });
});
test('on deck', async ({ page }) => {
  await go(page, EDC, '2026-11-09T02:22:00Z', data({
    picks: ['Hardwell', 'ATLiens', 'Martin Garrix', 'Boogie T'],
    raver_clash_choices: [{ raver_id: 'r1', festival_id: 'f1', choices: { 'ATLiens|Hardwell': 'split' } }],
    set_reminder_optins: [{ user_id: TEST_UID, festival_id: 'f1' }] }));
  await expect(page.locator('.lp-now')).toBeVisible();
  await page.locator('.lp-now').screenshot({ path: OUT + 'explorer-ondeck.png' });
});
