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

  test('opening a freshly-created crew to recruiting works after the temp id resolves', async ({ page }) => {
    // Regression test: createCrew() renders the detail page immediately with a
    // client-side temp id, then swaps in the real DB id once the insert
    // resolves. If the detail page isn't re-rendered on that swap, the "Open
    // the Crew to Recruiting" button keeps calling setStatus() with the
    // stale temp id — getCrew() then finds nothing, and the (sole, actual)
    // Crew Lead gets a misleading "Only the Crew Lead can change the status"
    // toast.
    await bootAuthedApp(page);

    await page.evaluate(() => {
      document.getElementById('crew-name-input').value = 'Our House';
      createCrew();
    });

    // Wait for the temp -> real id swap (the async dbSaveCrew().then()) to land.
    await expect
      .poll(() => page.evaluate(() => crews.find(c => c.name === 'Our House')?.id))
      .not.toMatch(/^temp_/);

    // The lead is on the Roster tab — where the status control lives.
    await page.locator('#page-crew-detail .stats-subtab', { hasText: 'Roster' }).click();
    await page.locator('#page-crew-detail .btn-status-cta', { hasText: 'Open the Crew to Recruiting' }).click();
    await page.locator('#status-warn-modal .btn-primary').click();

    await expect(page.locator('#toast')).not.toContainText('Only the Crew Lead');
    const status = await page.evaluate(() => crews.find(c => c.name === 'Our House')?.status);
    expect(status).toBe('recruiting');
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
