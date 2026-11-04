const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// Rave Plan → Lineup tab: the rave's lineup with who in the crew picked each
// set (same picks as the Briefing) and a crew meetup per set (set_meetups).
// Seed: Bass Syndicate (c1) going to Tomorrowland (f1) — you + Kai + Sam.
function lineupData() {
  const data = seedData();
  data.raver_festivals = data.raver_festivals.concat([{ raver_id: 'r-kai', festival_id: 'f1' }]);
  data.artists = data.artists.concat([
    { id: 'a2', name: 'Amelie Lens', genres: ['techno'] },
    { id: 'a3', name: 'Fred again..', genres: ['house'] },
  ]);
  data.artist_festival_appearances = [
    { id: 1, artist_id: 'a1', festival_id: 'f1', is_headliner: true, night: null, note: null, start_at: '2099-07-18T20:00:00Z', end_at: '2099-07-18T21:30:00Z', stage: 'Mainstage' },
    { id: 2, artist_id: 'a2', festival_id: 'f1', is_headliner: false, night: null, note: null, start_at: '2099-07-18T21:00:00Z', end_at: '2099-07-18T22:00:00Z', stage: 'Freedom' },
    { id: 3, artist_id: 'a3', festival_id: 'f1', is_headliner: false, night: null, note: null, start_at: null, end_at: null, stage: null },
  ];
  data.raver_artist_plans = [
    { raver_id: 'r-you', artist_id: 'a1', festival_id: 'f1' },
    { raver_id: 'r-kai', artist_id: 'a1', festival_id: 'f1' },
    { raver_id: 'r-kai', artist_id: 'a2', festival_id: 'f1' },
  ];
  data.set_meetups = [];
  return data;
}

async function openLineupTab(page) {
  await page.evaluate(async () => { await openDetail('c1', { tab: 'gameplan' }); });
  await expect(page.locator('#crew-feature-panel-raveplan')).toBeVisible();
  await page.locator('#crew-feature-panel-raveplan .game-plan-section-tab[data-section="lineup"]').click();
  await expect(page.locator('#game-plan-section-lineup')).toBeVisible();
}

const rowFor = (page, name) => page.locator('#game-plan-section-lineup .gp-lineup-row', { hasText: name });

test.describe('rave plan lineup tab', () => {
  test('lists the whole lineup in set order with who picked each set', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: lineupData() });
    await openLineupTab(page);
    const names = await page.locator('#game-plan-section-lineup .gp-lineup-name b').allTextContents();
    expect(names).toEqual(['Charlotte de Witte', 'Amelie Lens', 'Fred again..']);
    await expect(rowFor(page, 'Amelie Lens').locator('.gp-lineup-who')).toHaveCount(1);
    await expect(rowFor(page, 'Charlotte de Witte').locator('.gp-lineup-who')).toHaveCount(2);
    await expect(rowFor(page, 'Fred again..').locator('.gp-lineup-who')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the pick toggle writes the same raver_artist_plans rows', async ({ page }) => {
    await bootAuthedApp(page, { data: lineupData() });
    await openLineupTab(page);
    await rowFor(page, 'Fred again..').locator('.lineup-plan-btn').click();
    await expect(rowFor(page, 'Fred again..').locator('.lineup-plan-btn')).toHaveAttribute('aria-pressed', 'true');
    await rowFor(page, 'Charlotte de Witte').locator('.lineup-plan-btn').click();
    const mine = await page.evaluate(() => window.__store.raver_artist_plans.filter(p => p.raver_id === 'r-you').map(p => p.artist_id).sort());
    expect(mine).toEqual(['a3']);
  });

  test('set, edit and clear a meetup for a set, posting to the rave Huddle', async ({ page }) => {
    await bootAuthedApp(page, { data: lineupData() });
    await openLineupTab(page);
    // Only picked sets offer a meetup.
    await expect(rowFor(page, 'Fred again..').locator('.gp-lineup-link')).toHaveCount(0);
    await rowFor(page, 'Charlotte de Witte').locator('button', { hasText: 'Set meetup' }).click();
    await page.fill('#gp-meet-spot', 'Left of the sound booth');
    await rowFor(page, 'Charlotte de Witte').locator('button', { hasText: 'Save' }).click();
    await expect(rowFor(page, 'Charlotte de Witte').locator('.gp-lineup-meet')).toContainText('Left of the sound booth');

    let rows = await page.evaluate(() => window.__store.set_meetups);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ crew_id: 'c1', festival_id: 'f1', artist_id: 'a1', spot: 'Left of the sound booth' });
    expect(rows[0].meet_at).toBeTruthy(); // prefilled from the set start
    const huddle = await page.evaluate(() => (window.__store.huddle_messages || []).map(m => m.body).join('\n'));
    expect(huddle).toContain('set the meetup for Charlotte de Witte: Left of the sound booth');

    await rowFor(page, 'Charlotte de Witte').locator('button', { hasText: 'Edit' }).click();
    await page.fill('#gp-meet-spot', 'Totem by the bar');
    await rowFor(page, 'Charlotte de Witte').locator('button', { hasText: 'Save' }).click();
    rows = await page.evaluate(() => window.__store.set_meetups);
    expect(rows.map(r => r.spot)).toEqual(['Totem by the bar']);

    await rowFor(page, 'Charlotte de Witte').locator('button', { hasText: 'Edit' }).click();
    await rowFor(page, 'Charlotte de Witte').locator('button', { hasText: 'Clear' }).click();
    await expect(rowFor(page, 'Charlotte de Witte').locator('.gp-lineup-meet')).toHaveCount(0);
    expect(await page.evaluate(() => window.__store.set_meetups)).toHaveLength(0);
  });

  test('the Briefing lineup still shows only crew-picked sets', async ({ page }) => {
    await bootAuthedApp(page, { data: lineupData() });
    await page.evaluate(async () => { await openDetail('c1', { tab: 'gameplan' }); });
    await page.locator('#crew-feature-panel-raveplan button', { hasText: 'Mission Briefing' }).click();
    const lineup = page.locator('#mb-card-lineup');
    await expect(lineup).toContainText('Charlotte de Witte');
    await expect(lineup).toContainText('overlap 30 min');
    await expect(lineup.locator('.mb-sched .nm b')).toHaveCount(2);
  });
});
