const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

test.describe('QR invite modal', () => {
  test('shows the invite code derived from the raver qr_token', async ({ page }) => {
    await bootAuthedApp(page);
    // r-sam has qr_token 'qr-sam' → code = QRSAM
    await page.evaluate(() => showQRModal('r-sam'));
    await expect(page.locator('#qr-overlay')).toHaveClass(/open/);
    await expect(page.locator('#qr-modal')).toContainText('QRSAM');
    await expect(page.locator('#qr-modal')).toContainText('Sam');
  });
});

test.describe('invite prompt after adding a raver', () => {
  async function addRaver(page, name) {
    await page.evaluate(() => openProfileEditor());
    await page.locator('#pf-name').fill(name);
    await page.evaluate(() => saveProfile());
  }

  test('Skip-for-now path offers the invite, then opens the QR modal', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await addRaver(page, 'Newbie One');

    await expect(page.locator('#crew-pick-overlay')).toHaveClass(/open/);
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(page.locator('#invite-prompt-overlay')).toHaveClass(/open/);
    await expect(page.locator('#invite-prompt-modal')).toContainText('Invite Newbie now?');

    await page.getByRole('button', { name: /Show QR/ }).click();
    await expect(page.locator('#qr-overlay')).toHaveClass(/open/);
    await expect(page.locator('#invite-prompt-overlay')).not.toHaveClass(/open/);
    expect(errors).toEqual([]);
  });

  test('Send a link uses the native share sheet with the claim URL', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => {
      window.__shared = [];
      navigator.share = (payload) => { window.__shared.push(payload); return Promise.resolve(); };
    });
    await addRaver(page, 'Newbie Three');

    await expect(page.locator('#crew-pick-overlay')).toHaveClass(/open/);
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(page.locator('#invite-prompt-overlay')).toHaveClass(/open/);
    await page.getByRole('button', { name: /Send a link/ }).click();
    await expect(page.locator('#invite-prompt-overlay')).not.toHaveClass(/open/);

    const shared = await page.evaluate(() => window.__shared);
    expect(shared.length).toBe(1);
    expect(shared[0].url).toContain('?claim=');
    expect(errors).toEqual([]);
  });

  test("picking a crew (Let's go) also offers the invite, skip lands on profile", async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await addRaver(page, 'Newbie Two');

    await expect(page.locator('#crew-pick-overlay')).toHaveClass(/open/);
    await page.locator('.crew-pick-item').first().click();
    await page.locator('#crew-pick-modal').getByRole('button', { name: /Let's go/ }).click();

    await expect(page.locator('#invite-prompt-overlay')).toHaveClass(/open/);
    await page.getByRole('button', { name: 'Skip, invite later' }).click();
    await expect(page.locator('#invite-prompt-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#page-profile')).toHaveClass(/active/);
    expect(errors).toEqual([]);
  });
});

test.describe('crew invite link', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('generates and persists an invite token for a crew without one', async ({ page }) => {
    const data = seedData();
    data.crews[0].invite_token = null; // force generation
    await bootAuthedApp(page, { data });

    await page.evaluate(async () => { await generateAndShareCrewInvite('c1'); });

    const token = await page.evaluate(() => window.__store.crews.find(c => c.id === 'c1').invite_token);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('copies a join URL containing the crew token to the clipboard', async ({ page }) => {
    await bootAuthedApp(page); // c1 already has token 'inv-c1'
    await page.evaluate(async () => { await generateAndShareCrewInvite('c1'); });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('?join=inv-c1');
  });
});
