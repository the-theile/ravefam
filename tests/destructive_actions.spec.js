const { test, expect } = require('@playwright/test');
const { bootAuthedApp, TEST_UID } = require('./helpers');

// Destructive-action UX: a mandatory reason on festival delete, and Archive as
// the guided alternative when someone else has RSVPed. See showDeleteRaveConfirm,
// deleteRave, archiveFestival, festivalPerms.
test.describe('festival delete UX', () => {
  test('delete requires a reason before the confirm button enables', async ({ page }) => {
    await bootAuthedApp(page);
    // f2 has no linked goers in the default seed — make TEST_UID its creator
    // so festivalPerms().canEdit is true and the no-goers delete modal shows.
    await page.evaluate(async (uid) => {
      window.__store.festivals.find(f => f.id === 'f2').created_by = uid;
      await loadAllData();
    }, TEST_UID);

    await page.evaluate(() => { openRaveEditor('f2'); showDeleteRaveConfirm(); });
    const confirmBtn = page.locator('#fest-delete-confirm-btn');
    await expect(confirmBtn).toBeDisabled();

    await page.fill('#fest-delete-reason', 'duplicate entry');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    await expect
      .poll(async () => page.evaluate(() => window.__store.festivals.find(f => f.id === 'f2')?.deleted_at))
      .toBeTruthy();
    const fest = await page.evaluate(() => window.__store.festivals.find(f => f.id === 'f2'));
    expect(fest.delete_reason).toBe('duplicate entry');

    const audit = await page.evaluate(() =>
      window.__store.audit_logs.filter(a => a.action === 'festival.soft_delete' && a.entity_id === 'f2'));
    expect(audit.length).toBe(1);
    expect(audit[0].reason).toBe('duplicate entry');
  });

  test('blocked by another person\'s RSVP offers Archive instead of delete', async ({ page }) => {
    await bootAuthedApp(page);
    // f1 already has r-you (TEST_UID) going; link r-kai (owned by a different
    // auth user, kai-uid) so the delete is blocked by someone else's RSVP.
    await page.evaluate((uid) => {
      window.__store.festivals.find(f => f.id === 'f1').created_by = uid;
      window.__store.raver_festivals.push({ raver_id: 'r-kai', festival_id: 'f1' });
    }, TEST_UID);
    await page.evaluate(async () => { await loadAllData(); renderEvents(); });

    await page.evaluate(() => { activeFestId = 'f1'; showDeleteRaveConfirm(); });
    await expect(page.locator('#delete-rave-sheet-overlay')).toHaveClass(/open/);
    await expect(page.locator('#delete-rave-sheet-content')).toContainText('Kai');
    // No delete option is offered in this state — only Archive or back out.
    await expect(page.locator('#delete-rave-sheet-content')).not.toContainText('Delete');

    await page.click('#delete-rave-sheet-content .btn-primary');

    await expect
      .poll(async () => page.evaluate(() => window.__store.festivals.find(f => f.id === 'f1')?.archived_at))
      .toBeTruthy();
    // Data stays intact — archiving is non-destructive.
    const stillRsvped = await page.evaluate(() =>
      window.__store.raver_festivals.some(r => r.raver_id === 'r-kai' && r.festival_id === 'f1'));
    expect(stillRsvped).toBe(true);

    // Off the active Raves list after the client-side flag flips.
    await expect(page.locator('#events-list')).not.toContainText('Tomorrowland');
  });
});
