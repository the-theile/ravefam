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

test.describe('report sheet: categories', () => {
  test('a report needs a category, and "Something else" needs details', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await page.evaluate(() => showReportModal('raver', 'r-sam'));
    await expect(page.locator('#mod-sheet-overlay')).toHaveClass(/open/);
    await expect(page.locator('#report-submit-btn')).toBeDisabled();

    await page.locator('#mod-sheet .status-opt', { hasText: 'Something else' }).click();
    await expect(page.locator('#report-submit-btn')).toBeDisabled();
    await page.locator('#report-details-input').fill('weird vibes');
    await expect(page.locator('#report-submit-btn')).toBeEnabled();

    await page.locator('#mod-sheet .status-opt', { hasText: 'Safety concern' }).click();
    await expect(page.locator('#report-details-input')).toHaveValue('weird vibes');
    await expect(page.locator('#mod-sheet .mod-callout-danger')).toBeVisible();
    await page.locator('#report-submit-btn').click();

    await expect(page.locator('#mod-sheet-overlay')).not.toHaveClass(/open/);
    const flag = await page.evaluate(() => window.__store.flags.find(f => f.target_id === 'r-sam'));
    expect(flag.category).toBe('safety');
    expect(flag.reason).toBe('weird vibes');
  });
});

test.describe('mod actions from a report', () => {
  async function seedOpenFlags(page, flags) {
    await page.evaluate(async (rows) => {
      window.__store.flags = rows.map(r => ({ status: 'open', reason: null, metadata: {}, category: 'other', created_at: new Date().toISOString(), ...r }));
      await openModDashboard();
    }, flags);
  }

  test('Remove & resolve soft-deletes the target, closes every open report on it, and logs a restorable audit row', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await seedOpenFlags(page, [
      { id: 'flag-a', reporter_id: 'u-1', target_type: 'festival', target_id: 'f1' },
      { id: 'flag-b', reporter_id: 'u-2', target_type: 'festival', target_id: 'f1', category: 'spam' },
    ]);
    await expect(page.locator('.mod-flag-card')).toHaveCount(2);

    await page.evaluate(() => openModRemoveSheet('flag-a'));
    await expect(page.locator('#mod-action-submit')).toBeDisabled();
    await page.locator('#mod-rule-select').selectOption('5');
    await page.locator('#mod-note-input').fill('spam rave');
    await page.locator('#mod-action-submit').click();
    await expect(page.locator('#mod-sheet-overlay')).not.toHaveClass(/open/);

    const state = await page.evaluate(() => ({
      fest: window.__store.festivals.find(f => f.id === 'f1'),
      flags: window.__store.flags.map(f => f.status),
      audit: window.__store.audit_logs.find(a => a.action === 'festival.remove' && a.entity_id === 'f1'),
    }));
    expect(state.fest.deleted_at).toBeTruthy();
    expect(state.flags).toEqual(['resolved', 'resolved']);
    expect(state.audit).toBeTruthy();
    expect(state.audit.metadata.flag_id).toBe('flag-a');
  });

  test('Safety reports sort to the top of the queue', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await seedOpenFlags(page, [
      { id: 'flag-new', reporter_id: 'u-1', target_type: 'raver', target_id: 'r-sam', category: 'spam' },
      { id: 'flag-old', reporter_id: 'u-2', target_type: 'raver', target_id: 'r-sam', category: 'safety', created_at: '2020-01-01T00:00:00Z' },
    ]);
    await expect(page.locator('.mod-flag-card').first()).toHaveClass(/is-safety/);
  });

  test('Warn issues a warning on the owner and resolves the report', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await page.evaluate(() => {
      window.__store.__rpc = { mod_flag_context: { 'flag-w': { owner: { user_id: 'owner-1', name: 'Owner', sanctions: [], recent_reports: [] }, reporter: null, target_open_count: 1 } } };
    });
    await seedOpenFlags(page, [{ id: 'flag-w', reporter_id: 'u-1', target_type: 'jam', target_id: 'j-x' }]);
    await expect(page.locator('.mod-flag-card button', { hasText: 'Warn' })).toBeVisible();

    await page.locator('.mod-flag-card button', { hasText: 'Warn' }).click();
    await expect(page.locator('#mod-action-submit')).toBeDisabled();
    await page.locator('#mod-rule-select').selectOption('1');
    await page.locator('#mod-note-input').fill('keep it kind');
    await page.locator('#mod-action-submit').click();

    const state = await page.evaluate(() => ({
      sanction: (window.__store.user_sanctions || [])[0],
      flag: window.__store.flags.find(f => f.id === 'flag-w'),
    }));
    expect(state.sanction).toMatchObject({ user_id: 'owner-1', kind: 'warning', rule_code: '1', note: 'keep it kind', flag_id: 'flag-w' });
    expect(state.flag.status).toBe('resolved');
  });

  test('Restrict needs a duration and stores an expiry', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await page.evaluate(() => {
      window.__store.__rpc = { mod_flag_context: { 'flag-r': { owner: { user_id: 'owner-2', name: 'Owner', sanctions: [], recent_reports: [] }, reporter: null, target_open_count: 1 } } };
    });
    await seedOpenFlags(page, [{ id: 'flag-r', reporter_id: 'u-1', target_type: 'jam', target_id: 'j-x' }]);
    await page.evaluate(() => openModSanctionSheet('flag-r', 'restrict'));
    await page.locator('#mod-sheet .status-opt', { hasText: 'Photos & media' }).click();
    await page.locator('#mod-sheet .status-opt', { hasText: '7 days' }).click();
    await page.locator('#mod-action-submit').click();

    const s = await page.evaluate(() => window.__store.user_sanctions[0]);
    expect(s.kind).toBe('restrict_photos');
    const hours = (new Date(s.expires_at) - Date.now()) / 3600e3;
    expect(hours).toBeGreaterThan(167);
    expect(hours).toBeLessThan(169);
  });
});

