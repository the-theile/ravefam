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

// Adding a raver and the per-raver invite now live in the Add ravers sheet:
// see add_ravers_sheet.spec.js.

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

  test('opens the crew invite sheet with the join URL, and Copy puts it on the clipboard', async ({ page }) => {
    await bootAuthedApp(page); // c1 already has token 'inv-c1'
    await page.evaluate(async () => { await generateAndShareCrewInvite('c1'); });
    await expect(page.locator('#qr-overlay')).toHaveClass(/open/);
    await expect(page.locator('#qr-modal .modal-title')).toContainText('Bass Syndicate');
    await expect(page.locator('#crew-invite-url')).toHaveValue(/\?join=inv-c1$/);
    await expect(page.locator('#qr-canvas-wrap canvas')).toHaveCount(1);
    await page.locator('#qr-modal button', { hasText: 'Copy link' }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('?join=inv-c1');
  });

  test('Share link uses the native share sheet when there is one', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(async () => {
      window.__shared = null;
      navigator.share = (d) => { window.__shared = d; return Promise.resolve(); };
      await generateAndShareCrewInvite('c1');
    });
    await page.locator('#qr-modal button', { hasText: 'Share link' }).click();
    await expect.poll(() => page.evaluate(() => window.__shared && window.__shared.url)).toContain('?join=inv-c1');
    expect(await page.evaluate(() => window.__shared.title)).toContain('Bass Syndicate');
  });
});
