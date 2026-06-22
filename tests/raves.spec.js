const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

async function refetch(page, expr) {
  return page.evaluate(async (src) => { await loadAllData(); return eval(src); }, expr);
}

test.describe('raves / events', () => {
  test('toggleGoingToFest adds the rave and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => toggleGoingToFest('f2'));
    // local state updated immediately
    expect(await page.evaluate(() => squad.find(r => r.isYou).festIds.map(String))).toContain('f2');
    // and it round-trips through the fake DB
    const going = await refetch(page, "squad.find(r=>r.isYou).festIds.map(String)");
    expect(going).toContain('f2');
  });

  test('toggleInterestedInFest persists interest', async ({ page }) => {
    await bootAuthedApp(page);
    // f1 starts as Going; mark interest in f1 should move it to interested.
    await page.evaluate(() => toggleInterestedInFest('f1'));
    const interested = await refetch(page, "squad.find(r=>r.isYou).interestedFestIds.map(String)");
    expect(interested).toContain('f1');
  });

  test('Going filter shows only raves you are going to', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    await page.evaluate(() => toggleRaveFilter('status', 'going'));
    const list = page.locator('#events-list');
    await expect(list).toContainText('Tomorrowland');   // f1 = going
    await expect(list).not.toContainText('Awakenings');  // f2 = interested only
  });

  test('Interested filter shows only raves you are interested in', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    await page.evaluate(() => toggleRaveFilter('status', 'interested'));
    const list = page.locator('#events-list');
    await expect(list).toContainText('Awakenings');
    await expect(list).not.toContainText('Tomorrowland');
  });

  test('rave search filters the list', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    await page.fill('#rave-search', 'Awak');
    await page.evaluate(() => renderEvents());
    const list = page.locator('#events-list');
    await expect(list).toContainText('Awakenings');
    await expect(list).not.toContainText('Tomorrowland');
  });
});
