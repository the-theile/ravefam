const { test, expect } = require('@playwright/test');
const { installSupabaseStub, makeSession, seedData, collectPageErrors } = require('./helpers');

test.describe('auth flows', () => {
  test('logging in with an emailed code transitions from the auth screen to the main app', async ({ page }) => {
    await installSupabaseStub(page, { session: null, loginSession: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    await page.fill('#login-email', 'tester@ravefam.test');
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-code-form')).toBeVisible();
    await expect(page.locator('#auth-code-email')).toHaveText('tester@ravefam.test');

    // Typing the 6th digit auto-submits (same path as iOS one-time-code autofill).
    await page.fill('#auth-code', '123456');

    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#auth-screen')).toBeHidden();
  });

  test('signing up sends a code with name + phone and shows the code screen', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.evaluate(() => {
      window.__otpCalls = [];
      const orig = sb.auth.signInWithOtp.bind(sb.auth);
      sb.auth.signInWithOtp = (args) => { window.__otpCalls.push(args); return orig(args); };
      showAuthTab('signup');
    });
    await page.fill('#signup-name', 'Jamie D.');
    await page.fill('#signup-phone', '+15550000000');
    await page.fill('#signup-email', 'new@ravefam.test');
    await page.evaluate(() => doSignup());
    await expect(page.locator('#auth-code-form')).toBeVisible();
    const calls = await page.evaluate(() => window.__otpCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].email).toBe('new@ravefam.test');
    expect(calls[0].options.shouldCreateUser).toBe(true);
    expect(calls[0].options.data).toEqual({ full_name: 'Jamie D.', phone: '+15550000000' });
  });

  test('login never creates accounts, and an unknown email points to Sign Up', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.evaluate(() => {
      window.__otpCalls = [];
      sb.auth.signInWithOtp = (args) => {
        window.__otpCalls.push(args);
        return Promise.resolve({ data: {}, error: { code: 'otp_disabled', message: 'Signups not allowed for otp' } });
      };
    });
    await page.fill('#login-email', 'nobody@ravefam.test');
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-error')).toHaveClass(/show/);
    await expect(page.locator('#auth-error')).toContainText('Sign Up');
    await expect(page.locator('#auth-code-form')).toBeHidden();
    const calls = await page.evaluate(() => window.__otpCalls);
    expect(calls[0].options.shouldCreateUser).toBe(false);
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

  test('a short code shows a validation error without calling verify', async ({ page }) => {
    await installSupabaseStub(page, { session: null, loginSession: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.fill('#login-email', 'tester@ravefam.test');
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-code-form')).toBeVisible();
    await page.fill('#auth-code', '123');
    await page.evaluate(() => doVerifyCode());
    await expect(page.locator('#auth-error')).toHaveClass(/show/);
    await expect(page.locator('#main-app')).toBeHidden();
  });
});
