// Lineup Explorer ☆ picks (LineupPicks in lineup-explorer/lineup-common.js).
// Visitors keep picks in localStorage; members sync them to
// raver_artist_plans after a one-time Going/Interested sheet.
const { test, expect } = require('@playwright/test');
const { installSupabaseStub, collectPageErrors, makeSession, TEST_UID } = require('./helpers');

const PAGE = '/lineup-explorer/edc-orlando-2026.html';
// The hub is served as /lineup-explorer/ in production (index.html).
const SLUG = 'edc-orlando-2026';

async function blockExternal(page) {
  // Fonts, Vercel insights etc. — keep the test hermetic. The Supabase CDN
  // route installed by installSupabaseStub takes precedence (registered later).
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
}

function memberData(extra = {}) {
  return {
    ravers: [{ id: 'r1', claimed_by: TEST_UID, created_by: TEST_UID, is_you: true, status: 'claimed' }],
    festivals: [{ id: 'f1', slug: SLUG, name: 'EDC Orlando 2026', date: '2026-11-06', deleted_at: null }],
    artists: [
      { id: 1, name: 'Kaskade', name_lower: 'kaskade' },
      { id: 2, name: 'Benda', name_lower: 'benda' },
      { id: 3, name: 'Vastive', name_lower: 'vastive' },
    ],
    raver_artist_plans: [],
    raver_festivals: [],
    raver_festival_interest: [],
    ...extra,
  };
}

const star = (page, name) => page.locator(`.pick[data-n="${name}"]`);

test.describe('Lineup Explorer ☆ picks — visitor', () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await installSupabaseStub(page, { session: null, data: {} });
  });

  test('☆ saves to the browser, survives reload, and My picks filters to it', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(PAGE);
    await expect(star(page, 'Kaskade')).toHaveAttribute('aria-pressed', 'false');

    // Tapping ☆ must not follow the card's music-platform link.
    const popups = [];
    page.on('popup', p => popups.push(p));
    await star(page, 'Kaskade').click();
    await expect(star(page, 'Kaskade')).toHaveAttribute('aria-pressed', 'true');
    expect(popups).toHaveLength(0);

    await expect(page.locator('.lp-toast')).toContainText('saved on this device');
    await expect(page.locator('.lp-toast button')).toHaveText('Save to RaveFAM');

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rf_picks')));
    expect(stored[SLUG].n).toEqual(['Kaskade']);
    expect(stored[SLUG].t).toBe('EDC Orlando 2026');

    await page.reload();
    await expect(star(page, 'Kaskade')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.lp-n')).toHaveText('1');
    await expect(page.locator('.lp-days')).toHaveText('SAT 1');

    await page.locator('.lp-f[data-v="picks"]').click();
    await expect(page.locator('#deck .act-wrap')).toHaveCount(1);
    await expect(page.locator('.lp-save')).toBeVisible();
    await expect(page.locator('.lp-save button')).toHaveText('Save my picks');

    // Un-star in My picks view empties it and clears storage.
    await star(page, 'Kaskade').click();
    await expect(page.locator('#deck .act-wrap')).toHaveCount(0);
    expect(await page.evaluate(s => JSON.parse(localStorage.getItem('rf_picks'))[s], SLUG)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('the card link still points at the music platform', async ({ page }) => {
    await page.goto(PAGE);
    const link = page.locator('.act-wrap', { has: star(page, 'Kaskade') }).locator('a.act');
    await expect(link).toHaveAttribute('href', /Kaskade/);
  });

  test('Save my picks records where to return and goes to /app', async ({ page }) => {
    await page.goto(PAGE);
    await star(page, 'Kaskade').click();
    await page.locator('.lp-f[data-v="picks"]').click();
    await Promise.all([
      page.waitForURL(/\/app\?picks=1&from=edc-orlando-2026/),
      page.locator('.lp-save button').click(),
    ]);
    const from = await page.evaluate(() => JSON.parse(localStorage.getItem('rf_picks_from')));
    expect(from.slug).toBe(SLUG);
    expect(from.back).toBe(PAGE);
  });
});

test.describe('Lineup Explorer ☆ picks — member', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  test('first ☆ without an RSVP asks once; Interested saves the RSVP and the plan', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, { session: makeSession(), data: memberData() });
    await page.goto(PAGE);
    // Wait for member state to load (bar re-renders after the queries).
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');

    await star(page, 'Kaskade').click();
    const sheet = page.locator('.lp-overlay.show');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('h3')).toHaveText('Kaskade added to your picks. Are you going to EDC Orlando 2026?');
    await sheet.locator('.lp-int').click();
    await expect(sheet).toBeHidden();

    await expect.poll(() => page.evaluate(() => window.__store.raver_artist_plans.length)).toBe(1);
    const s = await page.evaluate(() => window.__store);
    expect(s.raver_festival_interest).toHaveLength(1);
    expect(s.raver_festival_interest[0]).toMatchObject({ raver_id: 'r1', festival_id: 'f1' });
    expect(s.raver_festivals).toEqual([]);
    expect(s.raver_artist_plans[0]).toMatchObject({ raver_id: 'r1', artist_id: 1, festival_id: 'f1' });
    await expect(page.locator('.lp-toast')).toContainText('1 pick saved');
    // Browser copy is cleared once saved.
    expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('rf_picks') || '{}'))['edc-orlando-2026'])).toBeUndefined();
    await expect(star(page, 'Kaskade')).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });

  test('Just browsing keeps the pick in the browser and does not ask again this visit', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: memberData() });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');
    await star(page, 'Kaskade').click();
    await page.locator('.lp-overlay.show .lp-browse').click();
    await expect(page.locator('.lp-overlay.show')).toHaveCount(0);
    expect(await page.evaluate(() => window.__store.raver_artist_plans.length)).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rf_picks'))['edc-orlando-2026'].n)).toEqual(['Kaskade']);

    await star(page, 'Adventure Club').click();
    await expect(page.locator('.lp-overlay.show')).toHaveCount(0);
    await expect(page.locator('.lp-toast button')).toHaveText('Add to RaveFAM');
  });

  test('a Going member picks and un-picks b2b acts as one plan per artist', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession(),
      data: memberData({ raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }] }),
    });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-rsvp', 'going');

    await star(page, 'Benda b2b Vastive').click();
    await expect(page.locator('.lp-overlay.show')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__store.raver_artist_plans.map(p => p.artist_id).sort())).toEqual([2, 3]);

    await star(page, 'Benda b2b Vastive').click();
    await expect.poll(() => page.evaluate(() => window.__store.raver_artist_plans.length)).toBe(0);
  });

  test('picks made as a visitor sync on the next visit once the member is Going', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession(),
      data: memberData({ raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }] }),
    });
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('rf_picks', JSON.stringify({ 'edc-orlando-2026': { n: ['Kaskade'], t: 'EDC Orlando 2026' } }));
      }
    });
    await page.goto(PAGE);
    await expect.poll(() => page.evaluate(() => window.__store && window.__store.raver_artist_plans.length)).toBe(1);
    await expect(page.locator('.lp-toast')).toContainText('1 pick synced');
  });
});

