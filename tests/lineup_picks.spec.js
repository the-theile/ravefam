// Lineup Explorer 📋 picks (LineupPicks in lineup-explorer/lineup-common.js).
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

test.describe('Lineup Explorer 📋 picks — visitor', () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await installSupabaseStub(page, { session: null, data: {} });
  });

  test('📋 saves to the browser, survives reload, and My picks filters to it', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(PAGE);
    await expect(star(page, 'Kaskade')).toHaveAttribute('aria-pressed', 'false');

    // Tapping 📋 must not follow the card's music-platform link.
    const popups = [];
    page.on('popup', p => popups.push(p));
    await star(page, 'Kaskade').click();
    await expect(star(page, 'Kaskade')).toHaveAttribute('aria-pressed', 'true');
    expect(popups).toHaveLength(0);

    await expect(page.locator('.lp-toast')).toContainText('added to your picks on this device');
    // 📋 toggle: outline clipboard off, filled clipboard with a ✓ on.
    await expect(star(page, 'Kaskade').locator('rect[fill="currentColor"]')).toHaveCount(1);
    await expect(star(page, 'Alesso').locator('rect[fill="currentColor"]')).toHaveCount(0);
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

test.describe('Lineup Explorer 📋 picks — member', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  test('first 📋 without an RSVP asks once; Interested saves the RSVP and the plan', async ({ page }) => {
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
    await expect(page.locator('.event-card[href="/lineup-explorer/edc-orlando-2026"] .event-picks')).toHaveText('📋 2 picks: Kaskade, Alesso');
    await Promise.all([
      page.waitForURL(/\/app\?picks=1&from=edc-orlando-2026/),
      hub.getByRole('button', { name: 'Save my picks' }).click(),
    ]);
  });
});

test.describe('Lineup Explorer 1b — ♡ favorites and Pulse', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  function pulseData(extra = {}) {
    return memberData({
      raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }],
      raver_favorite_artists: [{ raver_id: 'r1', artist_id: 1 }],
      __rpc: {
        get_lineup_want_counts: { ok: true, slug: SLUG, total_plans: 40, artists: [
          { artist_id: 1, name: 'Kaskade', want: 12, gain_7d: 3 },
          { artist_id: 9, name: 'Alesso', want: 6, gain_7d: 0 },
        ] },
        get_lineup_crew_pulse: { ok: true,
          crews: [{ id: 'c1', n: 'Bass Syndicate', col: '#FF2D78' }],
          mates: { m1: { n: 'Sam', a: null, g: null, s: 'going', u: false, c: ['c1'] },
                   m2: { n: 'Kai', a: null, g: null, s: 'going', u: false, c: ['c1'] } },
          going: ['m1', 'm2'], interested: [], picks: { 1: ['m1', 'm2'] } },
      },
      ...extra,
    });
  }

  test('visitors see public want counts but no ♡', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: pulseData() });
    await page.goto(PAGE);
    const card = page.locator('.act-wrap', { has: star(page, 'Kaskade') });
    await expect(card.locator('.lp-want')).toHaveText('12 want to see · +3 this week');
    await expect(card.locator('.lp-heat')).toHaveCount(0);
    await expect(page.locator('.fav')).toHaveCount(0);
    await expect(page.locator('.lp-f[data-v="favs"]')).toBeHidden();
  });

  test('members see ♡, heat, crew faces and the header line', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: pulseData() });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');
    const card = page.locator('.act-wrap', { has: star(page, 'Kaskade') });
    await expect(card.locator('.fav')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.lp-heat i')).toHaveAttribute('style', /width: 100%/);
    await expect(page.locator('.act-cell', { has: star(page, 'Kaskade') }).locator('.lp-tray-btn')).toHaveAttribute('aria-label', 'Sam, Kai from your crew picked Kaskade');
    await expect(page.locator('.lp-meta')).toHaveText('1 of your favorites plays here · 2 crew going');

    await page.locator('.lp-f[data-v="favs"]').click();
    await expect(page.locator('#deck .act-wrap')).toHaveCount(1);
  });

  test('♡ toggles raver_favorite_artists', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: pulseData({ raver_favorite_artists: [] }) });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');
    const heart = page.locator('.fav[data-n="Benda b2b Vastive"]');
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.__store.raver_favorite_artists.map(f => f.artist_id).sort())).toEqual([2, 3]);
    await expect(page.locator('.lp-toast')).toContainText('added to your favorites');
    await page.locator('.fav[data-n="Benda b2b Vastive"]').click();
    await expect.poll(() => page.evaluate(() => window.__store.raver_favorite_artists.length)).toBe(0);
  });

  test('🔥 Most wanted sorts the deck by want count', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: pulseData() });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');
    await page.locator('.lp-sort').click();
    await expect(page.locator('.lp-sort')).toHaveAttribute('aria-pressed', 'true');
    const firstTwo = await page.locator('#deck .pick').evaluateAll(els => els.slice(0, 2).map(e => e.dataset.n));
    expect(firstTwo).toEqual(['Kaskade', 'Alesso']);
    // Still sorted after the page re-renders for a day filter.
    await page.locator('.night[data-key="sat"]').click();
    await expect(page.locator('#deck .pick').first()).toHaveAttribute('data-n', 'Kaskade');
  });
});

