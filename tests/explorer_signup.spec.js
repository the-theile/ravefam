// Lineup Explorer → RaveFAM signup entry points (lineup-explorer/lineup-common.js:
// goJoin, the join bar, 👥 Plan with crew, artist ♡, shared picks) and the
// /app side of the follow and share-referral handoffs (app.html:
// processPendingFollow, processPendingShareRef, showShareIntercept).
const { test, expect } = require('@playwright/test');
const { installSupabaseStub, collectPageErrors, makeSession, seedData, TEST_UID } = require('./helpers');

const PAGE = '/lineup-explorer/edc-orlando-2026.html';
const SLUG = 'edc-orlando-2026';
const ARTIST = '/lineup-explorer/artist/troyboi.html';
const BEFORE = new Date('2026-10-01T18:00:00Z'); // more than 14 days before EDC Orlando (Nov 6–8)

async function blockExternal(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
}
const star = (page, name) => page.locator(`.pick[data-n="${name}"]`);
const bar = page => page.locator('#ctaBar');
const rpcCalls = (page, fn) => page.evaluate(f => (window.__store.__rpcCalls || []).filter(c => c.fn === f), fn);

test.describe('Explorer join bar (visitors)', () => {
  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await installSupabaseStub(page, { session: null, data: {} });
  });

  test('stays pinned to the bottom of a phone screen', async ({ page }) => {
    await page.clock.setFixedTime(BEFORE);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PAGE);
    const box = await bar(page).boundingBox();
    expect(box.y + box.height).toBeGreaterThan(844 - 2);
    expect(box.height).toBeLessThan(140);
    await expect(bar(page).locator('.cta-short')).toHaveText('Plan it with your crew.');
  });

  test('with no picks, Join opens this rave after signup', async ({ page }) => {
    await page.clock.setFixedTime(BEFORE);
    await page.goto(PAGE);
    await expect(bar(page)).toContainText('Going to EDC Orlando?');
    await Promise.all([page.waitForURL(/\/app\?rave=edc-orlando-2026$/), bar(page).locator('.cta-btn').click()]);
  });

  test('turns into the picks bar and carries picks into the handoff', async ({ page }) => {
    await page.clock.setFixedTime(BEFORE);
    await page.goto(PAGE);
    await star(page, 'Kaskade').click();
    await expect(bar(page)).toHaveAttribute('data-mode', 'picks');
    await expect(bar(page).locator('.cta-copy b')).toHaveText('📋 1 pick on this device.');
    await expect(bar(page).locator('.cta-btn')).toHaveText('Save 1 pick');
    // The bar already offers Save, so the first-pick toast has no button.
    await expect(page.locator('.lp-toast')).toContainText('added to your picks on this device');
    await expect(page.locator('.lp-toast button')).toHaveCount(0);
    await Promise.all([page.waitForURL(/\/app\?picks=1&from=edc-orlando-2026$/), bar(page).locator('.cta-btn').click()]);
  });

  test('a bar closed before 3 picks comes back once at 3', async ({ page }) => {
    await page.clock.setFixedTime(BEFORE);
    await page.goto(PAGE);
    await star(page, 'Kaskade').click();
    await page.locator('#ctaClose').click();
    await expect(bar(page)).toBeHidden();
    await star(page, 'Alesso').click();
    await expect(bar(page)).toBeHidden();
    await star(page, 'Afrojack').click();
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).locator('.cta-btn')).toHaveText('Save 3 picks');
  });

  for (const [when, at, lead] of [
    ['5 days out', '2026-11-01T16:00:00Z', 'EDC Orlando is in 5 days.'],
    ['the day before', '2026-11-05T16:00:00Z', 'EDC Orlando is tomorrow.'],
    ['during the fest', '2026-11-07T16:00:00Z', 'EDC Orlando is on now.'],
  ]) {
    test(`says so ${when}`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(at));
      await page.goto(PAGE);
      await expect(bar(page).locator('.cta-copy b')).toHaveText(lead);
    });
  }

  test('after the fest it talks top sets and opens the rave, even with picks', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-20T16:00:00Z'));
    await page.goto(PAGE);
    await expect(bar(page).locator('.cta-copy b')).toHaveText('Were you at EDC Orlando?');
    await star(page, 'Kaskade').click();
    await expect(bar(page)).toHaveAttribute('data-phase', 'ended');
    await expect(bar(page).locator('.cta-copy b')).toHaveText('Were you at EDC Orlando?');
    await Promise.all([page.waitForURL(/\/app\?rave=edc-orlando-2026$/), bar(page).locator('.cta-btn').click()]);
  });
});

