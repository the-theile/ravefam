const { test, expect } = require('@playwright/test');
const { installSupabaseStub, makeSession, seedData, collectPageErrors } = require('./helpers');

test.describe('auth flows', () => {
  test('logging in with an emailed code transitions from the auth screen to the main app', async ({ page }) => {
    await installSupabaseStub(page, { session: null, loginSession: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();

    await page.fill('#login-id', 'tester@ravefam.test');
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-code-form')).toBeVisible();
    await expect(page.locator('#auth-code-email')).toHaveText('tester@ravefam.test');

    // Typing the 6th digit auto-submits (same path as iOS one-time-code autofill).
    await page.fill('#auth-code', '123456');

    await expect(page.locator('#main-app')).toBeVisible();
    await expect(page.locator('#auth-screen')).toBeHidden();
  });

  test('one flow: an email send can create the account and carries a captcha token', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.evaluate(() => {
      window.__otpCalls = [];
      const orig = sb.auth.signInWithOtp.bind(sb.auth);
      sb.auth.signInWithOtp = (args) => { window.__otpCalls.push(args); return orig(args); };
    });
    await page.fill('#login-id', 'new@ravefam.test');
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-code-form')).toBeVisible();
    const calls = await page.evaluate(() => window.__otpCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].email).toBe('new@ravefam.test');
    expect(calls[0].options.shouldCreateUser).toBe(true);
    expect(calls[0].options.captchaToken).toBe('test-captcha-token');
    // Name is collected by onboarding now, not sent as signup metadata.
    expect(calls[0].options.data).toBeUndefined();
  });

  test('signups paused in Supabase shows a friendly error and stays on the form', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.evaluate(() => {
      sb.auth.signInWithOtp = () =>
        Promise.resolve({ data: {}, error: { code: 'otp_disabled', message: 'Signups not allowed for otp' } });
    });
    await page.fill('#login-id', 'nobody@ravefam.test');
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-error')).toHaveClass(/show/);
    await expect(page.locator('#auth-error')).toContainText('paused');
    await expect(page.locator('#auth-code-form')).toBeHidden();
  });

  test('logging in with a texted code transitions to the main app', async ({ page }) => {
    await installSupabaseStub(page, { session: null, loginSession: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.evaluate(() => {
      window.__authCalls = [];
      const send = sb.auth.signInWithOtp.bind(sb.auth);
      const verify = sb.auth.verifyOtp.bind(sb.auth);
      sb.auth.signInWithOtp = (args) => { window.__authCalls.push(['send', args]); return send(args); };
      sb.auth.verifyOtp = (args) => { window.__authCalls.push(['verify', args]); return verify(args); };
    });
    await page.fill('#login-id', '(415) 555-0134');
    await expect(page.locator('#login-id-hint')).toContainText("We'll text +1 (415) 555-0134");
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-sms-code-form')).toBeVisible();
    await expect(page.locator('#auth-sms-phone')).toHaveText('+1 (415) 555-0134');

    // Typing the 6th digit auto-submits (same path as one-time-code autofill).
    await page.fill('#sms-code', '123456');
    await expect(page.locator('#main-app')).toBeVisible();

    const calls = await page.evaluate(() => window.__authCalls);
    expect(calls[0][0]).toBe('send');
    expect(calls[0][1].phone).toBe('+14155550134');
    expect(calls[0][1].options).toMatchObject({ shouldCreateUser: true, channel: 'sms', captchaToken: 'test-captcha-token' });
    expect(calls[1]).toEqual(['verify', { phone: '+14155550134', token: '123456', type: 'sms' }]);
  });

  test('an invalid phone number is rejected inline without sending', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.evaluate(() => {
      window.__otpCalls = [];
      sb.auth.signInWithOtp = (args) => { window.__otpCalls.push(args); return Promise.resolve({ data: {}, error: null }); };
    });
    await page.fill('#login-id', '555-12');
    await page.evaluate(() => doLogin());
    await expect(page.locator('#login-id-error')).toHaveClass(/show/);
    await expect(page.locator('#login-id-error')).toContainText('phone number');
    await expect(page.locator('#auth-sms-code-form')).toBeHidden();
    expect(await page.evaluate(() => window.__otpCalls)).toHaveLength(0);
  });

  test('logging out returns to the auth screen', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    await page.evaluate(() => doLogout());
    await expect(page.locator('#auth-screen')).toBeVisible();
  });

  test('one field auto-detects email vs phone, and legacy tab names still land on it', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    const hint = page.locator('#login-id-hint');

    await page.fill('#login-id', 'raver@ravefam.test');
    await expect(hint).toContainText('email you');
    await page.fill('#login-id', '+44 7700 900123');
    await expect(hint).toContainText('text +447700900123');
    await page.fill('#login-id', '407-79');
    await expect(hint).toContainText('country code');

    // ?tab=signup / ?tab=login links, the claim intercept and QR arrivals
    // still pass the old names — all land on the same field.
    for (const legacy of ['signup', 'login', 'phone', 'email']) {
      await page.evaluate((t) => { showCodeScreen('x@y.z'); showAuthTab(t); }, legacy);
      await expect(page.locator('#auth-login-form')).toBeVisible();
      await expect(page.locator('#auth-code-form')).toBeHidden();
    }
  });

  test('empty login shows a validation error', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.evaluate(() => doLogin());
    await expect(page.locator('#login-id-error')).toHaveClass(/show/);
  });

  test('a short code shows a validation error without calling verify', async ({ page }) => {
    await installSupabaseStub(page, { session: null, loginSession: makeSession(), data: seedData() });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).toBeVisible();
    await page.fill('#login-id', 'tester@ravefam.test');
    await page.evaluate(() => doLogin());
    await expect(page.locator('#auth-code-form')).toBeVisible();
    await page.fill('#auth-code', '123');
    await page.evaluate(() => doVerifyCode());
    await expect(page.locator('#auth-error')).toHaveClass(/show/);
    await expect(page.locator('#main-app')).toBeHidden();
  });
});
