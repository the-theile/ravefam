const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Venue Directory: a sibling of Vendor Village inside the Village nav tab —
// venues, festivals.venue_id, and venue_reviews. See dbAddVenue/dbLoadVenues/
// dbDeleteVenue/dbUpsertVenueReview/renderVenueVillage in app.html.

function seedWithMod() {
  const data = seedData();
  data.moderators = [{ user_id: TEST_UID, added_at: '2024-01-01T00:00:00Z', added_by: null }];
  return data;
}

// The venue picker lives alongside the other creator/mod-gated rave fields
// (name/date/location/days) — seedData's f1 has no created_by, so festivalPerms
// would deny editing; these tests need r-you to actually own the rave.
function seedWithOwnedFest() {
  const data = seedData();
  data.festivals = data.festivals.map(f => f.id === 'f1' ? { ...f, created_by: TEST_UID } : f);
  return data;
}

async function openVenueVillage(page) {
  await page.evaluate(() => switchTab('checklist'));
  await page.evaluate(() => {
    switchVillageSection('venues', document.querySelectorAll('#village-section-tabs .stats-subtab')[1]);
  });
  await page.evaluate(async () => { await loadVenueVillageData(); });
  await expect(page.locator('#venue-village-root')).toContainText('Browse');
}

test.describe('Venue Directory · browse', () => {
  test('adding a venue shows it in Browse and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await openVenueVillage(page);

    await page.evaluate(async () => {
      await dbAddVenue({ name: 'The Warehouse Project', location: 'Manchester, UK', description: 'Massive sound system' });
      renderVenueBrowsePanel();
    });

    await expect(page.locator('#vn-browse-panel')).toContainText('The Warehouse Project');
    const stored = await page.evaluate(() => (window.__store.venues || []).some(v => v.name === 'The Warehouse Project'));
    expect(stored).toBe(true);
  });

  test('venue search filters the browse list', async ({ page }) => {
    await bootAuthedApp(page);
    await openVenueVillage(page);
    await page.evaluate(async () => {
      await dbAddVenue({ name: 'Fabric', location: 'London, UK' });
      await dbAddVenue({ name: 'Berghain', location: 'Berlin, DE' });
      renderVenueBrowsePanel();
    });
    await page.evaluate(() => onVenueSearchInput('Berlin'));
    const panel = page.locator('#vn-browse-list');
    await expect(panel).toContainText('Berghain');
    await expect(panel).not.toContainText('Fabric');
  });
});

test.describe('Venue Directory · reviews', () => {
  test('posting then editing a review updates one row, not two', async ({ page }) => {
    await bootAuthedApp(page);
    await openVenueVillage(page);
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'Glow Club', location: '' })).id);

    await page.evaluate((id) => dbUpsertVenueReview(id, { rating: 4, body: 'great sound' }), venueId);
    await page.evaluate((id) => dbUpsertVenueReview(id, { rating: 5, body: 'even better than I thought' }), venueId);

    const reviews = await page.evaluate((id) => (window.__store.venue_reviews || []).filter(r => r.venue_id === id), venueId);
    expect(reviews.length).toBe(1);
    expect(reviews[0].rating).toBe(5);
    expect(reviews[0].body).toBe('even better than I thought');
  });

  test('reviews are open to any raver, not gated on attendance', async ({ page }) => {
    await bootAuthedApp(page); // r-you has not attended any rave at this venue
    await openVenueVillage(page);
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'Open Review Venue', location: '' })).id);
    const ok = await page.evaluate((id) => dbUpsertVenueReview(id, { rating: 3, body: 'never been, heard good things' }), venueId);
    expect(ok).toBe(true);
  });
});

test.describe('Venue Directory · moderation', () => {
  test('deleting a venue soft-deletes it and restore brings it back', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await openVenueVillage(page);
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'Sketchy Spot', location: '' })).id);

    await page.evaluate((id) => dbDeleteVenue(id, 'reported as unsafe'), venueId);
    let venue = await page.evaluate((id) => window.__store.venues.find(v => v.id === id), venueId);
    expect(venue.deleted_at).toBeTruthy();

    await page.evaluate(async (id) => {
      const row = window.__store.audit_logs.find(a => a.action === 'venue.remove' && a.entity_id === id);
      await restoreFromAuditRow(row);
    }, venueId);
    venue = await page.evaluate((id) => window.__store.venues.find(v => v.id === id), venueId);
    expect(venue.deleted_at).toBeFalsy();
  });

  test('reporting a venue opens a flag visible to the mod dashboard', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithMod() });
    await openVenueVillage(page);
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'Questionable Venue', location: '' })).id);

    await page.evaluate((id) => dbSubmitFlag('venue', id, 'unsafe conditions', {}), venueId);
    const flag = await page.evaluate((id) => window.__store.flags.find(f => f.target_type === 'venue' && f.target_id === String(id)), venueId);
    expect(flag).toBeTruthy();
    expect(flag.status).toBe('open');

    const flags = await page.evaluate(() => dbLoadFlags());
    expect(flags.some(f => f.target_type === 'venue')).toBe(true);
  });
});

test.describe('Venue Directory · crew cosigns', () => {
  test('a review from someone in your crew shows a cosign chip', async ({ page }) => {
    await bootAuthedApp(page);
    await openVenueVillage(page);
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'Crew Fave Venue', location: '' })).id);

    // r-kai (claimed_by 'kai-uid') is in crew c1 along with r-you (the booted
    // user) — a review keyed on kai-uid should resolve as a crew cosign.
    await page.evaluate(async (id) => {
      (window.__store.venue_reviews ||= []).push({
        id: 'venue-review-kai', venue_id: id, raver_id: 'kai-uid', rating: 5,
        body: 'love it', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      await dbLoadVenueReviews([id]);
      openVenueDetail(id);
    }, venueId);

    await expect(page.locator('#vn-detail-modal')).toContainText('Bass Syndicate');
  });
});

