// Lineup Explorer Phase 4c in the app: the "Who'd you catch? 📼" post-fest
// check-off on a past rave (postfestCardHTML, "===== Post-fest check-off"
// section) and the Lineup alerts toggles in Privacy & Notifications
// (renderLineupAlertSettings / toggleLineupAlert).
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

function checkoffData(extra = {}) {
  const d = seedData();
  d.festivals.push({ id: 'f-done', name: 'Done Fest', date: '2026-09-25', location: 'Orlando, FL', color: '#39FF14', days: 2, deleted_at: null });
  d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-done' });
  d.artists.push({ id: 71, name: 'Kaskade', genres: ['house'] }, { id: 72, name: 'Benda', genres: ['techno'] });
  d.artist_festival_appearances = [{ artist_id: 71, festival_id: 'f-done' }, { artist_id: 72, festival_id: 'f-done' }];
  d.raver_artist_plans = [{ raver_id: 'r-you', artist_id: 71, festival_id: 'f-done' }, { raver_id: 'r-you', artist_id: 72, festival_id: 'f-done' }];
  d.raver_artist_sightings = [];
  d.raver_postfest_checkoffs = [];
  return Object.assign(d, extra);
}

test.describe("post-fest check-off — Who'd you catch? 📼", () => {
  test('the day after the last day, Saw them / Missed each pick, then it closes', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:00'));
    await bootAuthedApp(page, { data: checkoffData() });
    await page.evaluate(() => openRaveFocus('f-done'));
    const card = page.locator('#lineup-section .postfest-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.postfest-name')).toHaveText(['Kaskade', 'Benda']);

    await card.locator('.postfest-row', { hasText: 'Kaskade' }).getByRole('button', { name: '✅ Saw them' }).click();
    await expect(page.locator('#lineup-section .postfest-row', { hasText: 'Kaskade' }).locator('.postfest-btn.saw')).toHaveAttribute('aria-pressed', 'true');
    let rows = await page.evaluate(() => window.__store.raver_artist_sightings);
    // Ids arrive as strings from the onclick handler, as with the ✅/❌ chips.
    expect(rows.map(r => [r.raver_id, String(r.artist_id), r.festival_id])).toEqual([['r-you', '71', 'f-done']]);

    await page.locator('#lineup-section .postfest-row', { hasText: 'Benda' }).getByRole('button', { name: '❌ Missed' }).click();
    await expect(page.locator('#lineup-section .postfest-card')).toHaveCount(0);
    const done = await page.evaluate(() => window.__store.raver_postfest_checkoffs);
    expect(done).toEqual([expect.objectContaining({ raver_id: 'r-you', festival_id: 'f-done', saw: 1, missed: 1 })]);
    rows = await page.evaluate(() => window.__store.raver_artist_sightings);
    expect(rows).toHaveLength(1);
    // The ✅/❌ chips keep working as before.
    await expect(page.locator('#lineup-section .lineup-seen-btn.seen')).toHaveCount(1);
  });

  test('stays away while the rave is still on, once answered, and for raves long past', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-26T15:00:00')); // day 2 of 2
    await bootAuthedApp(page, { data: checkoffData() });
    await page.evaluate(() => openRaveFocus('f-done'));
    await expect(page.locator('#lineup-section')).toContainText('Kaskade');
    await expect(page.locator('.postfest-card')).toHaveCount(0);

    const answered = await page.evaluate(() => {
      raverPostfestCheckoffs.push({ raver_id: 'r-you', festival_id: 'f-done' });
      return postfestPending('f-done');
    });
    expect(answered).toBeNull();
  });

  test('Done keeps the unanswered picks as picks', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:00'));
    await bootAuthedApp(page, { data: checkoffData() });
    await page.evaluate(() => openRaveFocus('f-done'));
    await page.locator('.postfest-card .postfest-done').click();
    await expect(page.locator('.postfest-card')).toHaveCount(0);
    const done = await page.evaluate(() => window.__store.raver_postfest_checkoffs);
    expect(done).toEqual([expect.objectContaining({ saw: 0, missed: 0 })]);
    expect(await page.evaluate(() => window.__store.raver_artist_plans.length)).toBe(2);
  });
});

test.describe('Settings — Lineup alerts', () => {
  test('every type is on until turned off, and the choice is saved per type', async ({ page }) => {
    const d = seedData();
    d.alert_preferences = [{ user_id: TEST_UID, type: 'set_times', enabled: false }];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    await expect(page.locator('#alert-toggle-artist_added')).toHaveClass(/\bon\b/);
    await expect(page.locator('#alert-toggle-set_times')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#alert-toggle-postfest')).toHaveClass(/\bon\b/);

    await page.locator('#alert-toggle-postfest').click();
    await expect(page.locator('#alert-toggle-postfest')).not.toHaveClass(/\bon\b/);
    await page.locator('#alert-toggle-set_times').click();
    await expect(page.locator('#alert-toggle-set_times')).toHaveClass(/\bon\b/);
    const prefs = await page.evaluate(() => window.__store.alert_preferences.map(p => [p.type, p.enabled]).sort());
    expect(prefs).toEqual([['postfest', false], ['set_times', true]]);
  });
});
