const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Mission Briefing: the swipeable dossier deck over a crew's Rave Plan.
// Seed: Bass Syndicate (c1) going to Tomorrowland (f1) — you + Kai (claimed)
// + Sam (unclaimed), with a small lineup and a couple of crew picks.
function briefingData() {
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
  return data;
}

async function openBriefing(page) {
  await page.evaluate(async () => { await openDetail('c1', { tab: 'gameplan' }); });
  await expect(page.locator('#crew-feature-panel-raveplan')).toBeVisible();
  await page.locator('#crew-feature-panel-raveplan button', { hasText: 'Mission Briefing' }).click();
  await expect(page.locator('#mission-briefing-overlay')).toHaveClass(/open/);
  await expect(page.locator('#mission-briefing-overlay .mb-page')).toHaveCount(8);
}

const items = (page, kind) => page.evaluate(k => (window.__store.game_plan_items || []).filter(it => it.kind === k), kind);

test.describe('mission briefing', () => {
  test('opens from the Rave Plan with all eight pages and no errors', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: briefingData() });
    await openBriefing(page);
    const cover = page.locator('#mb-card-cover');
    await expect(cover).toContainText('Tomorrowland');
    await expect(cover).toContainText('Operatives · 3');
    const lineup = page.locator('#mb-card-lineup');
    await expect(lineup).toContainText('Charlotte de Witte');
    await expect(lineup).toContainText('Amelie Lens');
    // Charlotte (you + Kai) overlaps Amelie (Kai only) by 30 minutes.
    await expect(lineup).toContainText('overlap 30 min');
    await expect(page.locator('#mb-card-signoff')).toContainText('not on RaveFAM yet'); // Sam
    expect(errors).toEqual([]);
  });

  test('orders, kit and lineup edits write through and re-render', async ({ page }) => {
    await bootAuthedApp(page, { data: briefingData() });
    await openBriefing(page);

    await page.fill('#mb-task-text', 'Charge power banks');
    await page.selectOption('#mb-task-phase', 'night_before');
    await page.locator('#mb-card-orders button', { hasText: 'Add' }).first().click();
    await expect(page.locator('#mb-card-orders')).toContainText('Charge power banks');
    const [task] = await items(page, 'task');
    expect(task.phase).toBe('night_before');
    await page.locator('#mb-card-orders .mb-box').first().click();
    expect((await items(page, 'task'))[0].is_done).toBe(true);

    await page.locator('#mb-card-orders .mb-role.open', { hasText: 'First Aid' }).click();
    expect((await items(page, 'role')).map(r => r.role_name)).toContain('First Aid');

    await page.fill('#mb-pack-mine', 'Earplugs');
    await page.locator('#mb-card-kit button', { hasText: 'Add' }).first().click();
    await page.fill('#mb-pack-crew', 'Speaker');
    await page.locator('#mb-card-kit button', { hasText: 'Add' }).nth(1).click();
    const packs = await items(page, 'pack');
    expect(packs.map(p => [p.text, p.scope]).sort()).toEqual([['Earplugs', 'personal'], ['Speaker', 'crew']]);
    await page.locator('#mb-card-kit button', { hasText: "I'LL BRING IT" }).click();
    expect((await items(page, 'pack')).find(p => p.text === 'Speaker').assignee_raver_id).toBe('r-you');

    await page.selectOption('#mb-pick-add', 'a3');
    await page.locator('#mb-card-lineup button', { hasText: 'Add' }).click();
    const picks = await page.evaluate(() => window.__store.raver_artist_plans.filter(p => p.raver_id === 'r-you').map(p => p.artist_id).sort());
    expect(picks).toEqual(['a1', 'a3']);
  });

  test('budget: off by default, then log a cost, settle up and mark paid', async ({ page }) => {
    await bootAuthedApp(page, { data: briefingData() });
    await openBriefing(page);
    const ledger = page.locator('#mb-card-ledger');
    await expect(ledger).toContainText('No cost split for this rave');

    await ledger.locator('.mb-sw').click();
    await expect(ledger.locator('#mb-exp-text')).toBeVisible();
    await page.fill('#mb-exp-text', 'Airbnb');
    await page.fill('#mb-exp-amt', '$90');
    await ledger.locator('button', { hasText: 'Log cost' }).click();
    const [exp] = await items(page, 'expense');
    expect(exp).toMatchObject({ text: 'Airbnb', amount_cents: 9000, assignee_raver_id: 'r-you', split_raver_ids: null });
    // 3 going, you paid $90: Sam and Kai each owe you $30.
    await expect(ledger).toContainText("You're owed $60.00");
    await expect(ledger.locator('.mb-owe')).toHaveCount(2);

    await ledger.locator('button', { hasText: 'mark paid' }).first().click();
    const [pay] = await items(page, 'payment');
    expect(pay.amount_cents).toBe(3000);
    expect(pay.to_raver_id).toBe('r-you');
    await expect(ledger).toContainText("You're owed $30.00");
    await expect(ledger.locator('.mb-paid')).toHaveCount(1);
  });

  test('sign-off locks you in, and closing hands the Rave Plan back', async ({ page }) => {
    await bootAuthedApp(page, { data: briefingData() });
    await openBriefing(page);
    const signoff = page.locator('#mb-card-signoff');
    await expect(signoff).toContainText('0/2');
    await signoff.locator('button', { hasText: 'SIGN & LOCK IN' }).click();
    const [ready] = await items(page, 'ready');
    expect(ready).toMatchObject({ assignee_raver_id: 'r-you', is_done: true, added_by: TEST_UID });
    await expect(signoff).toContainText('1/2');
    await expect(signoff.locator('button', { hasText: 'UNSIGN' })).toBeVisible();

    await page.locator('.mb-x').click();
    await expect(page.locator('#mission-briefing-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#crew-feature-panel-raveplan button', { hasText: 'Mission Briefing' })).toBeVisible();
  });

  test('Escape closes the deck', async ({ page }) => {
    await bootAuthedApp(page, { data: briefingData() });
    await openBriefing(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#mission-briefing-overlay')).not.toHaveClass(/open/);
  });
});
