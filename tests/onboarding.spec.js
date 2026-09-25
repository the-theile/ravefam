const { test, expect } = require('@playwright/test');
const { installSupabaseStub, makeSession, seedData } = require('./helpers');

const EMPTY = { festivals: [], ravers: [], crews: [], crew_members: [], raver_festivals: [], raver_festival_interest: [] };

test.describe('onboarding', () => {
  test('a brand-new user (not onboarded, no profile) sees the onboarding wizard', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession({ user_metadata: { onboarded: false } }),
      data: EMPTY,
    });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#onboarding-screen')).toHaveClass(/show/, { timeout: 4000 });
    await expect(page.locator('#ob-step1')).toBeVisible();
  });

  test('an onboarded user with a profile does NOT see the wizard', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    await expect(page.locator('#onboarding-screen')).not.toHaveClass(/show/);
  });

  test('step 1 shows a low-pressure skip link and reassurance copy', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession({ user_metadata: { onboarded: false } }),
      data: EMPTY,
    });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#ob-step1')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.ob-genre-reassurance')).toContainText('nothing here is permanent');
    await expect(page.locator('.ob-skip-link')).toBeVisible();
  });

  test('skipping step 1 advances to the identity step without a genre picked', async ({ page }) => {
    await installSupabaseStub(page, {
      session: makeSession({ user_metadata: { onboarded: false } }),
      data: EMPTY,
    });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#ob-step1')).toBeVisible({ timeout: 4000 });
    await page.click('.ob-skip-link');
    await expect(page.locator('#ob-step2')).toBeVisible();
    await expect(page.locator('#ob-step1')).toBeHidden();
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
    await expect(page.locator('#ob-step1')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#ob-existing-match')).toBeVisible();
    await expect(page.locator('#ob-have-account')).toBeHidden();

    await page.click('#ob-existing-match >> text=I\'m new here');
    await expect(page.locator('#ob-existing-match')).toBeHidden();
  });

  test('no banner when the number is not on any other profile', async ({ page }) => {
    await installSupabaseStub(page, { session: newPhoneUser(), data: EMPTY });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await expect(page.locator('#ob-step1')).toBeVisible({ timeout: 4000 });
    await page.waitForTimeout(300);
    await expect(page.locator('#ob-existing-match')).toBeHidden();
    // The quieter "Already on RaveFAM with your email?" link is still there.
    await expect(page.locator('#ob-have-account')).toBeVisible();
  });
});
