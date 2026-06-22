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
