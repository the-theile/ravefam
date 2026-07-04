const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Moderation system: community flags (Reports), moderator triage
// (dismiss/resolve), restore-from-Recent-Deletes, and the rate-limit
// trigger's friendly client-side toast. See dbSubmitFlag, dbLoadFlags,
// dbResolveFlag, dbDismissFlag, dbRestoreRow, restoreFromAuditRow,
// softDeleteRow's RATE_LIMIT_* handling.

function seedWithMod() {
  const data = seedData();
  data.moderators = [{ user_id: TEST_UID, added_at: '2024-01-01T00:00:00Z', added_by: null }];
  return data;
}

test.describe('flags: submit + triage', () => {
  test('submitting a flag inserts an open row reported by the current user', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });

    await page.evaluate(() => dbSubmitFlag('raver', 'r-sam', 'suspicious profile', {}));

    const flag = await page.evaluate(() => window.__store.flags.find(f => f.target_id === 'r-sam'));
    expect(flag).toBeTruthy();
    expect(flag.status).toBe('open');
    expect(flag.reporter_id).toBe(TEST_UID);
    expect(flag.reason).toBe('suspicious profile');
  });

  test('moderator can dismiss and resolve flags', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await page.evaluate(async () => {
      window.__store.flags = [{
        id: 'flag-1', reporter_id: 'someone-else', target_type: 'raver', target_id: 'r-sam',
        status: 'open', reason: 'spam', metadata: {}, created_at: new Date().toISOString(),
      }];
      await loadAllData();
    });

    await page.evaluate(() => dbDismissFlag('flag-1', null));
    let flag = await page.evaluate(() => window.__store.flags.find(f => f.id === 'flag-1'));
    expect(flag.status).toBe('dismissed');
    expect(flag.resolved_by).toBe(TEST_UID);

    await page.evaluate(() => dbResolveFlag('flag-1', null));
    flag = await page.evaluate(() => window.__store.flags.find(f => f.id === 'flag-1'));
    expect(flag.status).toBe('resolved');
  });
});

test.describe('restore from Recent Deletes', () => {
  test('restoreFromAuditRow undoes a soft delete and logs a .restore audit entry', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });

    await page.evaluate(async () => { await dbDeleteFestival('f1', 'test delete'); });
    await page.evaluate(async () => {
      const row = window.__store.audit_logs.find(a => a.action === 'festival.soft_delete' && a.entity_id === 'f1');
      await restoreFromAuditRow(row);
    });

    const fest = await page.evaluate(() => window.__store.festivals.find(f => f.id === 'f1'));
    expect(fest.deleted_at).toBeFalsy();
    expect(fest.deleted_by).toBeFalsy();

    const restoreAudit = await page.evaluate(() =>
      window.__store.audit_logs.filter(a => a.action === 'festival.restore' && a.entity_id === 'f1'));
    expect(restoreAudit.length).toBe(1);
  });

  test('dbLoadRecentDestructiveActions is moderator-only', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await page.evaluate(async () => { await dbDeleteFestival('f1', 'test delete'); });

    const rows = await page.evaluate(() => dbLoadRecentDestructiveActions());
    expect(rows.length).toBe(0);
  });
});

test.describe('rate limit', () => {
  test('a simulated rate-limit trip shows a friendly toast and leaves the row un-deleted', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await page.evaluate(() => { window.__store.__rateLimit = { hourlyCount: 5 }; });

    await page.evaluate(async () => { await dbDeleteFestival('f1', 'sixth one'); });

    await expect(page.locator('#toast')).toContainText('slow down');
    const fest = await page.evaluate(() => window.__store.festivals.find(f => f.id === 'f1'));
    expect(fest.deleted_at).toBeFalsy();
  });
});