test.describe('Lineup Explorer hub — members (For You)', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  test('shows Your season, artists on tour and card badges', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession(),
      data: memberData({
        raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }],
        raver_artist_plans: [{ raver_id: 'r1', artist_id: 1, festival_id: 'f1' }],
        raver_favorite_artists: [{ raver_id: 'r1', artist_id: 1 }],
      }),
    });
    await page.goto('/lineup-explorer/index.html');
    const fy = page.locator('.lp-foryou');
    await expect(fy).toBeVisible();
    const row = fy.locator('.lp-season li');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.lp-b')).toHaveText('Going');
    await expect(row.locator('.lp-season-name')).toHaveText('EDC Orlando 2026');
    await expect(row.locator('.lp-season-meta')).toContainText('📋 1 · ♡ 1');
    await expect(row.locator('.lp-season-open')).toHaveAttribute('href', '/app?rave=edc-orlando-2026');

    const chip = fy.locator('.lp-tour-chip', { hasText: 'Kaskade' });
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(fy.locator('.lp-tour-list a', { hasText: 'EDC Orlando 2026' })).toHaveAttribute('href', '/lineup-explorer/edc-orlando-2026?q=Kaskade');

    const badges = page.locator('.event-card[href="/lineup-explorer/edc-orlando-2026"] .lp-badges');
    await expect(badges.locator('.lp-b-going')).toHaveText('🎟️ Going');
    await expect(badges.locator('.lp-b-picks')).toHaveText('📋 1 pick');
    await expect(badges.locator('.lp-b-fav')).toHaveText('♡ 1 favorite playing: Kaskade');
  });
});

test.describe('Lineup Explorer header — account button', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  test('visitors get Log in, which opens /app', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: {} });
    await page.goto(PAGE);
    const btn = page.locator('.brandbar .lp-account');
    await expect(btn).toHaveText('Log in');
    await Promise.all([page.waitForURL(/\/app$/), btn.click()]);
  });

  test('with 📋 picks, Log in carries them into the handoff', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: {} });
    await page.goto(PAGE);
    await star(page, 'Kaskade').click();
    await Promise.all([
      page.waitForURL(/\/app\?picks=1&from=edc-orlando-2026/),
      page.locator('.brandbar .lp-account').click(),
    ]);
  });

  test('members get My RaveFAM, on lineup pages and the hub', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: memberData() });
    await page.goto(PAGE);
    await expect(page.locator('.brandbar .lp-account')).toHaveText('My RaveFAM');
    await expect(page.locator('.brandbar .lp-account')).toHaveAttribute('href', '/app');
    await page.goto('/lineup-explorer/index.html');
    await expect(page.locator('.brandbar .lp-account')).toHaveText('My RaveFAM');
  });
});


