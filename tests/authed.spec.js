const { test, expect } = require('@playwright/test');
const { bootAuthedApp, installSupabaseStub, makeSession, seedData } = require('./helpers');

test.describe('authenticated app', () => {
  test('boots into the main app on the Crews tab with seeded data, no errors', async ({ page }) => {
    const errors = await bootAuthedApp(page);

    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#page-crews')).toHaveClass(/active/);
    // Seeded crew renders.
    await expect(page.locator('#crew-grid .crew-card .crew-name'))
      .toContainText('Bass Syndicate');

    expect(errors, `uncaught page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('Raves tab lists seeded festivals', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    await expect(page.locator('#page-events')).toHaveClass(/active/);
    await expect(page.locator('#events-list')).toContainText('Tomorrowland');
    await expect(page.locator('#events-list')).toContainText('Awakenings');
  });

  test('Ravers tab lists the crew members', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('members'));
    await expect(page.locator('#page-members')).toHaveClass(/active/);
    const grid = page.locator('#members-grid');
    await expect(grid).toContainText('Theile'); // you
    await expect(grid).toContainText('Sam P.');
  });

  test('Stats tab loads without error', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    await expect(page.locator('#page-stats')).toHaveClass(/active/);
    expect(errors, `uncaught page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('crew search filters the grid', async ({ page }) => {
    await bootAuthedApp(page);
    await page.fill('#crew-search', 'nonexistent-crew-xyz');
    await page.evaluate(() => renderCrews());
    await expect(page.locator('#crew-grid .crew-card')).toHaveCount(0);

    await page.fill('#crew-search', 'Bass');
    await page.evaluate(() => renderCrews());
    await expect(page.locator('#crew-grid .crew-card')).toHaveCount(1);
  });

  test('tapping a crew card opens its detail view', async ({ page }) => {
    await bootAuthedApp(page);
    await page.locator('#crew-grid .crew-card').first().click();
    await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
    await expect(page.locator('#page-crew-detail')).toContainText('Bass Syndicate');
  });

  test('double-tap on an active tab re-fetches and shows the refresh toast', async ({ page }) => {
    await bootAuthedApp(page);
    // Real refreshTab runs loadAllData (stubbed) then re-renders; assert the toast.
    await page.evaluate(() => { switchTab('crews'); switchTab('crews'); });
    await expect(page.locator('#toast')).toHaveClass(/show/);
    await expect(page.locator('#toast')).toContainText(/Refreshed|Refreshing/);
  });
});

test.describe('eruda debug console gating', () => {
  // Provide a fake eruda lib that records when init() is called.
  const FAKE_ERUDA = 'window.eruda={init:function(){window.__erudaInited=true;}};';

  test('does NOT init for a non-maintainer account', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession({ email: 'someone-else@example.com' }),
      data: seedData(),
      eruda: FAKE_ERUDA,
    });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => !!window.__erudaInited)).toBe(false);
  });

  test('DOES init for the maintainer account', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession({ email: 'theile.secure@proton.me' }),
      data: seedData(),
      eruda: FAKE_ERUDA,
    });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => !!window.__erudaInited)).toBe(true);
  });

  test('localStorage escape hatch (rf_eruda=1) inits even when signed out', async ({ page }) => {
    await installSupabaseStub(page, { session: null, eruda: FAKE_ERUDA });
    await page.addInitScript(() => localStorage.setItem('rf_eruda', '1'));
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => !!window.__erudaInited)).toBe(true);
  });
});
