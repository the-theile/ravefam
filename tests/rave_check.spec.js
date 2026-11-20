const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Rave Check: ask a crewmate who hasn't RSVPd whether they're coming.
// Seed (helpers.seedData): Bass Syndicate (c1) = you + Sam (unclaimed) + Kai
// (claimed). You're Interested in Awakenings (f2); Kai hasn't RSVPd to it.
// A third rave (f3) with no RSVPs is added for the receiver tests.
const RC_ID = '11111111-2222-4333-8444-555555555555';
const NOTIF_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function receiverData({ note = 'Carpool?' } = {}) {
  const data = seedData();
  data.festivals = data.festivals.concat([
    { id: 'f3', name: 'Eternal NYE', date: '2099-12-30', location: 'Tampa, FL', color: '#BF00FF', days: 2, deleted_at: null },
  ]);
  data.raver_festivals = data.raver_festivals.concat([{ raver_id: 'r-kai', festival_id: 'f3' }]);
  data.notifications = [{
    id: NOTIF_ID, user_id: TEST_UID, crew_id: 'c1', read: false,
    created_at: new Date().toISOString(),
    message: '🎧 Rave check from Kai: you coming to Eternal NYE?',
    type: 'rave_check',
    data: {
      rave_check_id: RC_ID, festival_id: 'f3', festival_name: 'Eternal NYE', note, actor_id: 'kai-uid',
      links: [{ t: 'Eternal NYE', k: 'rave', id: 'f3' }],
    },
  }];
  data.__rpc = { reply_rave_check: null, rave_check_status: [] };
  return data;
}

const rpcCalls = (page, fn) => page.evaluate(f => (window.__store.__rpcCalls || []).filter(c => c.fn === f), fn);

