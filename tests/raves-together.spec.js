const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// "you" (Techno/House) shares a past festival AND the default upcoming
// festival (f1) with r-sam, so both counters are non-zero.
function overlapData() {
  const d = seedData();
  d.festivals.push({ id: 'f-past', name: 'Past Fest', date: '2020-06-01', location: 'Detroit, US', color: '#39FF14', days: 1 });
  d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-past' });
  d.raver_festivals.push({ raver_id: 'r-sam', festival_id: 'f-past' });
  // A raver with no shared festivals and no genre overlap with "you".
  d.ravers.push({
    id: 'r-nomatch', name: 'Nomatch R.', handle: 'nomatchraves',
    is_you: false, created_by: d.ravers[0].created_by, claimed_by: null, status: 'unclaimed',
    base: 'Tokyo, JP', gradient: 'linear-gradient(135deg,#FFE600,#FF6B35)',
    avatar_url: null, blocked_tags: [], genres: ['Trance'], fav_artists: [],
    instagram: '', radiate: '', phone: '', phone_visible: false,
    met_story: '', notes: '', qr_token: 'qr-nomatch',
    vibe_tags: [], custom_vibe_tags: [],
  });
  return d;
}

test.describe('raves together (profile relational stats)', () => {
  test('shows shared past + upcoming raves and first-together fest', async ({ page }) => {
    await bootAuthedApp(page, { data: overlapData() });
    await page.evaluate(() => openProfile('r-sam'));
    const profile = page.locator('#page-profile');
    await expect(profile).toContainText('You & Sam P.');

    await expect(profile.locator('.raves-together-hero-number')).toHaveText('1'); // Raves Together
    await expect(profile.locator('.raves-together-hero-label')).toContainText('First Spark');
    await expect(profile).toContainText('1 upcoming together');
    await expect(profile).toContainText('First rave together');
    await expect(profile).toContainText('Past Fest (2020)');
  });

  test('shows a friendly empty state when there is no overlap', async ({ page }) => {
    await bootAuthedApp(page, { data: overlapData() });
    await page.evaluate(() => openProfile('r-nomatch'));
    const profile = page.locator('#page-profile');
    await expect(profile).toContainText('No raves together yet');
    await expect(profile.locator('.raves-together-hero-number')).toHaveCount(0);
  });

  test('does not show the section on your own profile', async ({ page }) => {
    await bootAuthedApp(page, { data: overlapData() });
    await page.evaluate(() => openProfile('r-you'));
    const profile = page.locator('#page-profile');
    await expect(profile).not.toContainText('No raves together yet');
    await expect(profile.locator('h3', { hasText: 'You &' })).toHaveCount(0);
  });
});
