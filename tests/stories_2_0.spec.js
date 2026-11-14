// Release check for 2.0 (build plan step R3), run locally on the stubbed
// backend: the two end-to-end stories from the design work, replayed against
// the real app. Story 01 is Nova, invited into a crew; Story 02 is Jules, a
// solo Lead a few days in. Server-side PLUR is covered by the migrations'
// own SQL checks — here the app must only show what the server recorded.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData, TEST_UID } = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;
// A fresh 2.0 raver who already made the signup help choice.
const freshGuidance = (firstSeenAgo = 0) => ({
  v: 2, first_seen: Date.now() - firstSeenAgo, help_level: 'guide', realms: {}, zones: {}, realm_tips_off: {},
  tips: {}, hints: {}, setup_items: {}, quests: { welcome_2_0: true }, skips: 0, fewer_tips_offered: false,
  rave_mode: null, found_during_rave: []
});

async function closeSheets(page) {
  await page.evaluate(() => { closeZoneSheet(); document.getElementById('gk-moment-screen')?.remove(); });
  await page.waitForTimeout(350);
}
const lastSheetTitle = page => page.locator('.gk-sheet .gk-title').last();
const interrupts = page => page.evaluate(() => _gkSession.interrupts);

test.describe('Story 01 · Nova, invited into Bass Syndicate', () => {
  function novaData() {
    const d = seedData();
    // Kai leads the crew; Nova (r-you) is a member.
    d.crews = d.crews.map(c => ({ ...c, leader_id: 'someone-else' }));
    d.raver_festivals.push({ raver_id: 'r-sam', festival_id: 'f2' });
    d.__rpc = { claim_realm_discovery: true };
    return d;
  }

  test('day one: welcome, Huddle, Find your sound, first RSVP, every place — within the day-one cap', async ({ page }) => {
    const errors = collectPageErrors(page);
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: freshGuidance() } }, data: novaData() });

    // The crew page greets a member once and points at the Huddle.
    await page.evaluate(() => openDetail('c1'));
    await expect(lastSheetTitle(page)).toHaveText('Welcome to Bass Syndicate');
    expect(await interrupts(page)).toBe(1);
    await expect(page.locator('#crew-quest-row')).toContainText('GET SETTLED');
    await closeSheets(page);

    // Opening the Huddle is her own tap: its intro is free.
    await page.evaluate(() => openHuddle('c1'));
    await expect(lastSheetTitle(page)).toHaveText('Huddle');
    expect(await interrupts(page)).toBe(1);
    await closeSheets(page);
    await page.fill('#huddle-text-input', 'made it in!');
    await page.press('#huddle-text-input', 'Enter');
    await expect(page.locator('#hd-hint-slot')).toContainText('You’re in the chat');
    expect(await page.evaluate(() => !!_guidance.quests['hi:c1'])).toBe(true);
    await page.evaluate(() => closeHuddleScreen());

    // Raves: the unlock banner and Find your sound.
    await page.evaluate(() => switchTab('events'));
    await expect(page.locator('.gk-banner').last()).toContainText('+10 Unity · Raves');
    await expect(lastSheetTitle(page)).toHaveText('Find your sound');
    expect(await interrupts(page)).toBe(2);
    await page.locator('.gk-sheet').last().getByRole('button', { name: 'Trance', exact: true }).click();
    await page.locator('.gk-sheet .gk-btn.primary').last().click();
    await expect.poll(() => page.evaluate(() => window.__store.ravers.find(r => r.id === 'r-you').genres)).toContain('Trance');

    // First RSVP, with a crewmate going: the Rave Plan is the next step.
    await page.evaluate(() => toggleGoingToFest('f2'));
    await expect(lastSheetTitle(page)).toHaveText('You’re going!');
    await expect(page.locator('.gk-sheet').last()).toContainText('Rave Plan');
    await expect(page.locator('.gk-sheet .gk-btn.primary').last()).toHaveText('See the Rave Plan');
    await closeSheets(page);

    // The rest of the places, each with its intro, fill the day-one budget.
    for (const tab of ['members', 'stats', 'checklist']) {
      await page.evaluate(t => switchTab(t), tab);
      await expect(page.locator('.gk-sheet')).toHaveCount(1);
      await closeSheets(page);
    }
    expect(await interrupts(page)).toBe(5);
    expect(await page.evaluate(() => gkCanInterrupt({ kind: 'intro' }))).toBe(false);
    // Asked-for things still get through.
    expect(await page.evaluate(() => gkCanInterrupt({ asked: true }))).toBe(true);
    const claimed = await page.evaluate(() => window.__store.__rpcCalls.filter(c => c.fn === 'claim_realm_discovery').map(c => c.args.p_realm).sort());
    expect(claimed).toEqual(['crews', 'ravers', 'raves', 'stats', 'village']);
    expect(errors).toEqual([]);
  });

  test('the claim moment shows one +35 Unity line, read from what the server recorded', async ({ page }) => {
    const d = novaData();
    const now = new Date().toISOString();
    d.point_events = [
      { user_id: TEST_UID, raver_id: 'r-you', event_type: 'invite_claimed_invitee', track: 'unity', amount: 15, created_at: now, metadata: {} },
      { user_id: TEST_UID, raver_id: 'r-you', event_type: 'crew_joined', track: 'unity', amount: 10, created_at: now, metadata: {} },
      { user_id: TEST_UID, raver_id: 'r-you', event_type: 'realm_discovered', track: 'unity', amount: 10, created_at: now, metadata: { realm: 'crews' } },
      // Not part of the claim: must not be counted.
      { user_id: TEST_UID, raver_id: 'r-you', event_type: 'realm_discovered', track: 'unity', amount: 10, created_at: now, metadata: { realm: 'village' } },
    ];
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: freshGuidance() } }, data: d });
    await page.evaluate(() => showClaimSuccess({ crew: { name: 'Bass Syndicate', color: '#FF2D78' }, raver: { name: 'Nova' } },
      { plurSince: new Date(Date.now() - 60000).toISOString() }));
    await expect(page.locator('.success-crew-name')).toHaveText('You’re officially in Bass Syndicate');
    await expect(page.locator('#success-plur')).toHaveText('+35 Unity · spot claimed, joined, Crews found');
  });
});

