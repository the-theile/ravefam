// "What were your top 3 sets? 🏆" on a past rave's Lineup tab
// (topSetsCardHTML, "===== Top 3 sets" section), the crew recap
// (crewTopSetsHTML) and the "My top 3 sets" share card variant.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

function topSetsData(extra = {}) {
  const d = seedData();
  d.festivals.push({ id: 'f-done', name: 'Done Fest', date: '2026-09-25', location: 'Orlando, FL', color: '#39FF14', days: 2, deleted_at: null, slug: 'done-fest' });
  d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-done' }, { raver_id: 'r-kai', festival_id: 'f-done' });
  d.artists.push({ id: 71, name: 'Kaskade', genres: ['house'] }, { id: 72, name: 'Benda', genres: ['techno'] },
    { id: 73, name: 'Odd Mob', genres: ['house'] }, { id: 74, name: 'Mau P', genres: ['techno'] });
  d.artist_festival_appearances = [71, 72, 73, 74].map(id => ({ artist_id: id, festival_id: 'f-done' }));
  d.raver_artist_plans = [];
  d.raver_artist_sightings = [71, 72, 73].map(id => ({ raver_id: 'r-you', artist_id: id, festival_id: 'f-done' }));
  d.raver_postfest_checkoffs = [];
  d.raver_top_sets = [];
  d.__rpc = { set_top_sets: null };
  return Object.assign(d, extra);
}

const lastTopSetsCall = (page) => page.evaluate(() =>
  (window.__store.__rpcCalls || []).filter(c => c.fn === 'set_top_sets').pop());

