const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

// The claim preview is what an invited raver sees before they commit. It has to
// tell the truth about the crew they're about to join: the old status mapping
// collapsed every non-'locked-in' status into "Recruiting", so a Secret crew's
// claim link advertised itself as Recruiting. A locked-in crew, meanwhile,
// still offered a "Claim My Spot" button that the roster is closed to.

/** Open the scanner overlay and render a claim preview for a crew in `status`. */
async function previewForCrewStatus(page, status) {
  await page.evaluate((crewStatus) => {
    document.getElementById('scanner-overlay').classList.add('open');
    showClaimPreview({
      raver: { id: 'stub-1', name: 'Sam Rivera', handle: 'samr', genres: ['Techno'] },
      crew:  { id: 'c1', name: 'Bass Syndicate', color: '#FF2D78', status: crewStatus, member_count: 3 },
    }, 'tok-123');
  }, status);
  return page.locator('#preview-body');
}

test.describe('claim preview · crew status', () => {
  test('a Secret crew is labelled Secret, not Recruiting', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    const body = await previewForCrewStatus(page, 'secret');

    await expect(body.locator('.claim-crew-badge')).toHaveText('🔴 Secret');
    await expect(body.locator('.claim-crew-badge')).not.toContainText('Recruiting');
    expect(errors).toEqual([]);
  });

  test('a Recruiting crew is labelled Recruiting and offers the claim button', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    const body = await previewForCrewStatus(page, 'recruiting');

    await expect(body.locator('.claim-crew-badge')).toHaveText('🟢 Recruiting');
    await expect(page.locator('#confirm-claim-btn')).toBeVisible();
    await expect(page.locator('#confirm-claim-btn')).toContainText('Bass Syndicate');
    expect(errors).toEqual([]);
  });

  test('a Locked In crew is labelled Locked In and cannot be claimed', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    const body = await previewForCrewStatus(page, 'locked-in');

    await expect(body.locator('.claim-crew-badge')).toHaveText('🔒 Locked In');
    // No button to press — the roster is closed, so don't offer an action that
    // the server would reject anyway.
    await expect(page.locator('#confirm-claim-btn')).toHaveCount(0);
    await expect(body).toContainText("roster's closed");
    await expect(body).toContainText('reopen recruiting');
    // "Not you?" stays — scanning a different code is still a way out.
    await expect(body.locator('.claim-back-link')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an unknown/missing crew status still renders without crashing', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => {
      document.getElementById('scanner-overlay').classList.add('open');
      showClaimPreview({ raver: { id: 'stub-2', name: 'No Crew' }, crew: null }, 'tok-456');
    });

    await expect(page.locator('#preview-body .claim-crew-badge')).toHaveText('🌐 Recruiting');
    await expect(page.locator('#confirm-claim-btn')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
