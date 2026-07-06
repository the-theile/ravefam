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

    await page.evaluate((id) => dbUpsertVendorReview(id, { rating: 4, body: 'solid quality' }), vendorId);
    await page.evaluate((id) => dbUpsertVendorReview(id, { rating: 5, body: 'even better than I thought' }), vendorId);

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

test.describe('Vendor Village · crew cosigns', () => {
  test('a review from someone in your crew shows a cosign chip', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Crew Fave', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    // r-kai (claimed_by 'kai-uid') is in crew c1 along with r-you (the booted
    // user) — a review keyed on kai-uid should resolve as a crew cosign.
    await page.evaluate(async (id) => {
      (window.__store.vendor_reviews ||= []).push({
        id: 'review-kai', vendor_id: id, raver_id: 'kai-uid', rating: 5,
        body: 'love it', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      await dbLoadVendorReviews([id]);
      openVendorDetail(id);
    }, vendorId);

    await expect(page.locator('#vv-detail-modal')).toContainText('Bass Syndicate');
  });
});

test.describe('Vendor Village · vibe tags', () => {
  test('adding then removing your own tag round-trips through vendor_vibe_tags', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Tag Test', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    await page.evaluate((id) => dbAddVendorVibeTag(id, 'plur_approved'), vendorId);
    let tags = await page.evaluate((id) => (window.__store.vendor_vibe_tags || []).filter(t => t.vendor_id === id), vendorId);
    expect(tags.length).toBe(1);
    expect(tags[0].tag_id).toBe('plur_approved');

    await page.evaluate((id) => dbRemoveVendorVibeTag(id, 'plur_approved'), vendorId);
    tags = await page.evaluate((id) => (window.__store.vendor_vibe_tags || []).filter(t => t.vendor_id === id), vendorId);
    expect(tags.length).toBe(0);
  });
});

test.describe('Vendor Village · haul photos + attribute tags', () => {
  test('review upsert persists photo_url and attribute_tags, and the tally counts them', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Haul Test', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    await page.evaluate((id) => dbUpsertVendorReview(id, {
      rating: 5, body: 'great haul', photoUrl: 'https://example.com/haul.jpg', attributeTags: ['cash_only', 'long_line'],
    }), vendorId);

    const review = await page.evaluate((id) => (window.__store.vendor_reviews || []).find(r => r.vendor_id === id), vendorId);
    expect(review.photo_url).toBe('https://example.com/haul.jpg');
    expect(review.attribute_tags).toEqual(['cash_only', 'long_line']);

    const tally = await page.evaluate((id) => vendorAttributeTagTally(id), vendorId);
    expect(tally.find(t => t.tagId === 'cash_only').count).toBe(1);
  });
});

