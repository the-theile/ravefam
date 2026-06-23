const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// When a crew member adds someone to a festival, the added person gets an
// actionable notification and can take their RSVP off in one tap.
test.describe('festival add → notify + opt-out', () => {
  test('adding a CLAIMED member to a festival notifies them with an action payload', async ({ page }) => {
    await bootAuthedApp(page);
    // r-kai is a claimed crew member not yet linked to f2.
    await page.evaluate(() => { openRaveEditor('f2'); reAdd('r-kai'); });
    await page.waitForTimeout(150);

    const notif = await page.evaluate(() =>
      (window.__store.notifications || []).find(n => n.type === 'festival_add' && n.user_id === 'kai-uid'));
    expect(notif).toBeTruthy();
    expect(notif.data.festival_id).toBe('f2');
    expect(notif.data.raver_id).toBe('r-kai');
    expect(notif.message).toContain('Awakenings');
  });

  test('adding an UNCLAIMED placeholder sends no notification (no inbox)', async ({ page }) => {
    await bootAuthedApp(page);
    // r-sam is unclaimed (claimed_by null).
    await page.evaluate(() => { openRaveEditor('f2'); reAdd('r-sam'); });
    await page.waitForTimeout(150);

    const any = await page.evaluate(() =>
      (window.__store.notifications || []).some(n => n.type === 'festival_add' && n.data && n.data.raver_id === 'r-sam'));
    expect(any).toBe(false);
  });

  test('adding yourself sends no self-notification', async ({ page }) => {
    await bootAuthedApp(page);
    // r-you is the acting user; adding self to f2 should not notify TEST_UID.
    await page.evaluate(() => { openRaveEditor('f2'); reAdd('r-you'); });
    await page.waitForTimeout(150);

    const selfNotif = await page.evaluate((uid) =>
      (window.__store.notifications || []).some(n => n.type === 'festival_add' && n.user_id === uid), TEST_UID);
    expect(selfNotif).toBe(false);
  });

  test('recipient can opt out straight from the notification', async ({ page }) => {
    // Seed a festival_add notification addressed to the booted user (r-you), who
    // is the recipient here, plus their existing RSVP on f1.
    const data = seedData();
    data.notifications = [{
      id: 'n-add', user_id: TEST_UID, crew_id: null, read: false,
      created_at: new Date().toISOString(),
      message: "🎪 Kai added you to Tomorrowland! You're on the lineup — pack your kit and charge the glowsticks. Not feeling it? Tap to take your RSVP off.",
      type: 'festival_add',
      data: { festival_id: 'f1', raver_id: 'r-you', festival_name: 'Tomorrowland' },
    }];
    await bootAuthedApp(page, { data });

    await page.evaluate(() => openNotifDrawer());
    const btn = page.locator('.notif-action-btn');
    await expect(btn).toBeVisible();

    // Sanity: the RSVP exists before opting out.
    expect(await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f1'))).toBe(true);

    await btn.click();
    await page.waitForTimeout(150);

    // RSVP row removed, button shows the done state.
    expect(await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f1'))).toBe(false);
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveText('Removed ✓');
  });

  test('plain notifications render without an action button', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { addNotification('Just a plain ping 🔔'); openNotifDrawer(); });
    await expect(page.locator('#notif-list')).toContainText('Just a plain ping 🔔');
    expect(await page.locator('.notif-action-btn').count()).toBe(0);
  });
});
