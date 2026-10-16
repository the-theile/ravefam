// Captures the III Points campaign screenshots with demo data. To re-run: copy into tests/ (it uses ./helpers) and run with --project=chromium.
// (marketing/iii-points-2026/_build/shots). Not part of the suite.
const { test, expect } = require('@playwright/test');
const { installSupabaseStub, bootAuthedApp, seedData, makeSession, TEST_UID } = require('./helpers');
const OUT = 'marketing/iii-points-2026/_build/shots/';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

const NAMES = ['Underworld', 'Four Tet', 'Flying Lotus', 'Blood Orange', 'Kelela', 'Charlotte de Witte', 'Honey Dijon', 'Floating Points', 'PAWSA', 'Parcels'];
const ID = Object.fromEntries(NAMES.map((n, i) => [n, i + 1]));
const PULSE = { ok: true, crews: [{ id: 'c1', n: 'Bass Syndicate', col: '#FF2D78' }],
  mates: { m1: { n: 'Sam', s: 'going', u: false, c: ['c1'] }, m2: { n: 'Kai', s: 'going', u: false, c: ['c1'] },
           m3: { n: 'Jess', s: 'going', u: false, c: ['c1'] }, m4: { n: 'Theo', s: 'interested', u: false, c: ['c1'] } },
  going: ['m1', 'm2', 'm3'], interested: ['m4'],
  picks: { [ID['Four Tet']]: ['m1', 'm2', 'm3'], [ID['Underworld']]: ['m1', 'm4'], [ID['Charlotte de Witte']]: ['m2', 'm3'],
           [ID['Flying Lotus']]: ['m3'], [ID['Honey Dijon']]: ['m1'] } };
const WANT = { ok: true, slug: 'iii-points-2026', total_plans: 184, artists: [
  ['Four Tet', 44, 8], ['Underworld', 39, 6], ['Charlotte de Witte', 31, 5], ['Flying Lotus', 27, 4], ['Honey Dijon', 19, 3]]
  .map(([n, want, gain_7d]) => ({ artist_id: ID[n], name: n, want, gain_7d })) };

test('explorer picks', async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.clock.setFixedTime(new Date('2026-10-15T22:00:00Z'));
  await installSupabaseStub(page, { session: makeSession(), data: {
    ravers: [{ id: 'r1', claimed_by: TEST_UID, created_by: TEST_UID, is_you: true, status: 'claimed' }],
    festivals: [{ id: 'f1', slug: 'iii-points-2026', name: 'III Points 2026', date: '2026-10-16', deleted_at: null }],
    artists: NAMES.map(n => ({ id: ID[n], name: n, name_lower: n.toLowerCase() })),
    raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }], raver_festival_interest: [],
    raver_artist_plans: ['Four Tet', 'Underworld', 'Charlotte de Witte', 'Flying Lotus', 'Kelela'].map(n => ({ raver_id: 'r1', artist_id: ID[n], festival_id: 'f1' })),
    raver_favorite_artists: [{ raver_id: 'r1', artist_id: ID['Four Tet'] }],
    raver_clash_choices: [], raver_artist_sightings: [], raver_postfest_checkoffs: [],
    __rpc: { get_lineup_crew_pulse: PULSE, get_lineup_want_counts: WANT, get_lineup_crew_votes: { ok: true, can_vote: true, crews: [], votes: [] } } } });
  await page.goto('/lineup-explorer/iii-points-2026.html');
  await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');
  await page.addStyleTag({ content: '.a2hs-btn, .lp-toast, .cta-bar { display: none !important; } *, *::before { animation: none !important; transition: none !important; }' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + 'explorer-top.png' });
  await page.locator('.lp-f[data-v="picks"]').click();
  await page.waitForTimeout(300);
  await page.locator('.lp-bar').evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 12));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + 'explorer-picks.png' });
});

function appData() {
  const d = seedData();
  d.festivals[0] = { id: 'f1', name: 'III Points 2026', date: '2026-10-16', location: 'Miami, FL', color: '#FF2D78', days: 2, deleted_at: null, slug: 'iii-points-2026' };
  d.raver_festivals.push({ raver_id: 'r-kai', festival_id: 'f1' });
  d.game_plans = [{ id: 'gp1', crew_id: 'c1', festival_id: 'f1', created_at: '2026-09-01T00:00:00Z' }];
  const t = (id, text, who, done) => ({ id, game_plan_id: 'gp1', crew_id: 'c1', kind: 'task', added_by: TEST_UID, text, assignee_raver_id: who, is_done: done, created_at: '2026-09-0' + id.slice(-1) + 'T00:00:00Z', deleted_at: null });
  d.game_plan_items = [t('t1', 'Buy GA+ wristbands', 'r-you', true), t('t2', 'Book the Wynwood Airbnb', 'r-kai', true),
    t('t3', 'Pick a meetup spot at Mana', 'r-sam', true), t('t4', 'Charge the portable batteries', 'r-you', false), t('t5', 'Hydration packs + earplugs', 'r-kai', false),
    { id: 'ro1', game_plan_id: 'gp1', crew_id: 'c1', kind: 'role', added_by: TEST_UID, text: 'Driver / DD', assignee_raver_id: 'r-sam', created_at: '2026-09-02T00:00:00Z', deleted_at: null }];
  return d;
}
test('app: rave RSVP', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T20:00:00'));
  await bootAuthedApp(page, { data: appData() });
  await page.addStyleTag({ content: '*, *::before { animation: none !important; transition: none !important; }' });
  await page.evaluate(() => openRaveFocus('f1'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + 'app-rave.png' });
});
test('app: game plan checklist', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T20:00:00'));
  await bootAuthedApp(page, { data: appData() });
  await page.addStyleTag({ content: '*, *::before { animation: none !important; transition: none !important; }' });
  await page.evaluate(async () => { await openDetail('c1', { tab: 'gameplan' }); });
  await expect(page.locator('#crew-feature-panel-raveplan')).toBeVisible();
  await page.evaluate(async () => switchGamePlanSection('checklist', document.querySelector('.game-plan-section-tab[data-section="checklist"]')));
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: 'header, nav, .bottom-nav, .app-header, [class*="toast"] { visibility: hidden !important; }' });
  await page.waitForTimeout(200);
  await page.locator('#game-plan-section-checklist').screenshot({ path: OUT + 'app-gameplan.png' });
});
