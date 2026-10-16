const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// Set Plan: timed 📋 picks as "My Set Plan" on the rave, the crew's picks as
// time-slot lanes in Rave Plan → 🗓️ Sets, and the in-app nudge 15 min out.
// Times are relative to now so "Up next" and the nudge window line up.
function setPlanData({ timed = true } = {}) {
  const d = seedData();
  const at = (min) => new Date(Date.now() + min * 60000).toISOString();
  d.festivals[0].timezone = 'America/New_York';
  d.raver_festivals.push({ raver_id: 'r-kai', festival_id: 'f1' });
  d.ravers.find(r => r.id === 'r-kai').privacy_show_rsvps = false; // claimed, RSVPs hidden
  d.artists = d.artists.concat([
    { id: 'a2', name: 'Amelie Lens', genres: ['techno'] },
    { id: 'a3', name: 'Adam Beyer', genres: ['techno'] },
    { id: 'a4', name: 'Kobosil', genres: ['techno'] },
  ]);
  d.artist_festival_appearances = [
    { artist_id: 'a1', festival_id: 'f1', start_at: timed ? at(10) : null, end_at: timed ? at(70) : null, stage: 'Mainstage' },
    { artist_id: 'a2', festival_id: 'f1', start_at: timed ? at(30) : null, end_at: timed ? at(90) : null, stage: 'Freedom' },
    { artist_id: 'a3', festival_id: 'f1', start_at: timed ? at(240) : null, end_at: null, stage: null },
    { artist_id: 'a4', festival_id: 'f1', start_at: null, end_at: null, stage: null },
  ];
  // You: a1 + a2 clash, a3 shared with Sam, a4 has no time yet.
  // Sam: a2 (so the a1/a2 slot is a crew split) + a3 (whole visible crew).
  // Kai picked a1 + a3 but hides RSVPs, so never shows.
  d.raver_artist_plans = [
    ['r-you', 'a1'], ['r-you', 'a2'], ['r-you', 'a3'], ['r-you', 'a4'],
    ['r-sam', 'a2'], ['r-sam', 'a3'],
    ['r-kai', 'a1'], ['r-kai', 'a3'],
  ].map(([raver_id, artist_id]) => ({ raver_id, artist_id, festival_id: 'f1' }));
  return d;
}

test.describe('set plan · my timeline on the rave', () => {
  test('lists timed picks with clash, up next, crewmates and untimed count', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: setPlanData() });
    await page.evaluate(() => openRaveFocus('f1'));

    const card = page.locator('#lineup-section .setplan-card');
    await expect(card).toContainText('My Set Plan');
    await expect(card).toContainText('Festival time');
    await expect(card.locator('.setplan-row')).toHaveCount(3);
    await expect(card.locator('.setplan-row').nth(0)).toContainText('Charlotte de Witte');
    await expect(card.locator('.setplan-row').nth(0)).toContainText('Up next');
    await expect(card.locator('.setplan-row').nth(0)).toContainText('Mainstage');
    await expect(card.locator('.setplan-row.clash')).toHaveCount(2);
    await expect(card.locator('.setplan-row').nth(2)).toContainText('Stage TBA');
    await expect(card).toContainText('+1 pick still waiting on a set time');

    // Sam's face shows on the sets Sam picked; Kai (RSVPs hidden) never does.
    await expect(card.locator('.setplan-faces[aria-label="Sam picked this"]')).toHaveCount(2);
    expect(await card.innerHTML()).not.toContain('Kai');
    expect(errors).toEqual([]);
  });

  test('before set times drop it says so instead of a timeline', async ({ page }) => {
    await bootAuthedApp(page, { data: setPlanData({ timed: false }) });
    await page.evaluate(() => openRaveFocus('f1'));
    const card = page.locator('#lineup-section .setplan-card');
    await expect(card).toContainText('Set times drop soon. Your 4 📋 picks will line up here');
    await expect(card.locator('.setplan-row')).toHaveCount(0);
  });
});

test.describe('set plan · crew lanes in Rave Plan', () => {
  async function openSets(page) {
    await page.evaluate(async () => { await openDetail('c1', { tab: 'gameplan' }); });
    await expect(page.locator('#crew-feature-panel-raveplan')).toBeVisible();
    await page.locator('.game-plan-section-tab[data-section="sets"]').click();
    await expect(page.locator('#game-plan-section-sets')).toBeVisible();
  }

  test('shows together / split counts, the split box and whole-crew sets', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: setPlanData() });
    await openSets(page);

    const sets = page.locator('#game-plan-section-sets');
    await expect(sets).toContainText('Crew Set Plan');
    await expect(sets.locator('.setplan-sum')).toContainText('🫶 1 together');
    await expect(sets.locator('.setplan-sum')).toContainText('⚡ 1 split');
    await expect(sets.locator('.setplan-sum')).toContainText('👥 2 going');

    const split = sets.locator('.setplan-split');
    await expect(split).toHaveCount(1);
    await expect(split).toContainText('Crew splits');
    await expect(split.locator('.setplan-row')).toHaveCount(2);
    await expect(split).toContainText('Charlotte de Witte');
    await expect(split).toContainText('Amelie Lens');
    await expect(split.locator('.setplan-faces[aria-label="You & Sam picked this"]')).toHaveCount(1);

    const beyer = sets.locator('.setplan-row', { hasText: 'Adam Beyer' });
    await expect(beyer).toContainText('🫶 Whole crew');
    expect(await sets.innerHTML()).not.toContain('Kai');
    expect(errors).toEqual([]);
  });

  test('with no timed picks it shows the empty state', async ({ page }) => {
    await bootAuthedApp(page, { data: setPlanData({ timed: false }) });
    await openSets(page);
    await expect(page.locator('#game-plan-section-sets')).toContainText('No set plan yet');
  });
});

test.describe('set plan · 15-min nudge', () => {
  test('nudges once for a set inside 15 min and opens the rave on tap', async ({ page }) => {
    await bootAuthedApp(page, { data: setPlanData() });
    await page.evaluate(() => setPlanTick());

    const nudge = page.locator('#setplan-nudge');
    await expect(nudge).toHaveClass(/show/);
    await expect(nudge).toContainText(/On in (9|10) min: Charlotte de Witte @ Mainstage/);
    // Amelie Lens is 30 min out; Kai picked Charlotte but hides RSVPs.
    await expect(nudge).not.toContainText('Amelie');
    await expect(nudge).not.toContainText('Kai');

    await nudge.locator('.setplan-nudge-x').click();
    await expect(nudge).not.toHaveClass(/show/);
    await page.evaluate(() => setPlanTick());
    await expect(nudge).not.toHaveClass(/show/);

    // A fresh nudge opens the rave on tap.
    await page.evaluate(() => { sessionStorage.removeItem('rf_setplan_nudged'); _setPlanNudged = null; setPlanTick(); });
    await expect(nudge).toHaveClass(/show/);
    await nudge.locator('.setplan-nudge-main').click();
    await expect(page.locator('#rave-focus-overlay')).toHaveClass(/open/);
    await expect(nudge).not.toHaveClass(/show/);
  });
});
