// The new crew page (beta, Settings → New crew page). Same panels as the
// classic tile page, laid out as header + Huddle pill + Rave Plan tickets +
// filter chips, with the roster in a bottom sheet. These run with the flag on;
// every other crew spec keeps covering the classic page with it off.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

async function bootWithCrewFeed(page, opts = {}) {
  await page.addInitScript(() => localStorage.setItem('ravefam_crew_feed', '1'));
  return bootAuthedApp(page, opts);
}

async function openC1(page, opts) {
  await page.evaluate(async (o) => { await openDetail('c1', o); }, opts || null);
  await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
}

const panel = (page, key) => page.locator(`#crew-feature-panel-${key}`);

test.describe('new crew page · layout', () => {
  test('flag off keeps the classic tile page', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);
    await expect(page.locator('#page-crew-detail')).not.toHaveClass(/crew-feed/);
    await expect(page.locator('#page-crew-detail .crew-feature-tile')).not.toHaveCount(0);
    await expect(page.locator('#page-crew-detail .stats-subtab')).toHaveCount(2);
  });

  test('flag on renders header, Huddle pill, ticket and filters instead of tiles and tabs', async ({ page }) => {
    const errors = await bootWithCrewFeed(page);
    await openC1(page);
    const detail = page.locator('#page-crew-detail');
    await expect(detail).toHaveClass(/crew-feed/);
    await expect(detail.locator('.crew-feed-name')).toHaveText('Bass Syndicate');
    await expect(detail.locator('.crew-feed-count')).toHaveText('3');
    await expect(detail.locator('#huddle-tile-preview-root .huddle-tile-preview')).toBeVisible();
    // You and Sam are both going to Tomorrowland, so it gets a Rave Plan ticket.
    await expect(detail.locator('.crew-ticket[data-fest="f1"]')).toContainText('Tomorrowland');
    await expect(detail.locator('.crew-feed-filter')).toHaveText(['All', 'Polls', 'Jams', 'Dreams', 'Plan', 'Memories']);
    await expect(detail.locator('.crew-feature-tile')).toHaveCount(0);
    await expect(detail.locator('.stats-subtab')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('no sideways scroll at phone width, with or without the roster sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootWithCrewFeed(page);
    await openC1(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.evaluate(() => openCrewManifestSheet());
    await expect(page.locator('#crew-manifest-overlay')).toHaveClass(/open/);
    const sheet = await page.evaluate(() => {
      const el = document.getElementById('crew-manifest-content');
      return { right: el.getBoundingClientRect().right, vw: document.documentElement.clientWidth };
    });
    expect(sheet.right).toBeLessThanOrEqual(sheet.vw);
  });

  test('a Secret crew has no Polls or Jams chips', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'secret';
    await bootWithCrewFeed(page, { data });
    await openC1(page);
    await expect(page.locator('#page-crew-detail .crew-feed-filter')).toHaveText(['All', 'Dreams', 'Plan', 'Memories']);
  });
});

test.describe('new crew page · filters', () => {
  test('each chip shows only its panels', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);

    // All: polls, dreams and jams together.
    await expect(panel(page, 'poll')).toBeVisible();
    await expect(panel(page, 'dreamboard')).toBeVisible();
    await expect(panel(page, 'jams')).toBeVisible();
    await expect(panel(page, 'archive')).toBeHidden();

    await page.locator('.crew-feed-filter[data-filter="poll"]').click();
    await expect(page.locator('.crew-feed-filter[data-filter="poll"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page, 'poll')).toBeVisible();
    await expect(panel(page, 'dreamboard')).toBeHidden();

    await page.locator('.crew-feed-filter[data-filter="memories"]').click();
    await expect(panel(page, 'pins')).toBeVisible();
    await expect(panel(page, 'archive')).toBeVisible();
    await expect(panel(page, 'history')).toBeVisible();
    await expect(panel(page, 'poll')).toBeHidden();
  });

  test('the chosen chip survives a re-render of the same crew', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-feed-filter[data-filter="memories"]').click();
    await page.evaluate(() => renderDetail('c1'));
    await expect(page.locator('.crew-feed-filter[data-filter="memories"]')).toHaveClass(/active/);
    await expect(panel(page, 'archive')).toBeVisible();
  });

  test('tapping the ticket opens that rave\'s Plan', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-ticket[data-fest="f1"]').click();
    await expect(page.locator('.crew-feed-filter[data-filter="raveplan"]')).toHaveClass(/active/);
    await expect(panel(page, 'raveplan')).toBeVisible();
    await expect(panel(page, 'poll')).toBeHidden();
    expect(await page.evaluate(() => String(_gamePlanActiveFestivalId))).toBe('f1');
  });

  test('the existing panels still work inside the new page', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-feed-filter[data-filter="dreamboard"]').click();
    await page.evaluate(async () => {
      document.getElementById('dream-pin-input').value = 'Sunrise set at the main stage';
      await addDreamPin('c1');
    });
    await expect(page.locator('#dream-board-section')).toContainText('Sunrise set at the main stage');
  });
});

test.describe('new crew page · roster sheet', () => {
  test('the avatars open the roster sheet; Escape closes it', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-feed-faces').click();
    const sheet = page.locator('#crew-manifest-overlay');
    await expect(sheet).toHaveClass(/open/);
    await expect(sheet).toContainText('Crew Manifest');
    await expect(sheet).toContainText('Sam');
    await expect(sheet.locator('#add-member-input')).toBeVisible();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.getElementById('main-app').inert)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(sheet).not.toHaveClass(/open/);
  });

  test('only one copy of the roster exists, so its ids stay unique', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    expect(await page.locator('#add-member-input').count()).toBe(1);
    await expect(page.locator('#page-crew-detail .crew-manifest')).toHaveCount(0);
  });

  test('leaving the crew page closes the sheet', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.evaluate(() => openCrewManifestSheet());
    await expect(page.locator('#crew-manifest-overlay')).toHaveClass(/open/);
    await page.evaluate(() => closeDetail());
    await expect(page.locator('#crew-manifest-overlay')).not.toHaveClass(/open/);
  });
});

test.describe('new crew page · deep links', () => {
  test('tab:roster opens the sheet', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page, { tab: 'roster' });
    await expect(page.locator('#crew-manifest-overlay')).toHaveClass(/open/);
  });

  test('tab:gameplan opens the Plan for that rave', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page, { tab: 'gameplan', festivalId: 'f1' });
    await expect(page.locator('.crew-feed-filter[data-filter="raveplan"]')).toHaveClass(/active/);
    await expect(panel(page, 'raveplan')).toBeVisible();
  });
});

test.describe('new crew page · settings toggle', () => {
  test('turning it on in Settings swaps an open crew page', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);
    await expect(page.locator('#page-crew-detail')).not.toHaveClass(/crew-feed/);
    await page.evaluate(() => toggleCrewFeedEnabled(document.getElementById('crew-feed-settings-toggle')));
    await expect(page.locator('#page-crew-detail')).toHaveClass(/crew-feed/);
    expect(await page.evaluate(() => localStorage.getItem('ravefam_crew_feed'))).toBe('1');

    await page.evaluate(() => toggleCrewFeedEnabled(document.getElementById('crew-feed-settings-toggle')));
    await expect(page.locator('#page-crew-detail')).not.toHaveClass(/crew-feed/);
    await expect(page.locator('#page-crew-detail .stats-subtab')).toHaveCount(2);
    expect(await page.locator('#add-member-input').count()).toBe(1);
  });
});
