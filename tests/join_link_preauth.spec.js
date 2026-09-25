const { test, expect } = require('@playwright/test');
const { installSupabaseStub, seedData } = require('./helpers');

// Opening a ?join= crew link while signed out used to raise the generic
// "You've been invited!" intercept no matter what the token resolved to. For a
// Secret or Locked In crew that meant creating a whole account and only then
// being toasted "isn't currently recruiting" from bootApp().
//
// Unlike a ?claim= token, a crew link's rejection is knowable before signup:
// get_crew_by_invite_token returns not_recruiting with the crew name.

async function openJoinLink(page, token, data) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await installSupabaseStub(page, { session: null, data });
  await page.goto(`/app.html?join=${token}`);
  await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);
  return errors;
}

test.describe('?join= link while signed out', () => {
  test('a Recruiting crew still shows the normal invite intercept', async ({ page }) => {
    const data = seedData(); // c1 is 'recruiting', invite_token 'inv-c1'
    const errors = await openJoinLink(page, 'inv-c1', data);

    await expect(page.locator('#claim-intercept')).toHaveClass(/open/);
    await expect(page.locator('#intercept-title')).toContainText('Bass Syndicate');
    // The pending token survives for bootApp() to act on after auth.
    expect(await page.evaluate(() => sessionStorage.getItem('pendingCrewJoin'))).toBe('inv-c1');
    expect(errors).toEqual([]);
  });

  test('a Secret crew says so up front instead of after signup', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'secret';
    const errors = await openJoinLink(page, 'inv-c1', data);

    await expect(page.locator('#claim-intercept')).toHaveClass(/open/);
    await expect(page.locator('#intercept-title')).toContainText("isn't recruiting right now");
    await expect(page.locator('#intercept-title')).toContainText('Bass Syndicate');
    await expect(page.locator('#intercept-sub')).toContainText('roster is closed for now');
    // Nothing left pending — there is no join to complete after signup.
    expect(await page.evaluate(() => sessionStorage.getItem('pendingCrewJoin'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('a Locked In crew is treated the same way', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'locked-in';
    const errors = await openJoinLink(page, 'inv-c1', data);

    await expect(page.locator('#intercept-title')).toContainText("isn't recruiting right now");
    expect(await page.evaluate(() => sessionStorage.getItem('pendingCrewJoin'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('an unknown token reads as expired, not as a crew invite', async ({ page }) => {
    const errors = await openJoinLink(page, 'nope-not-a-token', seedData());

    await expect(page.locator('#intercept-title')).toContainText('expired');
    expect(await page.evaluate(() => sessionStorage.getItem('pendingCrewJoin'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('signup stays reachable even when the link is closed', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'secret';
    await openJoinLink(page, 'inv-c1', data);

    // A dead link is no reason to bar the door.
    await page.evaluate(() => dismissIntercept('signup'));
    await expect(page.locator('#claim-intercept')).not.toHaveClass(/open/);
    // One flow: signing up is the same email/phone form as logging in.
    await expect(page.locator('#auth-login-form')).toBeVisible();
    await expect(page.locator('#auth-tabs')).toBeVisible();
  });
});