test.describe('rave check', () => {
  test('sender: rave-check a crewmate from the Crew tab, with a note', async ({ page }) => {
    const data = seedData();
    data.__rpc = { rave_check_status: [], send_rave_check: [{ raver_id: 'r-kai', status: 'sent' }] };
    const errors = await bootAuthedApp(page, { data });
    await page.evaluate(() => { openRaveFocus('f2'); raveFocusSwitchTab('crew'); });

    const panel = page.locator('#rave-focus-modal [data-rf-panel="crew"]');
    await expect(panel.locator('.rc-meter-card')).toContainText('1 of 2 answered');
    // Kai (claimed, no RSVP) gets the button; Sam (unclaimed) can't be rave-checked.
    const kaiRow = panel.locator('#rc-crew-wrap .rf-crew-row', { hasText: 'Kai' });
    await expect(kaiRow.locator('.rc-btn')).toHaveText(/Rave check\?/);
    await expect(panel.locator('#rc-crew-wrap')).not.toContainText('Sam');
    // Only one person open, so no "everyone" button.
    await expect(panel.locator('.rc-everyone')).toHaveCount(0);

    await kaiRow.locator('.rc-btn').click();
    const sheet = page.locator('#rave-check-sheet-overlay');
    await expect(sheet).toHaveClass(/open/);
    await expect(sheet.locator('.modal-title')).toHaveText('Rave check Kai');
    await sheet.locator('.rc-preset', { hasText: 'Carpool?' }).click();
    await expect(sheet.locator('#rave-check-note')).toHaveValue('Carpool?');
    await expect(sheet.locator('.rc-preset', { hasText: 'Carpool?' })).toHaveAttribute('aria-pressed', 'true');
    await sheet.locator('#rave-check-send').click();

    await expect(sheet).not.toHaveClass(/open/);
    const calls = await rpcCalls(page, 'send_rave_check');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ p_festival_id: 'f2', p_raver_ids: ['r-kai'], p_note: 'Carpool?' });
    await expect(kaiRow.locator('.rc-checked')).toHaveText('Checked just now');
    await expect(kaiRow.locator('.rc-btn')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('sender: cooldown and "Can\'t make it" from the server replace the button', async ({ page }) => {
    const data = seedData();
    data.ravers = data.ravers.concat([{ ...data.ravers.find(r => r.id === 'r-kai'), id: 'r-lu', name: 'Lu V.', handle: 'lu', claimed_by: 'lu-uid', qr_token: 'qr-lu' }]);
    data.crew_members = data.crew_members.concat([{ crew_id: 'c1', raver_id: 'r-lu', added_at: '2024-01-01T00:00:00Z', added_by: TEST_UID, deleted_at: null }]);
    data.__rpc = { rave_check_status: [
      { raver_id: 'r-kai', last_checked_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), declined: false },
      { raver_id: 'r-lu', last_checked_at: new Date().toISOString(), declined: true },
    ] };
    await bootAuthedApp(page, { data });
    await page.evaluate(() => { openRaveFocus('f2'); raveFocusSwitchTab('crew'); });

    const wrap = page.locator('#rc-crew-wrap');
    await expect(wrap.locator('.rf-crew-row', { hasText: 'Kai' }).locator('.rc-checked')).toHaveText('Checked 3h ago');
    await expect(wrap.locator('.rf-crew-row', { hasText: 'Lu' })).toContainText("Can't make it");
    await expect(wrap.locator('.rc-btn')).toHaveCount(0);
    // Lu's "no" counts as an answer on the meter.
    await expect(page.locator('#rc-meter-wrap')).toContainText('2 of 3 answered');
  });

  test('receiver: the card in the rave popup saves "I\'m in" as Going', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: receiverData() });
    await page.evaluate(() => openRaveFocus('f3'));

    const card = page.locator('#rc-invite');
    await expect(card).toContainText('Rave check from Kai');
    await expect(card).toContainText('You coming to Eternal NYE?');
    await expect(card.locator('.rc-quote')).toContainText('Carpool?');
    await expect(card.locator('.rc-stack')).toContainText('Kai is in');

    await card.locator('.rc-reply.in').click();
    await expect.poll(() => rpcCalls(page, 'reply_rave_check')).toHaveLength(1);
    expect((await rpcCalls(page, 'reply_rave_check'))[0].args).toEqual({ p_rave_check_id: RC_ID, p_reply: 'in' });
    await expect.poll(() => page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f3'))).toBe(true);
    // The popup re-renders without the card once you're Going.
    await expect(page.locator('#rc-invite')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('receiver: "Maybe" saves as Interested', async ({ page }) => {
    await bootAuthedApp(page, { data: receiverData({ note: null }) });
    await page.evaluate(() => openRaveFocus('f3'));
    await expect(page.locator('#rc-invite .rc-quote')).toHaveCount(0);
    await page.locator('#rc-invite .rc-reply.maybe').click();
    await expect.poll(() => page.evaluate(() =>
      (window.__store.raver_festival_interest || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f3'))).toBe(true);
    expect(await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f3'))).toBe(false);
  });

  test('receiver: answer "Can\'t make it" from the bell, with no RSVP saved', async ({ page }) => {
    await bootAuthedApp(page, { data: receiverData() });
    await page.evaluate(() => openNotifDrawer());

    const pinned = page.locator('#notif-list .notif-pinned');
    await expect(page.locator('#notif-list .notif-group-label').first()).toHaveText('Needs you · 1');
    await expect(pinned.locator('.notif-action-btn')).toHaveText(["I'm in", 'Maybe', "Can't make it"]);
    await pinned.locator('.notif-action-btn', { hasText: "Can't make it" }).click();

    await expect.poll(() => rpcCalls(page, 'reply_rave_check')).toHaveLength(1);
    expect((await rpcCalls(page, 'reply_rave_check'))[0].args).toEqual({ p_rave_check_id: RC_ID, p_reply: 'no' });
    await expect(page.locator('#notif-list .notif-pinned')).toHaveCount(0);
    const rsvps = await page.evaluate(() => [
      ...(window.__store.raver_festivals || []), ...(window.__store.raver_festival_interest || []),
    ].filter(r => r.raver_id === 'r-you' && r.festival_id === 'f3').length);
    expect(rsvps).toBe(0);
  });

  test('iOS long-press: an "I\'m in" button on the push saves the answer and opens the rave', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: receiverData() });
    // What the push plugin hands pushNotificationActionPerformed for the RAVE_CHECK category.
    await page.evaluate(id => openFromNativePush({ url: '/app.html?rave=eternal-nye', raveCheckId: id, festivalId: 'f3' }, 'rc_in'), RC_ID);

    expect((await rpcCalls(page, 'reply_rave_check'))[0].args).toEqual({ p_rave_check_id: RC_ID, p_reply: 'in' });
    await expect.poll(() => page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f3'))).toBe(true);
    await expect(page.locator('#rave-focus-overlay')).toHaveClass(/open/);
    await expect(page.locator('#rave-focus-modal .rf-title')).toHaveText('Eternal NYE');
    expect(errors).toEqual([]);
  });

  test('iOS long-press: a plain tap still only opens, without answering', async ({ page }) => {
    await bootAuthedApp(page, { data: receiverData() });
    await page.evaluate(() => { window.__openedUrl = null; window.openNativeAppUrl = u => { window.__openedUrl = u; }; });
    await page.evaluate(id => openFromNativePush({ url: '/app.html?rave=eternal-nye', raveCheckId: id, festivalId: 'f3' }, 'tap'), RC_ID);
    expect(await rpcCalls(page, 'reply_rave_check')).toHaveLength(0);
  });

  test('crew ticket: "Rave check" opens the sheet for that crew only', async ({ page }) => {
    // c1 Bass Syndicate: you + Sam (unclaimed, Going) + Kai (claimed, no RSVP) -> Tomorrowland is a live Rave Plan.
    // c2 Day Ones: you + Lu (claimed, no RSVP). Lu must not show up from c1's ticket.
    const data = seedData();
    data.ravers = data.ravers.concat([{ ...data.ravers.find(r => r.id === 'r-kai'), id: 'r-lu', name: 'Lu V.', handle: 'lu', claimed_by: 'lu-uid', qr_token: 'qr-lu' }]);
    data.crews = data.crews.concat([{ ...data.crews[0], id: 'c2', name: 'Day Ones', invite_token: 'inv-c2' }]);
    data.crew_members = data.crew_members.concat(['r-you', 'r-lu'].map(id => ({ crew_id: 'c2', raver_id: id, added_at: '2024-01-01T00:00:00Z', added_by: TEST_UID, deleted_at: null })));
    data.__rpc = { rave_check_status: [] };
    const errors = await bootAuthedApp(page, { data });
    // The ticket's action row shows on the crew's Plan view (like Briefing / Rave chat).
    await page.evaluate(async () => { await openDetail('c1', { tab: 'gameplan' }); });

    const btn = page.locator('.crew-ticket[data-fest="f1"] .crew-ticket-act', { hasText: 'Rave check' });
    await expect(btn).toHaveCount(1);
    await btn.click();
    const sheet = page.locator('#rave-check-sheet-overlay');
    await expect(sheet).toHaveClass(/open/);
    await expect(sheet.locator('.modal-title')).toHaveText('Rave check Kai');
    await expect(sheet.locator('.text-hint').first()).toContainText('Tomorrowland · Bass Syndicate');
    await expect(sheet.locator('.rc-who')).not.toContainText('Lu');
    // It loaded the cooldown state before opening.
    expect((await rpcCalls(page, 'rave_check_status'))[0].args).toEqual({ p_festival_id: 'f1' });
    expect(errors).toEqual([]);
  });

  test('crew ticket: no Rave check button once everyone in the crew has answered', async ({ page }) => {
    const data = seedData();
    data.raver_festival_interest = data.raver_festival_interest.concat([{ raver_id: 'r-kai', festival_id: 'f1' }]);
    await bootAuthedApp(page, { data });
    await page.evaluate(async () => { await openDetail('c1'); });
    await expect(page.locator('.crew-ticket[data-fest="f1"] .crew-ticket-act', { hasText: 'Rave chat' })).toHaveCount(1);
    await expect(page.locator('.crew-ticket[data-fest="f1"] .crew-ticket-act', { hasText: 'Rave check' })).toHaveCount(0);
  });

  test('settings: the Rave checks push toggle is listed under notifications', async ({ page }) => {
    await bootAuthedApp(page);
    await expect(page.locator('#rave-check-push-settings-toggle')).toHaveCount(1);
    await expect(page.locator('[data-page="notif"] .poll-setting-label', { hasText: 'Rave checks' })).toHaveCount(1);
  });
});