test.describe('Explorer 👥 Plan with crew', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  test('visitors get a locked chip that explains what an account adds', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, { session: null, data: {} });
    await page.clock.setFixedTime(BEFORE);
    await page.goto(PAGE);
    const chip = page.locator('.lp-lock-f');
    await expect(chip).toBeVisible();
    await chip.click();
    const sheet = page.locator('.lp-overlay.show');
    await expect(sheet.locator('h3')).toHaveText('Plan this lineup with your crew');
    await expect(sheet.locator('.lp-join-list li')).toHaveCount(4);
    await expect(sheet.locator('.lp-join-go')).toHaveText('Join free');
    await expect(sheet.locator('.lp-join-go')).toBeFocused();
    const opened = await rpcCalls(page, 'log_analytics_event');
    expect(opened.some(c => c.args.p_event_name === 'explorer_cta_click' && c.args.p_properties.surface === 'crew_chip')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.lp-overlay.show')).toHaveCount(0);
    await star(page, 'Kaskade').click();
    await chip.click();
    await expect(page.locator('.lp-overlay.show .lp-join-go')).toHaveText('Save my 1 pick');
    expect(errors).toEqual([]);
  });

  test('members never see the chip or the join bar', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession(),
      data: {
        ravers: [{ id: 'r1', claimed_by: TEST_UID, created_by: TEST_UID, is_you: true, status: 'claimed' }],
        festivals: [{ id: 'f1', slug: SLUG, name: 'EDC Orlando 2026', date: '2026-11-06', deleted_at: null }],
        artists: [], raver_artist_plans: [], raver_festivals: [], raver_festival_interest: [],
      },
    });
    await page.goto(PAGE);
    await expect(page.locator('.brandbar .lp-account')).toHaveText('My RaveFAM');
    await expect(page.locator('.lp-lock-f')).toBeHidden();
    await expect(bar(page)).toBeHidden();
  });
});

test.describe('Explorer artist pages and shared picks (visitors)', () => {
  test.beforeEach(async ({ page }) => { await blockExternal(page); });

  test('♡ Favorite on an artist page saves the follow for after signup', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: {} });
    await page.goto(ARTIST);
    const layer = page.locator('#arMember');
    await expect(layer.locator('.ar-fav')).toHaveText('♡ Favorite');
    await expect(layer).toContainText('Get a ping when TroyBoi lands on a lineup.');
    await Promise.all([page.waitForURL(/\/app$/), layer.locator('.ar-fav').click()]);
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('pendingFollowArtists')));
    expect(pending).toEqual({ names: ['troyboi'], label: 'TroyBoi' });
  });

  test('joining from shared picks keeps the share link for signup', async ({ page }) => {
    await installSupabaseStub(page, {
      session: null,
      data: { __rpc: { get_shared_lineup: { ok: true, slug: SLUG, festival: 'EDC Orlando 2026', first_name: 'Alex', artists: ['Kaskade'] } } },
    });
    await page.clock.setFixedTime(BEFORE);
    await page.goto(PAGE + '?by=abcd1234');
    const banner = page.locator('.lp-sharebanner');
    await expect(banner).toContainText('Alex shared their picks');
    await Promise.all([page.waitForURL(/\/app\?rave=edc-orlando-2026$/), banner.getByRole('button', { name: 'Join Alex on RaveFAM' }).click()]);
    expect(await page.evaluate(() => localStorage.getItem('pendingShareRef'))).toBe('abcd1234');
  });
});

