const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Vendor Village: the community vendor directory behind the Coming Soon tab's
// 4-tap reveal gate. See dbAddVendor/dbLoadVendors/dbDeleteVendor,
// dbToggleSaveVendor, dbUpsertVendorReview, dbSetVendorSponsored, and
// vendorVillageTap/renderVendorVillage in app.html.

function seedWithMod() {
  const data = seedData();
  data.moderators = [{ user_id: TEST_UID, added_at: '2024-01-01T00:00:00Z', added_by: null }];
  return data;
}

// Taps the gate open and waits for the resulting data load to settle, so
// callers don't race the fire-and-forget load kicked off by the 4th tap.
async function openVendorVillage(page) {
  await page.evaluate(() => switchTab('checklist'));
  await page.evaluate(() => {
    vendorVillageTap(); vendorVillageTap(); vendorVillageTap(); vendorVillageTap();
  });
  await page.evaluate(async () => { await loadVendorVillageData(); });
  await expect(page.locator('#vendor-village-root')).toContainText('Browse');
}

test.describe('Vendor Village reveal gate', () => {
  test('4 taps unlocks it, 3 taps does not, and a reload resets it', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('checklist'));

    await page.evaluate(() => { vendorVillageTap(); vendorVillageTap(); vendorVillageTap(); });
    expect(await page.evaluate(() => document.getElementById('vendor-village-root').innerHTML.trim())).toBe('');

    await page.evaluate(() => vendorVillageTap());
    await expect(page.locator('#vendor-village-root')).toContainText('Browse');

    await page.reload();
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.evaluate(() => switchTab('checklist'));
    expect(await page.evaluate(() => document.getElementById('vendor-village-root').innerHTML.trim())).toBe('');
  });
});

test.describe('Vendor Village · browse + save', () => {
  test('adding a vendor shows it in Browse and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);

    await page.evaluate(async () => {
      await dbAddVendor({ name: 'Soft Landings', category: 'safety_comfort', description: 'Comfy earplugs', websiteUrl: 'https://softlandings.example', instagram: '' });
      renderVendorBrowsePanel();
    });

    await expect(page.locator('#vv-browse-panel')).toContainText('Soft Landings');
    const stored = await page.evaluate(() => (window.__store.vendors || []).some(v => v.name === 'Soft Landings'));
    expect(stored).toBe(true);
  });

  test('saving then unsaving a vendor toggles saved_vendors', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Kandi Corner', category: 'jewelry_kandi', description: '', websiteUrl: '', instagram: '' })).id);

    await page.evaluate((id) => dbToggleSaveVendor(id), vendorId);
    let saved = await page.evaluate((id) => (window.__store.saved_vendors || []).some(s => s.vendor_id === id), vendorId);
    expect(saved).toBe(true);

    await page.evaluate((id) => dbToggleSaveVendor(id), vendorId);
    saved = await page.evaluate((id) => (window.__store.saved_vendors || []).some(s => s.vendor_id === id), vendorId);
    expect(saved).toBe(false);
  });
});

test.describe('Vendor Village · reviews', () => {
  test('posting then editing a review updates one row, not two', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Glow Gear', category: 'gear_accessories', description: '', websiteUrl: '', instagram: '' })).id);

    await page.evaluate((id) => dbUpsertVendorReview(id, 4, 'solid quality'), vendorId);
    await page.evaluate((id) => dbUpsertVendorReview(id, 5, 'even better than I thought'), vendorId);

    const reviews = await page.evaluate((id) => (window.__store.vendor_reviews || []).filter(r => r.vendor_id === id), vendorId);
    expect(reviews.length).toBe(1);
    expect(reviews[0].rating).toBe(5);
    expect(reviews[0].body).toBe('even better than I thought');
  });
});

test.describe('Vendor Village · moderation', () => {
  test('deleting a vendor soft-deletes it and restore brings it back', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Sketchy Booth', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    await page.evaluate((id) => dbDeleteVendor(id, 'reported as scam'), vendorId);
    let vendor = await page.evaluate((id) => window.__store.vendors.find(v => v.id === id), vendorId);
    expect(vendor.deleted_at).toBeTruthy();

    await page.evaluate(async (id) => {
      const row = window.__store.audit_logs.find(a => a.action === 'vendor.remove' && a.entity_id === id);
      await restoreFromAuditRow(row);
    }, vendorId);
    vendor = await page.evaluate((id) => window.__store.vendors.find(v => v.id === id), vendorId);
    expect(vendor.deleted_at).toBeFalsy();
  });

  test('reporting a vendor opens a flag visible to the mod dashboard', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Questionable Wares', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    await page.evaluate((id) => dbSubmitFlag('vendor', id, 'looks fake', {}), vendorId);
    const flag = await page.evaluate((id) => window.__store.flags.find(f => f.target_type === 'vendor' && f.target_id === String(id)), vendorId);
    expect(flag).toBeTruthy();
    expect(flag.status).toBe('open');

    const flags = await page.evaluate(() => dbLoadFlags());
    expect(flags.some(f => f.target_type === 'vendor')).toBe(true);
  });

  test('sponsorship is moderator-only', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() }); // no moderators seeded
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Non-mod Test', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    const ok = await page.evaluate((id) => dbSetVendorSponsored(id, { isSponsored: true, sponsorPriority: 10, source: 'official' }), vendorId);
    expect(ok).toBe(false);
    const vendor = await page.evaluate((id) => window.__store.vendors.find(v => v.id === id), vendorId);
    expect(vendor.is_sponsored).toBeFalsy();
  });

  test('a moderator can mark a vendor sponsored and the badge renders', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Official Partner', category: 'safety_comfort', description: '', websiteUrl: '', instagram: '' })).id);

    const ok = await page.evaluate((id) => dbSetVendorSponsored(id, { isSponsored: true, sponsorPriority: 10, source: 'official' }), vendorId);
    expect(ok).toBe(true);

    await page.evaluate(() => renderVendorBrowsePanel());
    await expect(page.locator('#vv-browse-panel')).toContainText('Sponsored');
  });
});