test.describe('Lineup Explorer 2a — crew layer', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  function crewData(extra = {}) {
    return memberData({
      raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }],
      raver_artist_plans: [{ raver_id: 'r1', artist_id: 1, festival_id: 'f1' }],
      __rpc: {
        get_lineup_crew_pulse: { ok: true,
          crews: [{ id: 'c1', n: 'Bass Syndicate', col: '#FF2D78' }, { id: 'c2', n: 'Tech Heads', col: '#00F5FF' }],
          mates: {
            m1: { n: 'Sam', s: 'going', u: false, c: ['c1'] },
            m2: { n: 'Kai', s: 'interested', u: false, c: ['c2'] },
            m3: { n: 'Jo', s: 'going', u: true, c: ['c1'], inv: true },
            m4: { n: 'Lee', s: 'going', u: true, c: ['c2'], inv: false },
          },
          going: ['m1', 'm3', 'm4'], interested: ['m2'],
          picks: { 1: ['m1'], 2: ['m2'], 3: ['m2'] } },
      },
      ...extra,
    });
  }

  test('panel shows who is here, the overlap, and switches crews', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, { session: makeSession(), data: crewData() });
    await page.goto(PAGE);
    const panel = page.locator('.lp-crew');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.lp-crew-sum')).toHaveText('3 going · 1 interested');
    await expect(panel.locator('.lp-crew-mate')).toHaveCount(4);
    await expect(panel.locator('.lp-face.is-unclaimed')).toHaveCount(2);
    await expect(panel.locator('.lp-crew-overlap')).toHaveText('📋 You and your crew both picked: Kaskade');

    await panel.getByRole('button', { name: 'Tech Heads' }).click();
    await expect(panel.locator('.lp-crew-sum')).toHaveText('1 going · 1 interested');
    await expect(panel.locator('.lp-crew-overlap')).toHaveCount(0);
    // Kaskade's tray only showed Sam (Bass Syndicate) → gone under Tech Heads.
    await expect(page.locator('.act-cell', { has: page.locator('.pick[data-n="Kaskade"]') }).locator('.lp-tray')).toHaveCount(0);
    await expect(page.locator('.act-cell', { has: page.locator('.pick[data-n="Benda b2b Vastive"]') }).locator('.lp-tray-btn')).toContainText('1 crew · Kai');
    expect(errors).toEqual([]);
  });

  test('unclaimed crewmates offer a claim link only when you can send one', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: crewData() });
    await page.goto(PAGE);
    const jo = page.getByRole('button', { name: 'Jo, Going, not on RaveFAM yet' });
    await jo.click();
    await expect(page.getByRole('link', { name: 'Send claim link' })).toHaveAttribute('href', '/app?invite=m3');
    const lee = page.getByRole('button', { name: 'Lee, Going, not on RaveFAM yet' });
    await lee.click();
    await expect(lee.locator('xpath=following-sibling::span[contains(@class,"lp-crew-pop")]')).toContainText('Your crew leader can send them a claim link.');
  });

  test('Crew picks filter and the tray list', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: crewData() });
    await page.goto(PAGE);
    await expect(page.locator('.lp-f[data-v="crew"] .lp-nc')).toHaveText('2');
    await page.locator('.lp-f[data-v="crew"]').click();
    await expect(page.locator('#deck .act-wrap')).toHaveCount(2);
    const tray = page.locator('.act-cell', { has: page.locator('.pick[data-n="Kaskade"]') }).locator('.lp-tray');
    await tray.locator('.lp-tray-btn').click();
    await expect(tray.locator('.lp-tray-btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(tray.locator('.lp-tray-list li')).toHaveText(['SSam · Going']);
  });

  test('no crew here → no panel and no Crew picks filter', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: memberData({ raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }] }) });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-rsvp', 'going');
    await expect(page.locator('.lp-crew')).toBeHidden();
    await expect(page.locator('.lp-f[data-v="crew"]')).toBeHidden();
  });
});

