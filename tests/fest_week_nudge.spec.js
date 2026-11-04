// Fest-week card on a rave (raveNudgeHTML): card order, "Not now", the
// blocked-notifications variant, the ?remind=1 deep link, and the Village
// line opening Browse filtered to that rave.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData } = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;
const guidance = () => ({
  v: 2, first_seen: Date.now() - 30 * DAY, help_level: 'guide', realms: {}, zones: {}, realm_tips_off: {},
  tips: {}, hints: {}, setup_items: {}, quests: { welcome_2_0: true }, skips: 0, fewer_tips_offered: false,
  rave_mode: null, found_during_rave: []
});
// Two days out, named so getLineupExplorerUrl() finds the EDC Orlando explorer.
function edcSoon() {
  const d = new Date(Date.now() + 2 * DAY);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { id: 'f-edc', name: 'EDC Orlando', date: iso, location: 'Orlando, FL', days: 3, deleted_at: null };
}

async function boot(page) {
  const d = seedData();
  d.festivals.push(edcSoon());
  await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: guidance() } }, data: d });
  // Lineup URL is year-matched; skip the test if the explorer list has moved on.
  return page.evaluate(() => !!getLineupExplorerUrl(getFestival('f-edc')));
}

test.describe('Fest-week card', () => {
  test('reminders card: picks deep-link to the 🔔, Not now hides it for that rave', async ({ page }) => {
    const errors = collectPageErrors(page);
    test.skip(!(await boot(page)), 'EDC Orlando explorer not listed for this year');
    await page.evaluate(() => { _pushBlocked = false; window.crewmatesGoing = () => []; });

    let card = await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')));
    expect(card).toContain('Pick my sets');
    expect(card).not.toContain('remind=1');
    expect(card).toContain('Not now');
    expect(card).toContain("jumpToVendorVillage(null, 'f-edc')");

    await page.evaluate(() => { window.myLineupPlanIds = () => new Set(['a1']); });
    card = await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')));
    expect(card).toContain('🔔 Remind me');
    expect(card).toContain("turnOnSetRemindersInApp('f-edc')");

    await page.evaluate(() => hideFestNudge('f-edc', 'remind'));
    expect(await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')))).toBe('');
    expect(await page.evaluate(() => _guidance.fest_nudge_off['f-edc'].remind)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('blocked notifications swap in the Settings card', async ({ page }) => {
    test.skip(!(await boot(page)), 'EDC Orlando explorer not listed for this year');
    await page.evaluate(() => { _pushBlocked = true; window.crewmatesGoing = () => []; });
    const card = await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')));
    expect(card).toContain('Notifications are off');
    expect(card).toContain('openNotificationSettings()');
  });

  test('a lead with unclaimed tasks sees Plan check first, then reminders after Not now', async ({ page }) => {
    test.skip(!(await boot(page)), 'EDC Orlando explorer not listed for this year');
    await page.evaluate(() => {
      _pushBlocked = false;
      window.crewmatesGoing = () => [{ crew: { id: 'c-lead', isLead: true }, going: [{ id: 'r2' }] }];
      _festPlanOpen['c-lead|f-edc'] = 3;
    });
    expect(await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')))).toContain('Plan check before you go');
    await page.evaluate(() => hideFestNudge('f-edc', 'plan'));
    expect(await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')))).toContain('Turn on set reminders');

    // Nothing unclaimed: reminders come first, crew card after.
    await page.evaluate(() => { _guidance.fest_nudge_off = {}; _festPlanOpen['c-lead|f-edc'] = 0; });
    expect(await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')))).toContain('Turn on set reminders');
    await page.evaluate(() => hideFestNudge('f-edc', 'remind'));
    expect(await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')))).toContain('Plan check before you go');
  });

  test('in-app 🔔 builds the explorer\'s list from the DB and turns reminders on', async ({ page }) => {
    const errors = collectPageErrors(page);
    const d = seedData();
    d.festivals.push({ ...edcSoon(), slug: 'edc-orlando-2026' });
    const t = h => new Date(Date.now() + 2 * DAY + h * 3600000).toISOString();
    d.__rpc = {
      get_lineup_set_times: { ok: true, tz: 'America/New_York', sets: [
        { artist_id: 'a1', name: 'Alpha', start_at: t(0), end_at: t(1), stage: 'Main' },
        { artist_id: 'a2', name: 'Bravo', start_at: t(0.5), end_at: t(1.5), stage: 'Side' },   // clashes with Alpha; Alpha kept
        { artist_id: 'a3', name: 'Charlie', start_at: t(3), end_at: t(4), stage: 'Main' },     // b2b with Delta
        { artist_id: 'a4', name: 'Delta', start_at: t(3), end_at: t(4), stage: 'Main' },
        { artist_id: 'a5', name: 'Echo', start_at: t(5), end_at: t(6), stage: 'Side' },        // crew Fam Fave only
        { artist_id: 'a6', name: 'Foxtrot', start_at: t(7), end_at: t(8), stage: 'Side' },     // not picked
      ] },
      get_lineup_crew_votes: { ok: true, votes: [{ crew: 'Fam', closed: true, faves: ['a5'] }] },
      set_set_reminders: { ok: true, on: true, n: 3 },
    };
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: guidance() } }, data: d });
    await page.evaluate(() => {
      const me = squad.find(r => r.isYou);
      (window.__store.raver_clash_choices = window.__store.raver_clash_choices || []).push(
        { raver_id: me.id, festival_id: 'f-edc', choices: { 'Alpha|Bravo': 'Alpha' } });
      window.myLineupPlanIds = () => new Set(['a1', 'a2', 'a3', 'a4']);
      window.ensurePushSubscription = async () => {};
      window.crewmatesGoing = () => [];
      _pushBlocked = false;
    });
    await page.evaluate(() => turnOnSetRemindersInApp('f-edc'));
    const call = await page.evaluate(() => window.__store.__rpcCalls.find(c => c.fn === 'set_set_reminders'));
    expect(call.args.p_on).toBe(true);
    expect(call.args.p_sets.map(x => [x.name, x.kind])).toEqual([['Alpha', 'pick'], ['Charlie b2b Delta', 'pick'], ['Echo', 'fam']]);
    expect(await page.evaluate(() => _reminderOptinFestIds.has('f-edc'))).toBe(true);
    expect(await page.evaluate(() => raveNudgeHTML(getFestival('f-edc')))).not.toContain('Turn on set reminders');
    expect(errors).toEqual([]);
  });

  test('Village line opens Browse filtered to the rave; the chip clears it', async ({ page }) => {
    const errors = collectPageErrors(page);
    await boot(page);
    await page.evaluate(async () => {
      await dbAddVendor({ name: 'Edc Kandi', category: 'jewelry_kandi', description: '', websiteUrl: '', instagram: '' });
      await dbAddVendor({ name: 'Elsewhere Glass', category: 'glass_art', description: '', websiteUrl: '', instagram: '' });
    });
    await page.evaluate(async () => {
      await jumpToVendorVillage(null, 'f-edc');
      const v = vendors.find(x => x.name === 'Edc Kandi');
      vendorFestivalTagsCache[v.id] = [{ vendor_id: v.id, festival_id: 'f-edc' }];
      renderVendorBrowseList();
    });
    const panel = page.locator('#vv-browse-panel');
    await expect(panel).toContainText('EDC Orlando');
    await expect(panel).toContainText('Edc Kandi');
    await expect(panel).not.toContainText('Elsewhere Glass');
    await page.evaluate(() => closeZoneSheet());  // Village first-visit sheet
    await page.waitForTimeout(350);
    await page.click('#vv-browse-panel button[aria-label="Show all vendors"]');
    await expect(panel).toContainText('Elsewhere Glass');
    expect(errors).toEqual([]);
  });
});