test.describe('Lineup Explorer hub — Your picks', () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await installSupabaseStub(page, { session: null, data: {} });
  });

  test('shows nothing without picks', async ({ page }) => {
    await page.goto('/lineup-explorer/index.html');
    await expect(page.locator('.event-card:not(.is-past)').first()).toBeVisible();
    await expect(page.locator('.lp-hub')).toHaveCount(0);
    await expect(page.locator('.event-picks')).toHaveCount(0);
  });

  test('lists picks by festival, marks picked cards, and saves from the latest rave', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('rf_picks', JSON.stringify({
        'edc-orlando-2026': { n: ['Kaskade', 'Alesso'], t: 'EDC Orlando 2026', at: '2026-09-02T00:00:00Z' },
        'lights-all-night-2026': { n: ['Tiësto'], t: 'Lights All Night 2026', at: '2026-09-01T00:00:00Z' },
      }));
    });
    await page.goto('/lineup-explorer/index.html');
    const hub = page.locator('.lp-hub');
    await expect(hub).toBeVisible();
    await expect(hub.locator('li')).toHaveCount(2);
    await expect(hub).toContainText('EDC Orlando 2026');
    await expect(page.locator('.event-card[href="/lineup-explorer/edc-orlando-2026"] .event-picks')).toHaveText('☆ 2 picks: Kaskade, Alesso');
    await Promise.all([
      page.waitForURL(/\/app\?picks=1&from=edc-orlando-2026/),
      hub.getByRole('button', { name: 'Save my picks' }).click(),
    ]);
  });
});