test.describe('Lineup Explorer 2b — sharing', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  const SHARED = { ok: true, slug: SLUG, festival: 'EDC Orlando 2026', first_name: 'Jo', artists: ['Benda', 'Kaskade', 'Vastive'] };

  test('a shared link shows the banner, the filter and matching picks to a visitor', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, { session: null, data: { __rpc: { get_shared_lineup: SHARED } } });
    await page.goto(PAGE + '?by=jo-0a1b2c3d4e');
    const banner = page.locator('.lp-sharebanner');
    await expect(banner).toContainText('📋 Jo shared their picks (2).');
    const filter = page.locator('.lp-f[data-v="shared"]');
    await expect(filter).toBeVisible();
    await expect(filter).toContainText("Jo's picks");
    await filter.click();
    await expect(page.locator('#deck .act-wrap')).toHaveCount(2);
    const kaskade = page.locator('.act-wrap', { has: star(page, 'Kaskade') });
    await expect(kaskade.locator('.lp-shared')).toHaveText('📋 Jo picked this');
    await star(page, 'Kaskade').click();
    await expect(page.locator('.act-wrap', { has: star(page, 'Kaskade') }).locator('.lp-shared')).toHaveText('📋 You both picked this');
    // Join goes through the picks handoff when the visitor has picks.
    await Promise.all([
      page.waitForURL(/\/app\?picks=1&from=edc-orlando-2026/),
      banner.getByRole('button', { name: 'Join Jo on RaveFAM' }).click(),
    ]);
    expect(errors).toEqual([]);
  });

  test('a turned-off or expired link says so', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: { __rpc: { get_shared_lineup: { ok: false, error: 'expired' } } } });
    await page.goto(PAGE + '?by=jo-0a1b2c3d4e');
    await expect(page.locator('.lp-sharebanner')).toHaveText('This shared lineup was turned off or has expired.');
    await expect(page.locator('.lp-f[data-v="shared"]')).toBeHidden();
  });

  test('owners get a link, can post it to a crew Huddle, and can turn it off', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, {
      session: makeSession(),
      data: memberData({
        raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }],
        raver_artist_plans: [{ raver_id: 'r1', artist_id: 1, festival_id: 'f1' }],
        crews: [{ id: 'c1', name: 'Bass Syndicate', deleted_at: null }],
        huddle_rooms: [], huddle_messages: [],
        __rpc: {
          get_or_create_share_link: { ok: true, token: 'te-0a1b2c3d4e' },
          turn_off_share_link: { ok: true },
        },
      }),
    });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-rsvp', 'going');
    await page.locator('.lp-share').click();
    const sheet = page.locator('.lp-share-overlay.show');
    await expect(sheet.locator('#lpShareTitle')).toHaveText('Share your EDC Orlando 2026 picks');
    await expect(sheet.locator('input')).toHaveValue(/\/lineup-explorer\/edc-orlando-2026\?by=te-0a1b2c3d4e$/);

    const crewBtn = sheet.getByRole('button', { name: '💬 Bass Syndicate' });
    await crewBtn.click();
    await expect(sheet.getByRole('button', { name: '✅ Posted to Bass Syndicate' })).toBeVisible();
    const msgs = await page.evaluate(() => window.__store.huddle_messages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ crew_id: 'c1', kind: 'lineup', body: '📋 My picks for EDC Orlando 2026: Kaskade' });
    expect(msgs[0].media_url).toMatch(/\?by=te-0a1b2c3d4e$/);
    const rooms = await page.evaluate(() => window.__store.huddle_rooms);
    expect(rooms[0]).toMatchObject({ crew_id: 'c1', room_key: 'festival:f1', kind: 'festival' });

    await sheet.getByRole('button', { name: 'Turn off this link' }).click();
    await expect(page.locator('.lp-share-overlay.show')).toHaveCount(0);
    await expect(page.locator('.lp-toast')).toContainText('Link turned off');
    expect(errors).toEqual([]);
  });

  test('the Share button needs an RSVP', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: memberData() });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');
    await expect(page.locator('.lp-share')).toBeHidden();
  });
});

