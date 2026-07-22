const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// Boom, BE and Amsterdam, NL — real coordinates, ~145km (~90mi) apart, so a
// 25mi radius keeps one and drops the other without relying on network geocoding.
const BOOM_BE = { lat: 51.0925, lng: 4.5354 };
const AMSTERDAM_NL = { lat: 52.3676, lng: 4.9041 };

function seedWithFestivalCoords() {
  const data = seedData();
  data.festivals = data.festivals.map(f =>
    f.id === 'f1' ? { ...f, ...BOOM_BE } : f.id === 'f2' ? { ...f, ...AMSTERDAM_NL } : f);
  return data;
}

async function refetch(page, expr) {
  return page.evaluate(async (src) => { await loadAllData(); return eval(src); }, expr);
}

test.describe('raves / events', () => {
  test('toggleGoingToFest adds the rave and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => toggleGoingToFest('f2'));
    // local state updated immediately
    expect(await page.evaluate(() => squad.find(r => r.isYou).festIds.map(String))).toContain('f2');
    // and it round-trips through the fake DB
    const going = await refetch(page, "squad.find(r=>r.isYou).festIds.map(String)");
    expect(going).toContain('f2');
  });

  test('toggleInterestedInFest persists interest', async ({ page }) => {
    await bootAuthedApp(page);
    // f1 starts as Going; mark interest in f1 should move it to interested.
    await page.evaluate(() => toggleInterestedInFest('f1'));
    const interested = await refetch(page, "squad.find(r=>r.isYou).interestedFestIds.map(String)");
    expect(interested).toContain('f1');
  });

  test('Going filter shows only raves you are going to', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    await page.evaluate(() => toggleRaveFilter('status', 'going'));
    const list = page.locator('#events-list');
    await expect(list).toContainText('Tomorrowland');   // f1 = going
    await expect(list).not.toContainText('Awakenings');  // f2 = interested only
  });

  test('Interested filter shows only raves you are interested in', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    await page.evaluate(() => toggleRaveFilter('status', 'interested'));
    const list = page.locator('#events-list');
    await expect(list).toContainText('Awakenings');
    await expect(list).not.toContainText('Tomorrowland');
  });

  test('rave search filters the list', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    await page.fill('#rave-search', 'Awak');
    await page.evaluate(() => renderEvents());
    const list = page.locator('#events-list');
    await expect(list).toContainText('Awakenings');
    await expect(list).not.toContainText('Tomorrowland');
  });
});

test.describe('nearby raves filter', () => {
  // The app's service worker intercepts cross-origin fetches (sw.js only passes
  // "cdn."/"fonts."/"supabase.co" straight to network) and issues them from its
  // own execution context, which page.route() can't see — block registration so
  // the Nominatim mocks below actually apply.
  test.use({ serviceWorkers: 'block' });

  test('narrows to raves within the chosen radius and sorts nearest first', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithFestivalCoords() });
    await page.evaluate(() => switchTab('events'));
    await page.evaluate((loc) => {
      saveUserGeo({ ...loc, label: 'Boom, BE', source: 'manual' });
      _raveFilters.distance = 25;
      renderEvents();
    }, BOOM_BE);
    const list = page.locator('#events-list');
    await expect(list).toContainText('Tomorrowland');
    await expect(list).not.toContainText('Awakenings');
  });

  test('shows distance on the rave card', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithFestivalCoords() });
    await page.evaluate(() => switchTab('events'));
    await page.evaluate((loc) => {
      saveUserGeo({ ...loc, label: 'Boom, BE', source: 'manual' });
      _raveFilters.distance = 250;
      renderEvents();
    }, BOOM_BE);
    const list = page.locator('#events-list');
    await expect(list).toContainText('0 mi away');
    await expect(list).toContainText('mi away'); // Amsterdam entry too, within 250mi
  });

  test('geocodes festivals missing stored coordinates via the Nominatim fallback', async ({ page }) => {
    await bootAuthedApp(page); // default seed: f1/f2 have no lat/lng
    await page.route('**/nominatim.openstreetmap.org/**', route => {
      const url = route.request().url();
      const hit = url.includes('Boom') ? BOOM_BE : url.includes('Amsterdam') ? AMSTERDAM_NL : null;
      route.fulfill({
        contentType: 'application/json',
        body: hit ? JSON.stringify([{ lat: String(hit.lat), lon: String(hit.lng) }]) : '[]',
      });
    });
    await page.evaluate(() => switchTab('events'));
    await page.evaluate((loc) => {
      saveUserGeo({ ...loc, label: 'Boom, BE', source: 'manual' });
      _raveFilters.distance = 25;
      renderEvents();
    }, BOOM_BE);
    const list = page.locator('#events-list');
    await expect(list).toContainText('Tomorrowland', { timeout: 10000 });
    await expect(list).not.toContainText('Awakenings');
  });

  test('turning on Nearby defaults the time axis to Upcoming when none is set', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithFestivalCoords() });
    await page.evaluate(() => switchTab('events'));
    await page.evaluate((loc) => {
      saveUserGeo({ ...loc, label: 'Boom, BE', source: 'manual' });
      toggleNearbyFilter();
    }, BOOM_BE);
    expect(await page.evaluate(() => _raveFilters.time)).toBe('upcoming');
    expect(await page.evaluate(() => _raveFilters.distance)).toBe(50);
  });

  test('turning on Nearby leaves an already-chosen time filter alone', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithFestivalCoords() });
    await page.evaluate(() => switchTab('events'));
    await page.evaluate((loc) => {
      saveUserGeo({ ...loc, label: 'Boom, BE', source: 'manual' });
      toggleRaveFilter('time', 'past'); // explicit choice, made before Nearby is turned on
      toggleNearbyFilter();
    }, BOOM_BE);
    expect(await page.evaluate(() => _raveFilters.time)).toBe('past');
  });

  test('geolocation denial falls back to the manual location modal', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = (_success, error) => error({ code: 1, message: 'denied' });
      toggleNearbyFilter();
    });
    await expect(page.locator('#nearby-loc-overlay')).toHaveClass(/open/);
  });

  test('picking a city in the manual modal sets the filter and closes it', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithFestivalCoords() });
    await page.route('**/nominatim.openstreetmap.org/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ lat: String(BOOM_BE.lat), lon: String(BOOM_BE.lng), address: { city: 'Boom' }, display_name: 'Boom, Belgium' }]),
    }));
    await page.evaluate(() => switchTab('events'));
    await page.evaluate(() => openNearbyLocModal());
    await page.fill('#nearby-loc-input', 'Boom');
    await page.waitForFunction(() => document.querySelectorAll('#nearby-loc-dropdown .loc-item').length > 0);
    await page.evaluate(() => pickUserLoc(0));
    await expect(page.locator('#nearby-loc-overlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => _raveFilters.distance)).toBeTruthy();
    const list = page.locator('#events-list');
    await expect(list).toContainText('Tomorrowland');
    await expect(list).not.toContainText('Awakenings');
  });
});