test.describe('Top 3 sets 🏆', () => {
  test('tap order ranks #1-#3, a ❌ pick becomes seen, then Share and Edit', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:00'));
    await bootAuthedApp(page, { data: topSetsData() });
    await page.evaluate(() => openRaveFocus('f-done'));
    const card = page.locator('#lineup-section .topsets-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.postfest-title')).toHaveText('What were your top 3 sets? 🏆');
    // Seen sets first; Mau P (marked missed) last and dashed.
    await expect(card.locator('button.topsets-chip')).toHaveText(['Kaskade', 'Benda', 'Odd Mob', 'Mau P']);
    await expect(card.locator('button.topsets-chip.unseen')).toHaveText('Mau P');

    await card.getByRole('button', { name: 'Benda' }).click();
    await page.locator('#lineup-section .topsets-card').getByRole('button', { name: 'Mau P' }).click();
    await page.locator('#lineup-section .topsets-card').getByRole('button', { name: 'Kaskade' }).click();

    const full = page.locator('#lineup-section .topsets-card');
    await expect(full.locator('.topsets-chip.on')).toHaveText(['#1Benda', '#2Mau P', '#3Kaskade']);
    await expect(full.locator('button.topsets-chip:not(.on)')).toHaveCount(0);
    await expect(full.getByRole('button', { name: '📲 Share my top 3' })).toBeVisible();
    const call = await lastTopSetsCall(page);
    expect(call.args).toEqual({ p_raver_id: 'r-you', p_festival_id: 'f-done', p_artist_ids: [72, 74, 71] });
    // Mau P is now seen on the lineup chips too.
    expect(await page.evaluate(() => myLineupSightingIds('f-done').has('74'))).toBe(true);

    // Edit → drop #2 → the rest move up, and a slot opens.
    await full.getByRole('button', { name: '✏️ Edit' }).click();
    await page.locator('#lineup-section .topsets-card').getByRole('button', { name: 'Drop Mau P from your top 3' }).click();
    await expect(page.locator('#lineup-section .topsets-card .topsets-chip.on')).toHaveText(['#1Benda ✕', '#2Kaskade ✕']);
    expect((await lastTopSetsCall(page)).args.p_artist_ids).toEqual([72, 71]);
  });

  test('waits for "Who\'d you catch? 📼", stays away before the rave is over, and opens the Lineup tab', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:00'));
    await bootAuthedApp(page, { data: topSetsData({ raver_artist_plans: [{ raver_id: 'r-you', artist_id: 74, festival_id: 'f-done' }] }) });
    await page.evaluate(() => openRaveFocus('f-done'));
    await expect(page.locator('#lineup-section .postfest-card')).toBeVisible();
    await expect(page.locator('#lineup-section .topsets-card')).toHaveCount(0);
    await page.locator('#lineup-section .postfest-card .postfest-done').click();
    await expect(page.locator('#lineup-section .topsets-card')).toBeVisible();
    const pending = await page.evaluate(() => [topSetsPending('f-done'), _raveFocusTab]);
    expect(pending).toEqual([true, 'lineup']);
  });

  test('un-seeing a set drops it from your top 3', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:00'));
    await bootAuthedApp(page, { data: topSetsData({ raver_top_sets: [
      { raver_id: 'r-you', festival_id: 'f-done', artist_id: 71, rank: 1 },
      { raver_id: 'r-you', festival_id: 'f-done', artist_id: 72, rank: 2 },
    ] }) });
    // Already picked → it opens on Plan, like any other rave.
    await page.evaluate(() => { openRaveFocus('f-done'); raveFocusSwitchTab('lineup'); });
    await expect(page.locator('#lineup-section .topsets-card .topsets-chip.on')).toHaveText(['#1Kaskade ✕', '#2Benda ✕']);
    await page.evaluate(() => dbToggleArtistSighting('f-done', 71));
    await expect(page.locator('#lineup-section .topsets-card .topsets-chip.on')).toHaveText(['#1Benda ✕']);
  });

  test('the FAM recap counts crewmates\' picks and calls out a shared #1', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:00'));
    await bootAuthedApp(page, { data: topSetsData({ raver_top_sets: [
      { raver_id: 'r-you', festival_id: 'f-done', artist_id: 71, rank: 1 },
      { raver_id: 'r-you', festival_id: 'f-done', artist_id: 72, rank: 2 },
      { raver_id: 'r-kai', festival_id: 'f-done', artist_id: 71, rank: 1 },
      { raver_id: 'r-kai', festival_id: 'f-done', artist_id: 73, rank: 3 },
    ] }) });
    // Already picked → it opens on Plan, like any other rave.
    await page.evaluate(() => { openRaveFocus('f-done'); raveFocusSwitchTab('lineup'); });
    const recap = page.locator('#lineup-section .topsets-recap');
    await expect(recap).toContainText('From 2 of you');
    await expect(recap.locator('.topsets-recap-row').first()).toContainText('Kaskade');
    await expect(recap.locator('.topsets-recap-row').first().locator('.topsets-recap-n')).toHaveText('♥ 2 · 2× #1');
    await expect(recap.locator('.topsets-twin')).toHaveText('🤝 You & Kai both had Kaskade as #1');
  });

  test('no recap with only your own picks', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:00'));
    await bootAuthedApp(page, { data: topSetsData({ raver_top_sets: [{ raver_id: 'r-you', festival_id: 'f-done', artist_id: 71, rank: 1 }] }) });
    await page.evaluate(() => { openRaveFocus('f-done'); raveFocusSwitchTab('lineup'); });
    await expect(page.locator('#lineup-section .topsets-card')).toBeVisible();
    await expect(page.locator('#lineup-section .topsets-recap')).toHaveCount(0);
  });

  test('Share puts your ranked sets on the Rave Card and in the share text', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:00'));
    await bootAuthedApp(page, { data: topSetsData({ raver_top_sets: [
      { raver_id: 'r-you', festival_id: 'f-done', artist_id: 73, rank: 1 },
      { raver_id: 'r-you', festival_id: 'f-done', artist_id: 71, rank: 3 },
    ] }) });
    // Already picked → it opens on Plan, like any other rave.
    await page.evaluate(() => { openRaveFocus('f-done'); raveFocusSwitchTab('lineup'); });
    await page.locator('#lineup-section .topsets-card').getByRole('button', { name: '📲 Share my top 2' }).click();
    const cardEl = page.locator('#rave-share-card');
    await expect(cardEl.locator('.rave-share-topset')).toHaveText(['#1Odd Mob', '#2Kaskade']);
    await expect(cardEl.locator('.rave-share-avatars')).toHaveCount(0);
    const text = await page.evaluate(() => buildRaveShareText(getFestival('f-done')));
    expect(text).toContain('🏆 My top sets: #1 Odd Mob · #2 Kaskade');

    // The regular Share button keeps the crew poster.
    await page.evaluate(() => { closeRaveShareCard(); openRaveShareCard('f-done'); });
    await expect(page.locator('#rave-share-card .rave-share-avatars')).toHaveCount(1);
    await expect(page.locator('#rave-share-card .rave-share-topsets')).toHaveCount(0);
  });
});