test.describe('sanctions on my own account', () => {
  test('an unacknowledged warning shows a locked notice until "I understand"', async ({ page }) => {
    const data = seedData();
    data.user_sanctions = [{ id: 'w-1', user_id: TEST_UID, kind: 'warning', rule_code: '2', note: 'ask first', created_at: '2024-01-01T00:00:00Z', expires_at: null, acknowledged_at: null, revoked_at: null }];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => dbLoadMySanctions());

    await expect(page.locator('#mod-sheet')).toContainText('A note from the mods');
    await expect(page.locator('#mod-sheet')).toContainText('ask first');
    // Locked: tapping the backdrop doesn't dismiss it.
    await page.locator('#mod-sheet-overlay').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#mod-sheet-overlay')).toHaveClass(/open/);

    await page.locator('#warning-ack-btn').click();
    await expect(page.locator('#mod-sheet-overlay')).not.toHaveClass(/open/);
    const ack = await page.evaluate(() => window.__store.user_sanctions[0].acknowledged_at);
    expect(ack).toBeTruthy();
  });

  test('an active restriction blocks the write client-side with a friendly toast', async ({ page }) => {
    const data = seedData();
    data.user_sanctions = [{ id: 'r-1', user_id: TEST_UID, kind: 'restrict_create', created_at: '2024-01-01T00:00:00Z', expires_at: new Date(Date.now() + 86400e3).toISOString(), acknowledged_at: null, revoked_at: null }];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => dbLoadMySanctions());

    const before = await page.evaluate(() => window.__store.crews.length);
    const id = await page.evaluate(() => dbSaveCrew({ name: 'Nope', color: '#fff', gradient: '', status: 'secret' }));
    expect(id).toBeNull();
    expect(await page.evaluate(() => window.__store.crews.length)).toBe(before);
    await expect(page.locator('#toast')).toContainText('paused on your account');
    expect(await page.evaluate(() => blockedByRestriction('restrict_huddle'))).toBe(false);
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