test.describe('Lineup Explorer 3a — most wanted', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  function mwData(extra = {}) {
    return memberData({
      artists: [
        { id: 1, name: 'Kaskade', name_lower: 'kaskade' },
        { id: 9, name: 'Alesso', name_lower: 'alesso' },
      ],
      raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }],
      __rpc: {
        get_lineup_want_counts: { ok: true, slug: SLUG, total_plans: 40, artists: [
          { artist_id: 1, name: 'Kaskade', want: 12, gain_7d: 3 },
          { artist_id: 9, name: 'Alesso', want: 6, gain_7d: 0 },
          { artist_id: 99, name: 'Not On This Page', want: 5, gain_7d: 0 },
        ] },
        get_lineup_crew_pulse: { ok: true,
          crews: [{ id: 'c1', n: 'Bass Syndicate', col: '#FF2D78' }],
          mates: { m1: { n: 'Sam', a: null, g: null, s: 'going', u: false, c: ['c1'] },
                   m2: { n: 'Kai', a: null, g: null, s: 'going', u: false, c: ['c1'] } },
          going: ['m1', 'm2'], interested: [], picks: { 1: ['m1', 'm2'] } },
      },
      ...extra,
    });
  }

  test('visitors see the top acts on this page, with a Join prompt', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, { session: null, data: mwData() });
    await page.goto(PAGE);
    const mw = page.locator('.lp-mw');
    await expect(mw).toBeVisible();
    await expect(mw.locator('h2')).toHaveText('🔥 Most wanted here');
    const rows = mw.locator('.lp-mw-row');
    await expect(rows).toHaveCount(2); // the act that isn't on this page is left out
    await expect(rows.nth(0).locator('.lp-mw-name')).toHaveText('Kaskade');
    await expect(rows.nth(0).locator('.lp-want')).toHaveText('12 want to see');
    await expect(rows.nth(0).locator('.lp-mw-gain')).toHaveText('+3 this week');
    await expect(rows.nth(0).locator('.lp-heat i')).toHaveAttribute('style', /width: 100%/);
    await expect(rows.nth(1).locator('.lp-mw-name')).toHaveText('Alesso');
    await expect(rows.nth(1).locator('.lp-mw-gain')).toHaveCount(0);
    await expect(mw.locator('.lp-faces')).toHaveCount(0);
    await expect(mw.locator('.lp-mw-join')).toContainText('Make your picks count');

    // 📋 in the panel is the same pick as on the card.
    await rows.nth(1).locator('.lp-mw-pick').click();
    await expect(rows.nth(1).locator('.lp-mw-pick')).toHaveAttribute('aria-pressed', 'true');
    await expect(star(page, 'Alesso')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows.nth(1).locator('.lp-mw-pick')).toBeFocused();

    // Tapping a name brings its card into view.
    await rows.nth(0).locator('.lp-mw-name').click();
    await expect(page.locator('.act-wrap', { has: star(page, 'Kaskade') })).toHaveClass(/lp-flash/);

    await Promise.all([
      page.waitForURL(/\/app\?picks=1&from=edc-orlando-2026/),
      mw.getByRole('button', { name: 'Join free' }).click(),
    ]);
    expect(errors).toEqual([]);
  });

  test('members see crew faces and 📋 saves a plan', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: mwData() });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toHaveAttribute('data-mode', 'member');
    const mw = page.locator('.lp-mw');
    await expect(mw.locator('.lp-mw-join')).toHaveCount(0);
    const kaskade = mw.locator('.lp-mw-row').nth(0);
    await expect(kaskade.locator('.lp-faces')).toHaveAttribute('aria-label', '2 crewmates picked this');
    await expect(kaskade.locator('.lp-face')).toHaveCount(2);

    await mw.locator('.lp-mw-row').nth(1).locator('.lp-mw-pick').click();
    await expect(mw.locator('.lp-mw-row').nth(1).locator('.lp-mw-pick')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() =>
      window.__store.raver_artist_plans.map(p => p.artist_id + ':' + p.festival_id))).toEqual(['9:f1']);
  });

  test('stays hidden when nothing has 5+ picks yet', async ({ page }) => {
    const d = mwData();
    d.__rpc.get_lineup_want_counts = { ok: true, slug: SLUG, total_plans: null, artists: [] };
    await installSupabaseStub(page, { session: null, data: d });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toBeVisible();
    await expect(page.locator('.lp-mw')).toBeHidden();
  });

  test('hub cards show the top artist and can sort by most wanted', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: memberData({
      __rpc: { get_lineup_hub_most_wanted: { ok: true, fests: [
        { slug: 'iii-points-2026', top: 'Four Tet', want: 40, fans: 55 },
        { slug: SLUG, top: 'Kaskade', want: 12, fans: 20 },
        { slug: 'seven-stars-2026', top: null, want: null, fans: 6 },
      ] } },
    }) });
    await page.goto('/lineup-explorer/index.html');
    const edc = page.locator(`.event-card[href="/lineup-explorer/${SLUG}"]`);
    await expect(edc.locator('.lp-hub-mw')).toHaveText('🔥 Most wanted: Kaskade (12)');
    await expect(page.locator('.event-card[href="/lineup-explorer/seven-stars-2026"] .lp-hub-mw')).toHaveCount(0);

    const firstHref = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('.grid .event-card')).find(c => c.style.display !== 'none').getAttribute('href'));
    const before = await firstHref();
    const sort = page.locator('.controls .lp-sort');
    await sort.click();
    await expect(sort).toHaveAttribute('aria-pressed', 'true');
    expect(await firstHref()).toBe('/lineup-explorer/iii-points-2026');
    const order = await page.evaluate(() => Array.from(document.querySelectorAll('.grid .event-card')).slice(0, 3).map(c => c.getAttribute('href')));
    expect(order).toEqual(['/lineup-explorer/iii-points-2026', `/lineup-explorer/${SLUG}`, '/lineup-explorer/seven-stars-2026']);
    await sort.click();
    expect(await firstHref()).toBe(before);
  });
});

