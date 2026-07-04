const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Profile Privacy & Permissions: owner-controlled toggles that gate festival
// adds and vibe-tag suggestions from crewmates, and hide base/RSVP display
// from other viewers when turned off.
test.describe('privacy & permissions', () => {
  test('festival add is blocked with a friendly message when the owner opts out', async ({ page }) => {
    const data = seedData();
    const kai = data.ravers.find(r => r.id === 'r-kai');
    kai.allow_festival_adds = false;
    await bootAuthedApp(page, { data });

    await page.evaluate(() => { openRaveEditor('f2'); reAdd('r-kai'); });
    await page.waitForTimeout(150);

    // No RSVP row written for kai on f2.
    const linked = await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-kai' && r.festival_id === 'f2'));
    expect(linked).toBe(false);

    // Friendly info modal shown instead of silent failure.
    await expect(page.locator('#confirm-overlay')).toHaveClass(/open/);
    await expect(page.locator('#confirm-title')).toHaveText('🔒 Not right now');
    await expect(page.locator('#confirm-body')).toContainText('Kai has chosen not to be added to festivals by others');
    // Single-button info modal: Cancel is hidden, only the OK button shows.
    await expect(page.locator('#confirm-cancel-btn')).toBeHidden();
  });

  test('festival add still works for an unclaimed placeholder and for self-add', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { openRaveEditor('f2'); reAdd('r-sam'); reAdd('r-you'); });
    await page.waitForTimeout(150);

    const samLinked = await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-sam' && r.festival_id === 'f2'));
    const youLinked = await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f2'));
    expect(samLinked).toBe(true);
    expect(youLinked).toBe(true);
    await expect(page.locator('#confirm-overlay')).not.toHaveClass(/open/);
  });

  test('vibe tag suggestion is blocked with a friendly message when the owner opts out', async ({ page }) => {
    const data = seedData();
    const kai = data.ravers.find(r => r.id === 'r-kai');
    kai.allow_vibe_tags = false;
    await bootAuthedApp(page, { data });

    await page.evaluate(() => openSuggestVibeSheet('r-kai'));
    await page.waitForTimeout(100);

    await expect(page.locator('#suggest-vibe-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#confirm-overlay')).toHaveClass(/open/);
    await expect(page.locator('#confirm-title')).toHaveText('🔒 Vibe tags off');
    await expect(page.locator('#confirm-body')).toContainText('Kai has turned off community vibe tags');
  });

  test('a crewmate can suggest a vibe tag on a claimed profile that allows it', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-kai'));
    await page.locator('button:has-text("Suggest a vibe tag")').click();
    await expect(page.locator('#suggest-vibe-overlay')).toHaveClass(/open/);

    await page.evaluate(() => submitSuggestedVibeTag('vt-mainstage'));
    await page.waitForTimeout(150);

    const kaiRow = await page.evaluate(() => (window.__store.ravers || []).find(r => r.id === 'r-kai'));
    expect(kaiRow.vibe_tags).toContain('vt-mainstage');
  });

  test('base location and RSVPs are hidden from other viewers when the owner opts out', async ({ page }) => {
    const data = seedData();
    const kai = data.ravers.find(r => r.id === 'r-kai');
    kai.privacy_base_visible = false;
    kai.privacy_show_rsvps = false;
    data.raver_festivals.push({ raver_id: 'r-kai', festival_id: 'f1' });
    await bootAuthedApp(page, { data });

    await page.evaluate(() => openProfile('r-kai'));
    const profileText = await page.locator('#page-profile').innerText();
    expect(profileText).toContain('Location private');
    expect(profileText).not.toContain('Based in Lisbon');
    expect(profileText).toContain('keeps their RSVPs private');
    expect(profileText).not.toContain('Tomorrowland');
  });

  test('privacy settings modal toggles persist for your own profile', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    await expect(page.locator('#privacy-settings-overlay')).toHaveClass(/open/);

    const toggle = page.locator('.poll-anon-toggle[data-key="allowFestivalAdds"]');
    const hasOnClass = () => toggle.evaluate(el => el.classList.contains('on'));
    expect(await hasOnClass()).toBe(true); // community-friendly default
    await toggle.click();
    await page.waitForTimeout(150);

    expect(await hasOnClass()).toBe(false);
    const youRow = await page.evaluate(() => (window.__store.ravers || []).find(r => r.id === 'r-you'));
    expect(youRow.allow_festival_adds).toBe(false);
  });

  test('the privacy modal cannot be opened for someone else\'s profile', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openPrivacySettingsModal('r-kai'));
    await expect(page.locator('#privacy-settings-overlay')).not.toHaveClass(/open/);
  });

  test('entry points open the privacy modal: notification drawer and own profile view', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openNotifDrawer());
    await page.locator('.notif-footer-btn.privacy-btn').click();
    await expect(page.locator('#privacy-settings-overlay')).toHaveClass(/open/);
    await page.evaluate(() => closePrivacySettingsModal());

    await page.evaluate(() => openProfile('r-you'));
    await page.locator('.profile-actions button[title="Privacy & Permissions"]').click();
    await expect(page.locator('#privacy-settings-overlay')).toHaveClass(/open/);
  });
});