test.describe('Venue Directory · rave linking', () => {
  test('picking a venue in the rave editor saves festivals.venue_id and shows the rave under "Raves Held Here"', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithOwnedFest() });
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'Linked Venue', location: '' })).id);

    await page.evaluate(() => openRaveEditor('f1'));
    await page.evaluate((id) => pickFestVenue(id), venueId);
    await expect(page.locator('#fe-venue-picker')).toContainText('Linked Venue');
    await page.evaluate(() => saveRave());

    const persisted = await page.evaluate(() => window.__store.festivals.find(f => f.id === 'f1').venue_id);
    expect(persisted).toBe(venueId);

    await openVenueVillage(page);
    await page.evaluate((id) => openVenueDetail(id), venueId);
    await expect(page.locator('#vn-detail-modal')).toContainText('Tomorrowland');
  });

  test('a linked venue shows on its own line under location on the full card', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithOwnedFest() });
    await page.evaluate(async () => {
      const v = await dbAddVenue({ name: 'Card View Venue', location: '' });
      openRaveEditor('f1');
      pickFestVenue(v.id);
      saveRave();
      closeRaveEditor();
      switchTab('events');
      renderEvents();
    });
    const venueLine = page.locator('.marquee-venue-line').first();
    await expect(venueLine).toContainText('Card View Venue');
    // The location/date line (the first .marquee-meta) shouldn't also carry the venue name.
    const locationLine = await page.locator('.marquee-meta').first().textContent();
    expect(locationLine).not.toContain('Card View Venue');
  });

  test('a linked venue leads the compact list row, before location', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithOwnedFest() });
    await page.evaluate(async () => {
      const v = await dbAddVenue({ name: 'Order Test Venue', location: '' });
      openRaveEditor('f1');
      pickFestVenue(v.id);
      saveRave();
      closeRaveEditor();
      switchTab('events');
      setRaveView('list');
      renderEvents();
    });
    const subLine = await page.locator('.rave-row-sub').first().textContent();
    expect(subLine).toContain('Order Test Venue');
    expect(subLine).toContain('Boom, BE'); // f1's seeded location
    expect(subLine.indexOf('Order Test Venue')).toBeLessThan(subLine.indexOf('Boom, BE'));
  });

  test('adding a new venue inline from the rave editor search creates it and links it', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithOwnedFest() });
    await page.evaluate(() => openRaveEditor('f1'));
    await page.evaluate(async () => { await addNewVenueFromSearch('Brand New Venue'); });
    await expect(page.locator('#fe-venue-picker')).toContainText('Brand New Venue');
    await page.evaluate(() => saveRave());

    const venue = await page.evaluate(() => (window.__store.venues || []).find(v => v.name === 'Brand New Venue'));
    expect(venue).toBeTruthy();
    const persisted = await page.evaluate(() => window.__store.festivals.find(f => f.id === 'f1').venue_id);
    expect(persisted).toBe(venue.id);
  });

  test('clearing the venue on an existing rave un-links it', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithOwnedFest() });
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'To Be Removed', location: '' })).id);
    await page.evaluate(() => openRaveEditor('f1'));
    await page.evaluate((id) => { pickFestVenue(id); saveRave(); }, venueId);
    let persisted = await page.evaluate(() => window.__store.festivals.find(f => f.id === 'f1').venue_id);
    expect(persisted).toBe(venueId);

    await page.evaluate(() => openRaveEditor('f1'));
    await page.evaluate(() => clearFestVenue());
    await page.evaluate(() => saveRave());
    persisted = await page.evaluate(() => window.__store.festivals.find(f => f.id === 'f1').venue_id);
    expect(persisted).toBeFalsy();
  });
});

test.describe('Venue Directory · location auto-fill', () => {
  test('picking a venue with a saved location auto-fills an empty Location field', async ({ page }) => {
    await bootAuthedApp(page);
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'Auto Fill Venue', location: 'Miami, Florida, United States' })).id);
    await page.evaluate(() => openRaveEditor(null)); // new rave — Location starts empty
    await page.evaluate((id) => pickFestVenue(id), venueId);
    expect(await page.locator('#fe-loc').inputValue()).toBe('Miami, Florida, United States');
  });

  test('picking a venue does not overwrite an already-typed Location', async ({ page }) => {
    await bootAuthedApp(page);
    const venueId = await page.evaluate(async () => (await dbAddVenue({ name: 'No Overwrite Venue', location: 'Miami, Florida, United States' })).id);
    await page.evaluate(() => openRaveEditor(null));
    await page.fill('#fe-loc', 'Custom Typed Location');
    await page.evaluate((id) => pickFestVenue(id), venueId);
    expect(await page.locator('#fe-loc').inputValue()).toBe('Custom Typed Location');
  });

  test('adding a new venue inline also auto-fills an empty Location', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openRaveEditor(null));
    await page.evaluate(async () => {
      const v = await dbAddVenue({ name: 'Inline Fill Venue', location: 'Denver, Colorado, United States' });
      // Simulate the inline "+ Add new venue" flow picking up the freshly
      // created venue's location, same as addNewVenueFromSearch would.
      pickFestVenue(v.id);
    });
    expect(await page.locator('#fe-loc').inputValue()).toBe('Denver, Colorado, United States');
  });
});
