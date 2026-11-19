const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Android beta waitlist (ANDROID BETA WAITLIST in app.html): a dismissible card
// on the Crews page for Android web users, a Settings → Android beta row that
// brings it back, and the Founding Tester badge for ravers marked 'tester'.
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

function dataWith(rpc) {
  const data = seedData();
  data.__rpc = { my_android_beta: { joined: false }, get_founding_testers: [], join_android_beta: { ok: true, already: false }, ...rpc };
  return data;
}
const rpcCalls = (page, fn) => page.evaluate(f => (window.__store.__rpcCalls || []).filter(c => c.fn === f), fn);

test.describe('android beta waitlist', () => {
  test.describe('on Android', () => {
    test.use({ userAgent: ANDROID_UA });

    test('card invites, needs the 14-day box, then joins with the Play email', async ({ page }) => {
      const errors = await bootAuthedApp(page, { data: dataWith() });
      const card = page.locator('#abeta-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('coming to Google Play');
      await card.getByRole('button', { name: 'Count me in' }).click();

      await page.locator('#abeta-email').fill('raver.phone@gmail.com');
      await card.getByRole('button', { name: 'Join the beta' }).click();
      expect(await rpcCalls(page, 'join_android_beta')).toHaveLength(0);

      await page.locator('#abeta-agree').check();
      await card.getByRole('button', { name: 'Join the beta' }).click();
      await expect(card).toContainText("You're on the Android beta list");
      await expect(card).toContainText('raver.phone@gmail.com');
      const [call] = await rpcCalls(page, 'join_android_beta');
      expect(call.args).toMatchObject({ p_play_email: 'raver.phone@gmail.com', p_consent: true, p_source: 'app' });
      expect(errors).toEqual([]);
    });

    test('dismissing hides the card; Settings → Android beta brings back the form', async ({ page }) => {
      await bootAuthedApp(page, { data: dataWith() });
      await page.locator('#abeta-card .abeta-close').click();
      await expect(page.locator('#abeta-card')).toBeHidden();

      await page.evaluate(() => openPrivacySettingsModal(squad.find(r => r.isYou).id));
      const row = page.locator('#abeta-settings-row');
      await expect(row).toBeVisible();
      await row.click();
      await expect(page.locator('#abeta-card')).toBeVisible();
      await expect(page.locator('#abeta-email')).toBeVisible();
    });
  });

  test('not shown off Android, and no Settings row', async ({ page }) => {
    await bootAuthedApp(page, { data: dataWith() });
    await expect(page.locator('#abeta-card')).toBeHidden();
    await page.evaluate(() => openPrivacySettingsModal(squad.find(r => r.isYou).id));
    await expect(page.locator('#abeta-settings-row')).toBeHidden();
  });

  test('Founding Testers get a badge on their profile', async ({ page }) => {
    await bootAuthedApp(page, { data: dataWith({ get_founding_testers: [TEST_UID] }) });
    await page.evaluate(() => openProfile(squad.find(r => r.isYou).id));
    await expect(page.locator('#page-profile .founding-badge')).toHaveText(/Founding Tester/);
  });
});
