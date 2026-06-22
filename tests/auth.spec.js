const { test, expect } = require('@playwright/test');
const { installSupabaseStub, makeSession, seedData, collectPageErrors } = require('./helpers');

test.describe('auth flows', () => {
  test('logging in transitions from the auth screen to the main app', async ({ page }) => {
    await installSupabaseStub(page, { session: null, loginSession: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    await page.fill('#login-email', 'tester@ravefam.test');
    await page.fill('#login-password', 'hunter2hunter');
    await page.evaluate(() => doLogin());

    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#auth-screen')).toBeHidden();
  });

  test('logging out returns to the auth screen', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    await page.evaluate(() => doLogout());
    await expect(page.locator('#auth-screen')).toBeVisible();
  });

  test('switching auth tabs toggles login / signup forms', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    await page.evaluate(() => showAuthTab('signup'));
    await expect(page.locator('#auth-signup-form')).toBeVisible();
    await expect(page.locator('#auth-login-form')).toBeHidden();

    await page.evaluate(() => showAuthTab('login'));
    await expect(page.locator('#auth-login-form')).toBeVisible();
    await expect(page.locator('#auth-signup-form')).toBeHidden();
  });

  test('empty login shows a validation error', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-error')).toHaveClass(/show/);
  });

  test('forgot-password sends a reset email with a success message', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.fill('#login-email', 'tester@ravefam.test');
    await page.evaluate(() => doForgotPassword());
    await expect(page.locator('#auth-success')).toHaveClass(/show/);
  });
});
