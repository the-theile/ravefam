const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// When a crew member adds someone to a festival, the added person gets an
// actionable notification and can take their RSVP off in one tap. The
// "you were added"/"you were removed" notifications themselves are fired by
// a Postgres trigger on raver_festivals (notify_raver_festival_change), not
// from reAdd directly — same reasoning and same untestable-against-the-
// offline-stub limitation as notify_saved_vendor_spotted in
// vendor_village.spec.js. These tests cover the write reAdd is responsible
// for; the notification rendering itself is covered by the seeded-data
// tests below.
test.describe('festival add → notify + opt-out', () => {
  test('adding a CLAIMED member to a festival links their RSVP', async ({ page }) => {
    await bootAuthedApp(page);
    // r-kai is a claimed crew member not yet linked to f2.
    await page.evaluate(() => { openRaveEditor('f2'); reAdd('r-kai'); });
    await page.waitForTimeout(150);

    const linked = await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-kai' && r.festival_id === 'f2'));
    expect(linked).toBe(true);
  });

  test('adding an UNCLAIMED placeholder still links their RSVP (no inbox to notify)', async ({ page }) => {
    await bootAuthedApp(page);
    // r-sam is unclaimed (claimed_by null).
    await page.evaluate(() => { openRaveEditor('f2'); reAdd('r-sam'); });
    await page.waitForTimeout(150);

    const linked = await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-sam' && r.festival_id === 'f2'));
    expect(linked).toBe(true);
  });

  test('adding yourself links your own RSVP', async ({ page }) => {
    await bootAuthedApp(page);
    // r-you is the acting user, adding self to f2.
    await page.evaluate(() => { openRaveEditor('f2'); reAdd('r-you'); });
    await page.waitForTimeout(150);

    const linked = await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f2'));
    expect(linked).toBe(true);
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
    // A festival_add notification now renders two actions (opt out + block
    // future re-adds) — target the opt-out button by class, not accessible
    // name, since the click handler rewrites the button's text afterward.
    const btn = page.locator('.notif-action-btn:not(.notif-ghost-btn)');
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