test.describe('Story 02 · Jules, solo Lead a few days in', () => {
  test('after day one the cap is 3: the 4th place saves its intro for later, and the hub offers Resume', async ({ page }) => {
    const errors = collectPageErrors(page);
    const d = seedData();
    d.__rpc = { claim_realm_discovery: true };
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: freshGuidance(3 * DAY) } }, data: d });
    for (const tab of ['events', 'members', 'stats']) {
      await page.evaluate(t => switchTab(t), tab);
      await expect(page.locator('.gk-sheet')).toHaveCount(1);
      await closeSheets(page);
    }
    expect(await interrupts(page)).toBe(3);
    await page.evaluate(() => switchTab('checklist'));
    await expect(page.locator('.gk-banner').last()).toContainText('Village');
    await page.waitForTimeout(300);
    await expect(page.locator('.gk-sheet')).toHaveCount(0);
    expect(await page.evaluate(() => _guidance.realms.village)).toBe('saved');
    await expect(page.locator('.nav-tab.c-village .gk-saved-badge')).toHaveCount(1);
    await page.evaluate(() => openAppGuide());
    await expect(page.locator('#guide-hub-root')).toContainText('SAVED FOR LATER');
    await page.click('#guide-hub-root >> text=Resume');
    await expect(lastSheetTitle(page)).toHaveText('Vendor Village');
    expect(errors).toEqual([]);
  });

  test('Rave mode: places found mid-rave stay quiet and wait for the morning after', async ({ page }) => {
    const d = seedData();
    d.__rpc = { claim_realm_discovery: true };
    const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    d.festivals.push({ id: 'f-today', name: 'Tonight Rave', date: iso, location: 'Here', deleted_at: null });
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: freshGuidance(3 * DAY) } }, data: d });
    const card = await page.evaluate(() => raveNudgeHTML(getFestival('f-today')));
    expect(card).toContain('Switch on Rave mode?');
    await page.evaluate(() => raveModeOn('f-today'));
    expect(await page.evaluate(() => raveNudgeHTML(getFestival('f-today')))).toContain('RAVE MODE ON');
    await page.evaluate(() => switchTab('checklist'));
    await page.waitForTimeout(400);
    await expect(page.locator('.gk-banner')).toHaveCount(0);
    await expect(page.locator('.gk-sheet')).toHaveCount(0);
    expect(await page.evaluate(() => _guidance.found_during_rave)).toEqual(['village']);
    // Paid now, even though it's celebrated later.
    const claimed = await page.evaluate(() => window.__store.__rpcCalls.some(c => c.fn === 'claim_realm_discovery' && c.args.p_realm === 'village'));
    expect(claimed).toBe(true);
    // Urgent things still get through in Rave mode.
    expect(await page.evaluate(() => gkCanInterrupt({ urgent: true }))).toBe(true);
    expect(await page.evaluate(() => gkCanInterrupt({ kind: 'intro' }))).toBe(false);
  });

  test('Rave Plan: a new plan starts from a template, and the Lead gets one plan check', async ({ page }) => {
    const errors = collectPageErrors(page);
    await bootAuthedApp(page, { data: seedData() });
    await page.evaluate(() => openDetail('c1', { tab: 'gameplan' }));
    await expect(page.locator('#crew-feature-panel-raveplan')).toContainText('START FROM A TEMPLATE', { timeout: 5000 });
    await page.locator('#crew-feature-panel-raveplan >> text=Club night').click();
    await expect(page.locator('#crew-feature-panel-raveplan')).toContainText('PLAN CHECK · YOU’RE THE LEAD');
    await expect(page.locator('#crew-feature-panel-raveplan')).toContainText('6 tasks unclaimed');
    const store = await page.evaluate(() => window.__store);
    expect(store.game_plans.some(g => g.template_key === 'club')).toBe(true);
    const items = store.game_plan_items.filter(i => i.kind === 'task');
    expect(items.length).toBe(6);
    expect(items.every(i => i.from_template === true)).toBe(true);
    expect(errors).toEqual([]);
  });
});