test.describe('/app: explorer follow and share handoffs', () => {
  // A second app load would otherwise be answered by the service worker with
  // the real supabase-js, bypassing the stub.
  test.use({ serviceWorkers: 'block' });

  async function bootApp(page, { session, data, local }) {
    const errors = collectPageErrors(page);
    await page.addInitScript(l => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      Object.entries(l).forEach(([k, v]) => localStorage.setItem(k, v));
    }, local);
    await installSupabaseStub(page, { session, data });
    await page.goto('/app.html');
    return errors;
  }

  test('a logged-out visitor from shared picks sees who shared them', async ({ page }) => {
    const errors = await bootApp(page, {
      session: null,
      data: { ...seedData(), __rpc: { get_shared_lineup: { ok: true, slug: 'x', festival: 'Cyclops Cove 4', first_name: 'Alex', artists: [] } } },
      local: { pendingShareRef: 'abcd1234' },
    });
    const card = page.locator('#claim-intercept.open');
    await expect(card).toBeVisible();
    await expect(card.locator('#intercept-title')).toHaveText('Alex shared their picks with you 📋');
    await expect(card.locator('#intercept-sub')).toHaveText('Create an account or log in to plan Cyclops Cove 4 together.');
    await expect(card.locator('#intercept-crew-name')).toHaveText('Cyclops Cove 4');
    expect(errors).toEqual([]);
  });

  test('a dead share link leaves the plain login form', async ({ page }) => {
    await bootApp(page, {
      session: null,
      data: { ...seedData(), __rpc: { get_shared_lineup: { ok: false } } },
      local: { pendingShareRef: 'abcd1234' },
    });
    await page.locator('#auth-screen').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await expect(page.locator('#claim-intercept.open')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('pendingShareRef'))).toBeNull();
  });

  test('after signup, the sharer is told only when the new raver says yes', async ({ page }) => {
    const errors = await bootApp(page, {
      session: makeSession(),
      data: { ...seedData(), __rpc: { record_share_referral: { ok: true, new: true, first_name: 'Alex', festival: 'Cyclops Cove 4', notified: false } } },
      local: { pendingShareRef: 'abcd1234' },
    });
    await page.locator('#main-app').waitFor({ state: 'visible' });
    const confirm = page.locator('#confirm-overlay.open');
    await expect(confirm).toBeVisible();
    await expect(confirm.locator('#confirm-title')).toHaveText('Alex shared their picks with you');
    await expect(confirm.locator('#confirm-cancel-btn')).toHaveText('Not now');
    let calls = await rpcCalls(page, 'record_share_referral');
    expect(calls.map(c => c.args)).toEqual([{ p_token: 'abcd1234', p_notify: false }]);
    await confirm.locator('#confirm-ok-btn').click();
    await expect(page.locator('#toast, .toast').filter({ hasText: 'We let Alex know' }).first()).toBeVisible();
    calls = await rpcCalls(page, 'record_share_referral');
    expect(calls.map(c => c.args.p_notify)).toEqual([false, true]);
    expect(await page.evaluate(() => localStorage.getItem('pendingShareRef'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('an artist favorited before signup is saved and kept on the profile', async ({ page }) => {
    const d = seedData();
    d.artists.push({ id: 'a9', name: 'TroyBoi', name_lower: 'troyboi', genres: [] });
    d.raver_favorite_artists = d.raver_favorite_artists || [];
    const errors = await bootApp(page, {
      session: makeSession(), data: d,
      local: { pendingFollowArtists: JSON.stringify({ names: ['troyboi'], label: 'TroyBoi' }) },
    });
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#toast, .toast').filter({ hasText: 'TroyBoi added to your favorites' }).first()).toBeVisible();
    const s = await page.evaluate(() => window.__store);
    expect(s.raver_favorite_artists.some(r => r.raver_id === 'r-you' && r.artist_id === 'a9')).toBe(true);
    // The local list is updated too, so a later profile save can't prune it.
    expect(await page.evaluate(() => squad.find(r => r.isYou).favArtistIds.map(String))).toContain('a9');
    expect(await page.evaluate(() => localStorage.getItem('pendingFollowArtists'))).toBeNull();
    expect(errors).toEqual([]);
  });
});
