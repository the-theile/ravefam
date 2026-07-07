const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// History/Activity views: festival modal, crew detail section, raver profile
// section — all read-only timelines over get_{festival,crew,raver}_history()
// (see 20260708000000_history_views.sql). Moderators additionally see the
// `reason` field (mod delete/removal notes); regular users never do, because
// the RPCs mask it server-side, not just in the client's `showReason` flag.

function seedWithMod() {
  const data = seedData();
  data.moderators = [{ user_id: TEST_UID, added_at: '2024-01-01T00:00:00Z', added_by: null }];
  return data;
}

function seedAuditLog(row) {
  return { id: 'a-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), metadata: {}, reason: null, ...row };
}

test.describe('festival history', () => {
  test('renders logged entries via the History modal button', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate((row) => { window.__store.audit_logs = [row]; }, seedAuditLog({
      actor_id: TEST_UID, actor_name: 'Theile', action: 'festival.soft_delete',
      entity_type: 'festival', entity_id: 'f2', reason: 'duplicate entry',
    }));

    await page.evaluate(() => { openRaveEditor('f2'); showFestivalHistoryInModal('f2'); });
    await expect(page.locator('#festival-history-list')).toContainText('Rave deleted');
    await expect(page.locator('#festival-history-list')).toContainText('Theile');
    // Regular (non-moderator) user never sees the mod-only reason.
    await expect(page.locator('#festival-history-list')).not.toContainText('Mod note');
  });

  test('moderator sees the delete reason, regular user does not', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await page.evaluate((row) => { window.__store.audit_logs = [row]; }, seedAuditLog({
      actor_id: TEST_UID, actor_name: 'Theile', action: 'festival.soft_delete',
      entity_type: 'festival', entity_id: 'f2', reason: 'duplicate entry',
    }));

    await page.evaluate(() => { openRaveEditor('f2'); showFestivalHistoryInModal('f2'); });
    await expect(page.locator('#festival-history-list')).toContainText('🔒 Mod note: duplicate entry');
  });

  test('empty state message shows when nothing has been logged', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { openRaveEditor('f1'); showFestivalHistoryInModal('f1'); });
    await expect(page.locator('#festival-history-list')).toContainText('No history yet');
  });
});

test.describe('crew history', () => {
  test('renders in the crew detail section and expands/collapses', async ({ page }) => {
    await bootAuthedApp(page);
    const rows = Array.from({ length: 8 }, (_, i) => seedAuditLog({
      actor_id: TEST_UID, actor_name: 'Theile', action: 'crew_member.remove',
      entity_type: 'crew_member', entity_id: 'r-sam', metadata: { crew_id: 'c1' },
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));
    await page.evaluate((r) => { window.__store.audit_logs = r; }, rows);

    await page.evaluate(async () => { await openDetail('c1'); });
    await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
    await expect(page.locator('#crew-history-section')).toContainText('Removed from the crew');

    // History lives behind the "History" feature tile — open it before
    // interacting with anything inside (it starts collapsed on Overview).
    await page.locator('.crew-feature-tile[data-feature="history"]').click();

    // Collapsed to 6 by default with 8 rows seeded — "Show more" appears.
    const showMoreBtn = page.locator('#crew-history-section button', { hasText: 'Show' });
    await expect(showMoreBtn).toContainText('Show 2 more');
    await showMoreBtn.click();
    await expect(page.locator('#crew-history-section button', { hasText: 'Show less' })).toBeVisible();
  });
});

test.describe('raver history', () => {
  test('renders for an unclaimed profile, moderator sees the reason', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await page.evaluate((row) => { window.__store.audit_logs = [row]; }, seedAuditLog({
      actor_id: TEST_UID, actor_name: 'Theile', action: 'raver.update',
      entity_type: 'raver', entity_id: 'r-sam', reason: 'cleanup',
      metadata: { fields: ['genres'] },
    }));

    await page.evaluate(() => openProfile('r-sam'));
    await expect(page.locator('#page-profile')).toHaveClass(/active/);
    await page.evaluate(() => toggleRaverHistorySection());
    await expect(page.locator('#raver-history-body')).toContainText('Profile updated');
    await expect(page.locator('#raver-history-body')).toContainText('Changed: genres');
  });

  test('regular (non-moderator) user does not see the reason field', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate((row) => { window.__store.audit_logs = [row]; }, seedAuditLog({
      actor_id: TEST_UID, actor_name: 'Theile', action: 'raver.update',
      entity_type: 'raver', entity_id: 'r-sam', reason: 'cleanup',
    }));

    await page.evaluate(() => openProfile('r-sam'));
    await page.evaluate(() => toggleRaverHistorySection());
    await expect(page.locator('#raver-history-body')).toContainText('Profile updated');
    await expect(page.locator('#raver-history-body')).not.toContainText('Mod note');
  });

  test('empty state message shows when nothing has been logged', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-sam'));
    await page.evaluate(() => toggleRaverHistorySection());
    await expect(page.locator('#raver-history-body')).toContainText('No history yet');
  });
});
