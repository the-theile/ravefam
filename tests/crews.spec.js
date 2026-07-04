const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

async function refetch(page, expr) {
  return page.evaluate(async (src) => { await loadAllData(); return eval(src); }, expr);
}

test.describe('crews', () => {
  test('crew detail lists both members', async ({ page }) => {
    await bootAuthedApp(page);
    await page.locator('#crew-grid .crew-card').first().click();
    // The detail roster shows first names only.
    const detail = page.locator('#page-crew-detail');
    await expect(detail).toContainText('Theile');
    await expect(detail).toContainText('Sam');
  });

  test('editing a crew name persists', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => {
      showCrewEditModal('c1');
      document.getElementById('crew-edit-name-input').value = 'Bass Syndicate II';
      saveCrewEdit();
    });
    const name = await refetch(page, "crews.find(c=>String(c.id)==='c1').name");
    expect(name).toBe('Bass Syndicate II');
  });

  test('changing crew status persists (recruiting → locked-in)', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(async () => { await sb.from('crews').update({ status: 'locked-in' }).eq('id', 'c1'); });
    const status = await refetch(page, "crews.find(c=>String(c.id)==='c1').status");
    expect(status).toBe('locked-in');
  });

  test('deleting a crew removes it and its memberships', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(async () => { await deleteCrew('c1', 'test cleanup'); });
    // Soft delete: gone from live app state and future re-fetches, but the
    // underlying rows persist with deleted_at set (see soft_delete.spec.js).
    const gone = await refetch(page, "crews.some(c=>String(c.id)==='c1')");
    expect(gone).toBe(false);
    const crewRow = await page.evaluate(() => window.__store.crews.find(c => c.id === 'c1'));
    expect(crewRow.deleted_at).toBeTruthy();
    expect(crewRow.delete_reason).toBe('test cleanup');
    const members = await page.evaluate(() => window.__store.crew_members.filter(m => m.crew_id === 'c1'));
    expect(members.length).toBeGreaterThan(0);
    expect(members.every(m => m.deleted_at)).toBe(true);

    const audit = await page.evaluate(() =>
      window.__store.audit_logs.filter(a => a.action === 'crew.delete' && a.entity_id === 'c1'));
    expect(audit.length).toBe(1);
    expect(audit[0].reason).toBe('test cleanup');
  });

  test('crew search shows no card for an unknown query, restores on clear', async ({ page }) => {
    await bootAuthedApp(page);
    await page.fill('#crew-search', 'zzz-no-match');
    await page.evaluate(() => renderCrews());
    await expect(page.locator('#crew-grid .crew-card')).toHaveCount(0);
    await page.fill('#crew-search', '');
    await page.evaluate(() => renderCrews());
    await expect(page.locator('#crew-grid .crew-card')).toHaveCount(1);
  });
});
