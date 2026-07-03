const { test, expect } = require('@playwright/test');
const { bootAuthedApp, TEST_UID } = require('./helpers');

// Soft delete + audit log: deleted rows are updated (deleted_at/deleted_by
// set), never removed from the store, and each action leaves an audit_logs
// row. See dbDeleteFestival, dbRemoveCrewMember, deleteUnclaimedProfile.

test.describe('soft delete + audit log', () => {
  test('dbDeleteFestival soft-deletes the row and logs an audit entry', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(async () => { await dbDeleteFestival('f1'); });

    const fest = await page.evaluate(() => window.__store.festivals.find(f => f.id === 'f1'));
    expect(fest).toBeTruthy();
    expect(fest.deleted_at).toBeTruthy();
    expect(fest.deleted_by).toBe(TEST_UID);

    const audit = await page.evaluate(() =>
      window.__store.audit_logs.filter(a => a.action === 'festival.soft_delete' && a.entity_id === 'f1'));
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe(TEST_UID);

    // Filtered out of the live app state after a re-fetch.
    await page.evaluate(async () => { await loadAllData(); });
    const stillListed = await page.evaluate(() => festivals.some(f => String(f.id) === 'f1'));
    expect(stillListed).toBe(false);
  });

  test('dbRemoveCrewMember soft-deletes the membership and logs an audit entry', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(async () => { await dbRemoveCrewMember('c1', 'r-sam'); });

    const membership = await page.evaluate(() =>
      window.__store.crew_members.find(cm => cm.crew_id === 'c1' && cm.raver_id === 'r-sam'));
    expect(membership).toBeTruthy();
    expect(membership.deleted_at).toBeTruthy();
    expect(membership.deleted_by).toBe(TEST_UID);

    const audit = await page.evaluate(() =>
      window.__store.audit_logs.filter(a => a.action === 'crew_member.remove' && a.entity_id === 'r-sam'));
    expect(audit.length).toBe(1);
    expect(audit[0].metadata.crew_id).toBe('c1');
  });

  test('deleteUnclaimedProfile soft-deletes the raver and their crew memberships, and logs both', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(() => { deleteUnclaimedProfile('r-sam'); });
    // Reason is now mandatory — the confirm button stays disabled until filled.
    await page.fill('#confirm-reason-input', 'test cleanup');
    await page.click('#confirm-ok-btn');

    await expect
      .poll(async () => page.evaluate(() => {
        const r = window.__store.ravers.find(x => x.id === 'r-sam');
        return !!(r && r.deleted_at);
      }))
      .toBe(true);

    const raver = await page.evaluate(() => window.__store.ravers.find(r => r.id === 'r-sam'));
    expect(raver.deleted_by).toBe(TEST_UID);

    const membership = await page.evaluate(() =>
      window.__store.crew_members.find(cm => cm.crew_id === 'c1' && cm.raver_id === 'r-sam'));
    expect(membership.deleted_at).toBeTruthy();

    const raverAudit = await page.evaluate(() =>
      window.__store.audit_logs.filter(a => a.action === 'raver.delete' && a.entity_id === 'r-sam'));
    expect(raverAudit.length).toBe(1);

    const memberAudit = await page.evaluate(() =>
      window.__store.audit_logs.filter(a => a.action === 'crew_member.remove' && a.entity_id === 'r-sam' && a.metadata.via === 'raver_delete'));
    expect(memberAudit.length).toBe(1);
    expect(memberAudit[0].metadata.crew_ids).toContain('c1');
  });
});
