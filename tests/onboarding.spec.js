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
});
