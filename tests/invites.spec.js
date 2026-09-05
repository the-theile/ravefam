const { test, expect } = require('@playwright/test');
const { bootAuthedApp, installSupabaseStub, seedData } = require('./helpers');

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

  test('Skip-for-now keeps page-members active with the new raver visible', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => switchTab('members'));
    await page.evaluate(() => openProfileEditor());
    await page.locator('#pf-name').fill('Connor Lanser');
    await page.evaluate(() => saveProfile());

    await expect(page.locator('#crew-pick-overlay')).toHaveClass(/open/);
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(page.locator('#page-members')).toHaveClass(/active/);
    await expect(page.locator('#page-profile')).not.toHaveClass(/active/);
    await expect(page.locator('#members-grid')).toContainText('Connor Lanser');
    await expect(page.locator('#invite-prompt-overlay')).toHaveClass(/open/);
    expect(errors).toEqual([]);
  });

  test('invite prompt uses the real raver id after DB save resolves before skip', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => openProfileEditor());
    await page.locator('#pf-name').fill('QR Test Raver');
    await page.evaluate(() => saveProfile());

    await page.waitForTimeout(100);

    await page.evaluate(() => closeCrewPickAndProfile());
    await expect(page.locator('#invite-prompt-overlay')).toHaveClass(/open/);

    const found = await page.evaluate(() => !!getRaver(_invitePromptRaverId));
    expect(found).toBe(true);

    await page.evaluate(() => showInviteQR());
    await expect(page.locator('#qr-overlay')).toHaveClass(/open/);
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

test.describe('pre-auth invite intercept', () => {
  // Regression test for a bug where #claim-intercept opened correctly (the
  // .open class was applied and its content was populated) but was rendered
  // completely hidden behind #auth-screen (z-index 1000 vs the intercept's
  // old z-index 65), so a scanning friend landed on a bare signup form with
  // no explanation of what they'd been invited to.
  test('shows the crew-personalized banner above the auth form for a ?claim= link', async ({ page }) => {
    const errors = require('./helpers').collectPageErrors(page);
    await installSupabaseStub(page, { session: null, data: seedData() });
    await page.goto('/app.html?claim=qr-sam'); // r-sam is in crew c1 "Bass Syndicate"

    const intercept = page.locator('#claim-intercept');
    await expect(intercept).toHaveClass(/open/);
    await expect(page.locator('#intercept-title')).toContainText('Bass Syndicate');
    await expect(page.locator('#intercept-crew-name')).toContainText('Bass Syndicate');

    // The banner must actually be the topmost element, not just logically "open".
    const topId = await page.evaluate(() => document.elementFromPoint(
      window.innerWidth / 2, window.innerHeight / 2
    )?.closest('#claim-intercept')?.id);
    expect(topId).toBe('claim-intercept');
    expect(errors).toEqual([]);
  });

  test('shows the crew-personalized banner above the auth form for a ?join= link', async ({ page }) => {
    await installSupabaseStub(page, { session: null, data: seedData() });
    await page.goto('/app.html?join=inv-c1'); // c1 "Bass Syndicate" invite token

    const intercept = page.locator('#claim-intercept');
    await expect(intercept).toHaveClass(/open/);
    await expect(page.locator('#intercept-title')).toContainText('Bass Syndicate');

    const topId = await page.evaluate(() => document.elementFromPoint(
      window.innerWidth / 2, window.innerHeight / 2
    )?.closest('#claim-intercept')?.id);
    expect(topId).toBe('claim-intercept');
  });
});