test.describe('Lineup Explorer 3b — crew votes and Fam Faves', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  const PULSE = { ok: true,
    crews: [{ id: 'c1', n: 'Bass Syndicate', col: '#FF2D78' }],
    mates: { m1: { n: 'Sam', a: null, g: null, s: 'going', u: false, c: ['c1'] } },
    going: ['m1'], interested: [], picks: { 3: ['m1'] } };

  function vote(extra = {}) {
    return {
      id: 'p1', crew_id: 'c1', crew: 'Bass Syndicate', col: '#FF2D78',
      q: 'Which sets are we hitting at EDC Orlando 2026?', max: 2,
      closes: '2099-11-06T00:00:00Z', closed: false, own: false,
      options: [{ id: 1, n: 'Kaskade', v: 2 }, { id: 9, n: 'Alesso', v: 1 }, { id: 3, n: 'Vastive', v: 0 }],
      my: null, voters: 2, faves: [], ...extra,
    };
  }

  function voteData(votes, extra = {}) {
    return memberData({
      artists: [
        { id: 1, name: 'Kaskade', name_lower: 'kaskade' },
        { id: 9, name: 'Alesso', name_lower: 'alesso' },
        { id: 3, name: 'Vastive', name_lower: 'vastive' },
        { id: 2, name: 'Benda', name_lower: 'benda' },
      ],
      raver_festivals: [{ raver_id: 'r1', festival_id: 'f1' }],
      raver_artist_plans: [{ raver_id: 'r1', artist_id: 1, festival_id: 'f1' }],
      __rpc: {
        get_lineup_crew_pulse: PULSE,
        get_lineup_crew_votes: { ok: true, can_vote: true, crews: [{ id: 'c1', n: 'Bass Syndicate', col: '#FF2D78' }], votes },
      },
      ...extra,
    });
  }

  test('pick up to N sets and vote', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, { session: makeSession(), data: voteData([vote()]) });
    await page.goto(PAGE);
    const card = page.locator('.lp-vcard');
    await expect(card.locator('.lp-vcrew')).toHaveText('Bass Syndicate');
    await expect(card.locator('.lp-vmeta')).toContainText('Pick up to 2 · Closes in');
    const go = card.locator('.lp-vgo');
    await expect(go).toBeDisabled();
    await card.locator('.lp-vopt', { hasText: 'Kaskade' }).click();
    await page.locator('.lp-vcard .lp-vopt', { hasText: 'Vastive' }).click();
    await expect(page.locator('.lp-vcard .lp-vopt', { hasText: 'Alesso' })).toBeDisabled();
    await expect(page.locator('.lp-vcard .lp-vgo')).toHaveText('Vote (2/2)');

    // The server now reports the vote as cast.
    await page.evaluate(() => {
      const v = window.__store.__rpc.get_lineup_crew_votes.votes[0];
      v.my = [1, 3]; v.voters = 3; v.options[0].v = 3; v.options[2].v = 1;
    });
    await page.locator('.lp-vcard .lp-vgo').click();
    await expect(page.locator('.lp-vcard .lp-vres li')).toHaveCount(3);
    await expect(page.locator('.lp-vcard .lp-vres li').first()).toContainText('Kaskade ✓');
    await expect(page.locator('.lp-vcard .lp-vfoot')).toHaveText('You voted · 3 voted');
    const stored = await page.evaluate(() => window.__store.crew_poll_votes);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ poll_id: 'p1', voter_user_id: TEST_UID });
    expect(JSON.parse(stored[0].vote_value).sort()).toEqual([1, 3]);
    expect(errors).toEqual([]);
  });

  test('without an RSVP you see results, not a ballot', async ({ page }) => {
    const d = voteData([vote()]);
    d.__rpc.get_lineup_crew_votes.can_vote = false;
    await installSupabaseStub(page, { session: makeSession(), data: d });
    await page.goto(PAGE);
    const card = page.locator('.lp-vcard');
    await expect(card.locator('.lp-vres li')).toHaveCount(3);
    await expect(card.locator('.lp-vopt')).toHaveCount(0);
    await expect(card.locator('.lp-vfoot')).toContainText('Only crewmates who are Going or Interested can vote');
  });

  test('a closed vote puts ⭐ Fam Fave on the winning cards', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: voteData([vote({ closed: true, faves: [1] })]) });
    await page.goto(PAGE);
    await expect(page.locator('.lp-vcard .lp-vfoot')).toHaveText('⭐ Fam Faves: Kaskade · 2 voted');
    await expect(page.locator('.act-wrap', { has: star(page, 'Kaskade') }).locator('.lp-famfave')).toHaveText('⭐ Fam Fave · Bass Syndicate');
    await expect(page.locator('.act-wrap', { has: star(page, 'Alesso') }).locator('.lp-famfave')).toHaveCount(0);
  });

  test('starting a vote pre-fills the ballot and posts to the Huddle', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: voteData([]) });
    await page.goto(PAGE);
    await expect(page.locator('.lp-vote-hint')).toContainText("Can't agree on sets?");
    await page.locator('.lp-vote-start').click();
    const sheet = page.locator('.lp-vote-overlay.show');
    await expect(sheet.locator('h3')).toHaveText('Start a crew vote');
    // Your 📋 pick (Kaskade) and Sam's (Vastive) start checked.
    const checked = () => sheet.locator('.lp-vs-row:has(input:checked) span').allTextContents();
    expect((await checked()).sort()).toEqual(['Kaskade', 'Vastive']);
    await sheet.locator('.lp-crew-chip', { hasText: '2' }).click();
    await sheet.locator('.lp-vs-find').fill('ben');
    await sheet.locator('.lp-vs-hit', { hasText: 'Benda' }).click();
    expect((await checked()).sort()).toEqual(['Benda', 'Kaskade', 'Vastive']);
    await expect(sheet.locator('.lp-vs-go')).toHaveText('Start the vote (3 sets)');
    await sheet.locator('.lp-vs-go').click();
    await expect(page.locator('.lp-vote-overlay.show')).toHaveCount(0);

    const s = await page.evaluate(() => window.__store);
    expect(s.crew_polls).toHaveLength(1);
    expect(s.crew_polls[0]).toMatchObject({ crew_id: 'c1', created_by: TEST_UID, poll_type: 'pick_many', festival_id: 'f1', max_picks: 2,
      question: 'Which sets are we hitting at EDC Orlando 2026?' });
    expect(s.crew_polls[0].options.map(o => o.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    await expect.poll(() => page.evaluate(() => (window.__store.huddle_messages || []).length)).toBe(1);
    const msg = await page.evaluate(() => window.__store.huddle_messages[0]);
    expect(msg).toMatchObject({ crew_id: 'c1', kind: 'lineup', media_url: '/lineup-explorer/' + 'edc-orlando-2026' });
    expect(msg.body).toContain('Pick up to 2');
  });

  test('whoever runs a vote can add sets but not remove them', async ({ page }) => {
    const d = voteData([vote({ own: true })]);
    d.crew_polls = [{ id: 'p1', crew_id: 'c1', poll_type: 'pick_many', options: [{ id: 1 }, { id: 9 }, { id: 3 }] }];
    await installSupabaseStub(page, { session: makeSession(), data: d });
    await page.goto(PAGE);
    await page.locator('.lp-vadd').click();
    const sheet = page.locator('.lp-vote-overlay.show');
    await expect(sheet.locator('h3')).toHaveText("Add sets to Bass Syndicate's vote");
    await expect(sheet.locator('.lp-vs-row input:disabled')).toHaveCount(3);
    await expect(sheet.locator('.lp-vs-go')).toBeDisabled();
    await sheet.locator('.lp-vs-find').fill('ben');
    await sheet.locator('.lp-vs-hit', { hasText: 'Benda' }).click();
    await expect(sheet.locator('.lp-vs-go')).toHaveText('Add 1 set');
    await sheet.locator('.lp-vs-go').click();
    await expect(page.locator('.lp-vote-overlay.show')).toHaveCount(0);
    const opts = await page.evaluate(() => window.__store.crew_polls[0].options.map(o => o.id));
    expect(opts).toEqual([1, 9, 3, 2]);
  });

  test('visitors never see crew votes', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: voteData([vote()]) });
    await page.goto(PAGE);
    await expect(page.locator('.lp-bar')).toBeVisible();
    await expect(page.locator('.lp-vote')).toBeHidden();
  });
});
