const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// Raver profile tabs: Raves · Vibe · Crews · Us/Notes, plus the Manage raves sheet.
// Seed: r-you (going f1), r-sam (unclaimed, created by you, going f1),
// r-kai (claimed crewmate).

const activeTab = (page) => page.locator('#page-profile .profile-tab.active').getAttribute('data-tab');

test.describe('profile tabs', () => {
  test('your own profile opens on Raves, with a Notes tab', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-you'));
    expect(await activeTab(page)).toBe('raves');
    await expect(page.locator('#page-profile .profile-tab[data-tab="us"]')).toHaveText('Notes');
    const upcoming = await page.evaluate(() => Math.min(4, raverUpcoming(getRaver('r-you')).length));
    expect(upcoming).toBeGreaterThan(0);
    await expect(page.locator('#page-profile .profile-tab-pane[data-tab="raves"] .prow')).toHaveCount(upcoming);
    await expect(page.locator('#page-profile .profile-manage-btn')).toBeVisible();
  });

  test('an unclaimed profile you manage opens on Raves with the manage banner', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-sam'));
    expect(await activeTab(page)).toBe('raves');
    await expect(page.locator('#page-profile .profile-manage-bar')).toContainText('You manage this profile');
  });

  test("a claimed crewmate's profile opens on Vibe, with an Us tab", async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-kai'));
    expect(await activeTab(page)).toBe('vibe');
    await expect(page.locator('#page-profile .profile-tab[data-tab="us"]')).toHaveText('Us');
    await expect(page.locator('#page-profile .profile-manage-bar')).toHaveCount(0);
    await expect(page.locator('#page-profile .profile-tab-pane[data-tab="raves"]')).toBeHidden();
  });

  test('switching tabs shows one pane and is remembered per profile', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-you'));
    await page.locator('#page-profile .profile-tab[data-tab="crews"]').click();
    await expect(page.locator('#page-profile .profile-tab-pane[data-tab="crews"]')).toBeVisible();
    await expect(page.locator('#page-profile .profile-tab-pane[data-tab="raves"]')).toBeHidden();
    await page.evaluate(() => { openProfile('r-kai'); openProfile('r-you'); });
    expect(await activeTab(page)).toBe('crews');
  });

  test('Manage raves sheet opens on Suggested for someone you manage and adds a rave', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-sam'));
    await page.locator('#page-profile .profile-manage-btn').click();
    await expect(page.locator('#profile-list-sheet')).toHaveClass(/open/);
    await expect(page.locator('#profile-list-body .profile-seg button.active')).toHaveText('Suggested');
    await page.locator('#profile-list-body .fest-quick-chip[data-fid="f2"]').click();
    await page.waitForTimeout(150);
    const sam = await page.evaluate(() => getRaver('r-sam').festIds.map(String));
    expect(sam).toContain('f2');
    // Sheet stays open and the going tab now lists both
    await expect(page.locator('#profile-list-sheet')).toHaveClass(/open/);
    await page.locator('#profile-list-body .profile-seg button', { hasText: 'Going' }).click();
    await expect(page.locator('#profile-list-body .fest-row')).toHaveCount(2);
  });

  test("+ Me too adds a rave to your list and stays on their profile", async ({ page }) => {
    const data = seedData();
    data.raver_festivals = data.raver_festivals.filter(rf => !(rf.raver_id === 'r-you' && rf.festival_id === 'f1'));
    data.raver_festivals.push({ raver_id: 'r-kai', festival_id: 'f1' });
    await bootAuthedApp(page, { data });
    await page.evaluate(() => openProfile('r-kai'));
    await page.locator('#page-profile .profile-tab[data-tab="raves"]').click();
    await page.locator('#page-profile .prow-btn', { hasText: 'Me too' }).click();
    await page.waitForTimeout(150);
    const mine = await page.evaluate(() => getRaver('r-you').festIds.map(String));
    expect(mine).toContain('f1');
    await expect(page.locator('#page-profile .prow-tag')).toHaveText("You're going too");
    expect(await activeTab(page)).toBe('raves');
  });

  test('Our Memory sits beside the slim countdown on someone else\'s profile', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-sam'));
    const row = page.locator('#page-profile .our-photo-countdown-row.slim');
    await expect(row.locator('.countdown-banner.cd-slim')).toBeVisible();
    await expect(row.locator('.our-photo-label')).toBeVisible();
  });
});