test.describe('Vendor Village · fam discount + edit listing', () => {
  test('dbAddVendor accepts a discount code at creation time, not just via edit', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendor = await page.evaluate(async () =>
      dbAddVendor({
        name: 'Day One Discount', category: 'health_wellness', description: '', websiteUrl: '', instagram: '',
        discountCode: 'FAM15', discountDescription: '15% off for the fam',
      }));
    expect(vendor.discount_code).toBe('FAM15');
    expect(vendor.category).toBe('health_wellness');

    const stored = await page.evaluate((id) => window.__store.vendors.find(v => v.id === id), vendor.id);
    expect(stored.discount_description).toBe('15% off for the fam');
  });

  test('dbUpdateVendor updates the discount fields and basic fields', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Edit Me', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    const updated = await page.evaluate((id) => dbUpdateVendor(id, {
      name: 'Edit Me v2', category: 'apparel_merch', description: 'now with merch', websiteUrl: '', instagram: '',
      discountCode: 'RAVEFAM10', discountDescription: '10% off for the fam',
    }), vendorId);
    expect(updated.discount_code).toBe('RAVEFAM10');

    const stored = await page.evaluate((id) => window.__store.vendors.find(v => v.id === id), vendorId);
    expect(stored.name).toBe('Edit Me v2');
    expect(stored.discount_description).toBe('10% off for the fam');
  });

  test('adding a cover photo via Edit Listing to a vendor that had none persists it', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Needs a Photo', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    await page.evaluate((id) => openEditVendorModal(id), vendorId);
    await expect(page.locator('#vv-edit-modal')).toContainText('Add a cover photo');

    // Stub the upload pipeline (same technique smoke.spec.js uses for
    // loadAllData) — compressImageToBlob needs a real decodable image and
    // the offline storage stub always returns an empty publicUrl, neither
    // of which is what this test actually cares about (that a picked file
    // reaches uploadPhotoToStorage and the result gets persisted).
    await page.evaluate(() => { window.uploadPhotoToStorage = async () => 'https://example.com/fake-cover.jpg'; });
    await page.locator('#vv-edit-photo').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('fake') });
    await page.evaluate((id) => handleVendorEditSubmit(id), vendorId);
    await page.waitForTimeout(200);

    const stored = await page.evaluate((id) => window.__store.vendors.find(v => v.id === id), vendorId);
    expect(stored.cover_photo_url).toBe('https://example.com/fake-cover.jpg');
  });

  test('editing a vendor that already has a photo shows the replace label', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () => {
      const v = await dbAddVendor({ name: 'Has A Photo', category: 'other', description: '', websiteUrl: '', instagram: '' });
      v.cover_photo_url = 'https://example.com/existing.jpg';
      window.__store.vendors.find(x => x.id === v.id).cover_photo_url = 'https://example.com/existing.jpg';
      return v.id;
    });

    await page.evaluate((id) => openEditVendorModal(id), vendorId);
    await expect(page.locator('#vv-edit-modal')).toContainText('Replace cover photo');
  });

  test('a non-creator cannot edit someone else\'s vendor', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Not Yours', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);
    await page.evaluate((id) => {
      window.__store.vendors.find(v => v.id === id).created_by = 'someone-else';
      vendors.find(v => v.id === id).created_by = 'someone-else';
    }, vendorId);

    const result = await page.evaluate((id) => dbUpdateVendor(id, {
      name: 'Hijacked', category: 'other', description: '', websiteUrl: '', instagram: '', discountCode: '', discountDescription: '',
    }), vendorId);
    expect(result).toBeNull();
  });
});

test.describe('Vendor Village · spotted right now', () => {
  test('posting a spot auto-tags the festival and shows as live', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Spot Test', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);

    await page.evaluate((id) => dbAddVendorSpot(id, 'f1', 'right by the entrance'), vendorId);

    const spots = await page.evaluate((id) => (window.__store.vendor_spots || []).filter(s => s.vendor_id === id), vendorId);
    expect(spots.length).toBe(1);
    expect(spots[0].festival_id).toBe('f1');

    const tagged = await page.evaluate((id) =>
      (window.__store.vendor_festival_tags || []).some(t => t.vendor_id === id && t.festival_id === 'f1'), vendorId);
    expect(tagged).toBe(true);

    // The stub doesn't simulate Postgres' `default now()` on created_at (real
    // inserts get a real timestamp back; the stub echoes exactly what was
    // sent) — patch it here so the time-window filter has something to
    // compare, same workaround the "older than 24h" test below relies on.
    await page.evaluate((id) => {
      const now = new Date().toISOString();
      window.__store.vendor_spots.find(s => s.vendor_id === id).created_at = now;
      vendorSpotsCache[id][0].created_at = now;
    }, vendorId);

    const liveCount = await page.evaluate((id) => vendorLiveSpots(id).length, vendorId);
    expect(liveCount).toBe(1);
  });

  test('a spot older than 24h no longer counts as live', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Old Spot Test', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);
    await page.evaluate((id) => dbAddVendorSpot(id, 'f1', null), vendorId);

    // Prove the before/after transition, not just the end state — give it a
    // fresh timestamp first (confirming it WOULD be live) before aging it
    // past the window, so this doesn't pass merely because the stub leaves
    // created_at unset (see the auto-tag test above for that workaround).
    await page.evaluate((id) => { vendorSpotsCache[id][0].created_at = new Date().toISOString(); }, vendorId);
    expect(await page.evaluate((id) => vendorLiveSpots(id).length, vendorId)).toBe(1);

    await page.evaluate((id) => {
      vendorSpotsCache[id][0].created_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    }, vendorId);

    const liveCount = await page.evaluate((id) => vendorLiveSpots(id).length, vendorId);
    expect(liveCount).toBe(0);
  });

  test('a spot can be flagged and soft-deleted', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await openVendorVillage(page);
    const vendorId = await page.evaluate(async () =>
      (await dbAddVendor({ name: 'Flag Spot Test', category: 'other', description: '', websiteUrl: '', instagram: '' })).id);
    const spotId = await page.evaluate(async (id) => (await dbAddVendorSpot(id, 'f1', 'sketchy')).id, vendorId);

    await page.evaluate(({ spotId, vendorId }) => dbSubmitFlag('vendor_spot', spotId, 'fake spot', { vendor_id: vendorId }), { spotId, vendorId });
    const flag = await page.evaluate((sid) => window.__store.flags.find(f => f.target_type === 'vendor_spot' && f.target_id === String(sid)), spotId);
    expect(flag).toBeTruthy();

    await page.evaluate(({ spotId, vendorId }) => dbDeleteVendorSpot(spotId, vendorId, 'test'), { spotId, vendorId });
    const spot = await page.evaluate((sid) => window.__store.vendor_spots.find(s => s.id === sid), spotId);
    expect(spot.deleted_at).toBeTruthy();
  });
});

