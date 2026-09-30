const { test, expect } = require('@playwright/test');
const { installSupabaseStub, makeSession, seedData } = require('./helpers');

const EMPTY = { festivals: [], ravers: [], crews: [], crew_members: [], raver_festivals: [], raver_festival_interest: [] };

// 2.0 signup is name + handle, then the help choice. Genres moved out to the
// Raves tab's "Find your sound" sheet and the crew step to the Crews empty
// state, so there is no step 1 any more.
test.describe('onboarding', () => {
  test('a brand-new user (not onboarded, no profile) sees the onboarding wizard', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession({ user_metadata: { onboarded: false } }),
      data: EMPTY,
    });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#onboarding-screen')).toHaveClass(/show/, { timeout: 4000 });
    await expect(page.locator('#ob-step2')).toBeVisible();
  });

  test('an onboarded user with a profile does NOT see the wizard', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    await expect(page.locator('#onboarding-screen')).not.toHaveClass(/show/);
  });

  test('signup starts on name + handle, with no genre step', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession({ user_metadata: { onboarded: false } }),
      data: EMPTY,
    });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#ob-step2')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#ob-name-input')).toBeVisible();
    await expect(page.locator('#ob-step1')).toHaveCount(0);
    await expect(page.locator('#onboarding-screen .ob-genre-chip')).toHaveCount(0);
  });

  test('the last step is the help choice, and choosing closes the wizard and sets the help level', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession({ user_metadata: { onboarded: false } }),
      data: EMPTY,
    });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#ob-step2')).toBeVisible({ timeout: 4000 });
    await page.evaluate(() => obGoToStep(3));
    await expect(page.locator('#ob-step3-title')).toHaveText('How much help do you want?');
    await page.click('#ob-step3 >> text=I’ll figure it out');
    await expect(page.locator('#onboarding-screen')).not.toHaveClass(/show/);
    expect(await page.evaluate(() => _guidance.help_level)).toBe('hints');
    // Signup's own help choice means the 2.0 "what's new" welcome is never shown.
    expect(await page.evaluate(() => !!_guidance.quests.welcome_2_0)).toBe(true);
  });

  // New phone-only account (no email, just created, no profile) whose verified
  // number the server says is on someone else's profile.
  const newPhoneUser = () => makeSession({
    user: { email: '', phone: '14155550134', created_at: new Date().toISOString() },
    user_metadata: { onboarded: false },
  });

  test('a new phone login whose number is on an existing profile gets the "already on RaveFAM" banner', async ({ page }) => {
    await installSupabaseStub(page, { session: newPhoneUser(), data: { ...EMPTY, phone_profile_match: true } });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#ob-step2')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#ob-existing-match')).toBeVisible();
    await expect(page.locator('#ob-have-account')).toBeHidden();

    await page.click('#ob-existing-match >> text=I\'m new here');
    await expect(page.locator('#ob-existing-match')).toBeHidden();
  });

  test('no banner when the number is not on any other profile', async ({ page }) => {
    await installSupabaseStub(page, { session: newPhoneUser(), data: EMPTY });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#ob-step2')).toBeVisible({ timeout: 4000 });
    await page.waitForTimeout(300);
    await expect(page.locator('#ob-existing-match')).toBeHidden();
    // The quieter "Already on RaveFAM with your email?" link is still there.
    await expect(page.locator('#ob-have-account')).toBeVisible();
  });
});
