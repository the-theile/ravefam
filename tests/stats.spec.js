const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Dataset where "you" have actually attended one past festival, so stats are
// non-zero (stats only count raves that have already happened).
function statsData() {
  const d = seedData();
  d.festivals.push({ id: 'f-past', name: 'Past Fest', date: '2020-06-01', location: 'Detroit, US', color: '#39FF14', days: 2, deleted_at: null });
  d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-past' });
  return d;
}

test.describe('stats', () => {
  test('hero numbers reflect attended past raves', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });

    const heroNumbers = page.locator('#stats-content .stats-hero-number');
    await expect(heroNumbers.nth(0)).toHaveText('1');       // Raves Logged
    await expect(heroNumbers.nth(1)).toHaveText('2');       // Days Raved (days:2)
    await expect(heroNumbers.nth(3)).toHaveText('2020');    // Raving Since
  });

  test('empty stats shows the empty state when no past raves', async ({ page }) => {
    await bootAuthedApp(page); // seed has only future raves
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    const heroNumbers = page.locator('#stats-content .stats-hero-number');
    await expect(heroNumbers.nth(0)).toHaveText('0');       // 0 Raves Logged
  });

  test('switching to the Crew Stats subtab shows the crew panel', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('.stats-subtab');
      switchStatTab('crew', tabs[1]);
    });
    await expect(page.locator('#stats-crew-panel')).toBeVisible();
    await expect(page.locator('#stats-my-panel')).toBeHidden();
  });
});