test.describe('Vendor Village · personal badges', () => {
  test('posting your first vendor awards Vendor Scout exactly once', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    await page.evaluate(async () => {
      await dbAddVendor({ name: 'Badge Test', category: 'other', description: '', websiteUrl: '', instagram: '' });
      await checkAndAwardVendorBadges();
      await checkAndAwardVendorBadges(); // idempotency: running again shouldn't duplicate
    });

    const badges = await page.evaluate(() => (window.__store.vendor_raver_badges || []).filter(b => b.badge_id === 'vendor_scout'));
    expect(badges.length).toBe(1);
  });

  test('Marketplace Explorer needs 5 distinct vendors spotted at one festival', async ({ page }) => {
    await bootAuthedApp(page);
    await openVendorVillage(page);
    for (let i = 0; i < 5; i++) {
      await page.evaluate(async (i) => {
        const v = await dbAddVendor({ name: `V${i}`, category: 'other', description: '', websiteUrl: '', instagram: '' });
        await dbAddVendorSpot(v.id, 'f1', null);
      }, i);
    }
    await page.evaluate(() => checkAndAwardVendorBadges());
    const badges = await page.evaluate(() => (window.__store.vendor_raver_badges || []).filter(b => b.badge_id === 'marketplace_explorer'));
    expect(badges.length).toBe(1);
  });
});

test.describe('Vendor Village · saved-vendor-spotted notification', () => {
  // The audience computation itself is a DB security-definer trigger
  // (notify_saved_vendor_spotted) — untestable against the offline stub,
  // same limitation noted for other Postgres-level RLS/trigger behavior in
  // this suite. This verifies the client-side rendering of whatever
  // notification the trigger would have inserted.
  test('a vendor_spotted notification renders a working "see vendor" action', async ({ page }) => {
    const data = seedData();
    data.vendors = [{ id: 'v-spotted', name: 'Soft Landings', category: 'safety_comfort', created_by: 'kai-uid', deleted_at: null, created_at: new Date().toISOString() }];
    data.notifications = [{
      id: 'n-spot', user_id: TEST_UID, crew_id: null, read: false, created_at: new Date().toISOString(),
      message: '📍 Soft Landings was just spotted at Tomorrowland — someone in the fam saw them!',
      type: 'vendor_spotted',
      data: { vendor_id: 'v-spotted', festival_id: 'f1', vendor_name: 'Soft Landings', festival_name: 'Tomorrowland' },
    }];
    await bootAuthedApp(page, { data });

    await page.evaluate(() => openNotifDrawer());
    const btn = page.locator('.notif-action-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Soft Landings');

    await btn.click();
    await expect(page.locator('#vendor-village-root')).toContainText('Browse');
    await expect(page.locator('#vv-detail-modal')).toContainText('Soft Landings');
  });
});
