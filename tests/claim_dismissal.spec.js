const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

// A ?claim= token is mirrored into localStorage so it survives the email
// confirmation round trip. Nothing cleared it when the user simply closed the
// preview, so processPendingClaim() re-opened the claim overlay on every app
// launch, forever — no way to decline short of logging out.
//
// Closing from the PREVIEW view means "I've seen whose spot this is and I don't
// want it" and clears the token. Closing from the SCAN view is just backing out
// of the scanner and must keep it.

async function seedPendingClaim(page) {
  await page.evaluate(() => {
    sessionStorage.setItem('pendingClaim', 'tok-abc');
    localStorage.setItem('pendingClaimToken', 'tok-abc');
  });
}

async function storedToken(page) {
  return page.evaluate(() => ({
    session: sessionStorage.getItem('pendingClaim'),
    local: localStorage.getItem('pendingClaimToken'),
  }));
}

test.describe('declining a claim', () => {
  test('closing the preview clears the pending token so it stops re-prompting', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await seedPendingClaim(page);

    await page.evaluate(() => {
      document.getElementById('scanner-overlay').classList.add('open');
      showClaimPreview({
        raver: { id: 'stub-1', name: 'Sam Rivera' },
        crew:  { id: 'c1', name: 'Bass Syndicate', color: '#FF2D78', status: 'recruiting', member_count: 3 },
      }, 'tok-abc');
    });
    await expect(page.locator('#sv-preview')).toHaveClass(/active/);

    await page.evaluate(() => closeScanner());

    expect(await storedToken(page)).toEqual({ session: null, local: null });
    await expect(page.locator('#scanner-overlay')).not.toHaveClass(/open/);
    expect(errors).toEqual([]);
  });

  test('declining is acknowledged rather than silent', async ({ page }) => {
    await bootAuthedApp(page);
    await seedPendingClaim(page);
    await page.evaluate(() => {
      document.getElementById('scanner-overlay').classList.add('open');
      showClaimPreview({ raver: { id: 's', name: 'Sam' }, crew: { id: 'c1', name: 'Bass Syndicate', status: 'recruiting' } }, 'tok-abc');
      closeScanner();
    });
    await expect(page.locator('#toast')).toContainText('fresh invite');
  });

  test('closing from the scan view keeps the token (just backing out)', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await seedPendingClaim(page);

    await page.evaluate(() => {
      document.getElementById('scanner-overlay').classList.add('open');
      showScannerView('scan');
      closeScanner();
    });

    expect(await storedToken(page)).toEqual({ session: 'tok-abc', local: 'tok-abc' });
    expect(errors).toEqual([]);
  });

  test('an error view close also keeps the token (not a decision about the spot)', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await seedPendingClaim(page);

    await page.evaluate(() => {
      document.getElementById('scanner-overlay').classList.add('open');
      showScannerError('network', null);
      closeScanner();
    });

    // A network blip is not the user declining — don't burn their invite.
    expect(await storedToken(page)).toEqual({ session: 'tok-abc', local: 'tok-abc' });
    expect(errors).toEqual([]);
  });
});
