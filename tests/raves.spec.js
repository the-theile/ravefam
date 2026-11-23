const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

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

test.describe('rave lineup tagging', () => {
  function lineupData() {
    const d = seedData();
    d.festivals.push({ id: 'f-past', name: 'Past Fest', date: '2020-06-01', location: 'Detroit, US', color: '#39FF14', days: 2, deleted_at: null });
    d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-past' });
    return d;
  }

  test('attending raver can add an artist to a rave lineup and it persists', async ({ page }) => {
    await bootAuthedApp(page); // seedData: r-you is going to f1
    await page.evaluate(() => openRaveFocus('f1'));
    await page.evaluate(() => lineupArtistSearchInput('f1', 'Charlotte'));
    await page.waitForFunction(() => document.querySelectorAll('#lu-artist-search-results .fest-search-item').length > 0);
    await page.evaluate(() => lineupPickFromSearch('f1', 'a1'));
    await expect(page.locator('#lineup-section')).toContainText('Charlotte de Witte');
    const persisted = await page.evaluate(async () => {
      const { data } = await sb.from('artist_festival_appearances').select('artist_id,festival_id').eq('festival_id', 'f1');
      return data;
    });
    expect(persisted.some(r => String(r.artist_id) === 'a1')).toBe(true);
  });

  test('non-attending raver does not see the add-to-lineup control', async ({ page }) => {
    await bootAuthedApp(page); // seedData: r-you is only Interested in f2, not going
    await page.evaluate(() => openRaveFocus('f2'));
    await expect(page.locator('#lu-artist-search-input')).toHaveCount(0);
  });

  test('attending raver can remove an artist they tagged, and it persists', async ({ page }) => {
    const d = seedData();
    d.artist_festival_appearances = [{ artist_id: 'a1', festival_id: 'f1' }];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => openRaveFocus('f1'));
    await expect(page.locator('#lineup-section')).toContainText('Charlotte de Witte');
    await page.evaluate(() => lineupRemoveArtist('f1', 'a1'));
    await expect(page.locator('#lineup-section')).not.toContainText('Charlotte de Witte');
    const persisted = await page.evaluate(async () => {
      const { data } = await sb.from('artist_festival_appearances').select('artist_id').eq('festival_id', 'f1');
      return data;
    });
    expect(persisted.length).toBe(0);
  });

  test('personal "I saw this" toggle only appears once the rave is achieved, and persists when tapped', async ({ page }) => {
    const d = lineupData();
    d.artist_festival_appearances = [{ artist_id: 'a1', festival_id: 'f-past' }];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => openRaveFocus('f-past'));
    await expect(page.locator('.lineup-seen-btn')).toHaveCount(1);
    await page.evaluate(() => dbToggleArtistSighting('f-past', 'a1'));
    await expect(page.locator('.lineup-seen-btn.seen')).toHaveCount(1);
    const persisted = await page.evaluate(async () => {
      const { data } = await sb.from('raver_artist_sightings').select('*').eq('festival_id', 'f-past');
      return data;
    });
    expect(persisted.length).toBe(1);
  });

  test('seen-toggle does not appear for an upcoming rave even with a tagged lineup', async ({ page }) => {
    const d = seedData();
    d.artist_festival_appearances = [{ artist_id: 'a1', festival_id: 'f1' }]; // f1 is dated 2099
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => openRaveFocus('f1'));
    await expect(page.locator('#lineup-section')).toContainText('Charlotte de Witte');
    await expect(page.locator('.lineup-seen-btn')).toHaveCount(0);
  });

  test('planning-to-see toggle appears for an upcoming rave, persists, and is replaced by the seen/missed toggle once achieved', async ({ page }) => {
    const d = seedData();
    d.artist_festival_appearances = [{ artist_id: 'a1', festival_id: 'f1' }]; // f1 is dated 2099
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => openRaveFocus('f1'));
    await expect(page.locator('.lineup-plan-btn')).toHaveCount(1);
    await expect(page.locator('.lineup-seen-btn')).toHaveCount(0);
    await page.evaluate(() => dbToggleArtistPlan('f1', 'a1'));
    await expect(page.locator('.lineup-plan-btn.planned')).toHaveCount(1);
    const persisted = await page.evaluate(async () => {
      const { data } = await sb.from('raver_artist_plans').select('*').eq('festival_id', 'f1');
      return data;
    });
    expect(persisted.length).toBe(1);
  });

  test('planning-to-see toggle does not appear once the rave is achieved', async ({ page }) => {
    const d = lineupData();
    d.artist_festival_appearances = [{ artist_id: 'a1', festival_id: 'f-past' }];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => openRaveFocus('f-past'));
    await expect(page.locator('.lineup-plan-btn')).toHaveCount(0);
  });
});

// ===== Add Rave sheet (2.52.0) — search first, create only when nothing matches =====
// Pins a place in the create form the way a location-lookup pick does.
async function pinPlace(page, label = 'Ghent, Flanders, Belgium', lat = 51.0543, lng = 3.7174) {
  await page.evaluate(({ label, lat, lng }) => { _locItems = [{ label, lat, lng }]; pickLoc(0); }, { label, lat, lng });
}

async function startCreate(page, name, date, ctx = {}) {
  await page.evaluate((ctx) => openAddRaveSheet(ctx), ctx);
  await page.fill('#ar-q', name);
  await page.click('.ar-create');
  await page.fill('#fe-date', date);
}

const youList = (page, key = 'festIds') => page.evaluate((k) => squad.find(r => r.isYou)[k].map(String), key);
const festIdByName = (page, name) => page.evaluate((n) => String(festivals.find(f => f.name === n)?.id ?? ''), name);

test.describe('add rave sheet', () => {
  test('the Raves tab button and openRaveEditor() with no id open the sheet, not the wizard', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openRaveEditor(null));
    await expect(page.locator('#add-rave-overlay')).toHaveClass(/open/);
    await expect(page.locator('#rave-edit-overlay')).not.toHaveClass(/open/);
    await page.evaluate(() => closeAddRaveSheet());
    await page.evaluate(() => switchTab('events'));
    await page.locator('#page-events button', { hasText: '+ Add Rave' }).click();
    await expect(page.locator('#add-rave-overlay')).toHaveClass(/open/);
  });

  test('search lists catalog matches and one tap RSVPs you', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openAddRaveSheet({ source: 'raves' }));
    await page.fill('#ar-q', 'awaken');
    const match = page.locator('.ar-match', { hasText: 'Awakenings' });
    await expect(match).toBeVisible();
    await expect(page.locator('.ar-create')).toContainText('Create “awaken”');
    await match.locator('.ar-match-btn').click();
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    expect(await youList(page)).toContain('f2');
  });

  test('an empty search box lists upcoming raves not already on your list', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openAddRaveSheet());
    await expect(page.locator('#ar-results')).toContainText('Coming up');
    // f1 (Going) is left out; f2 (only Interested) is offered.
    await expect(page.locator('#ar-results .ar-match', { hasText: 'Awakenings' })).toHaveCount(1);
    await expect(page.locator('#ar-results .ar-match', { hasText: 'Tomorrowland' })).toHaveCount(0);
    await page.locator('#ar-results .ar-match', { hasText: 'Awakenings' }).locator('.ar-match-btn').click();
    expect(await youList(page)).toContain('f2');
  });

  test('the new rave card glows briefly on the Raves tab', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { setRaveView('card'); switchTab('events'); });
    await startCreate(page, 'Glow Rave', '2099-04-01');
    await pinPlace(page);
    await page.click('#ar-add');
    const id = await (async () => { await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/); return festIdByName(page, 'Glow Rave'); })();
    await expect(page.locator(`#events-list .event-item[data-fest-id="${id}"]`)).toHaveClass(/rave-just-added/);
  });

  test('a rave you already have shows as Going and cannot be re-added', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openAddRaveSheet());
    await page.fill('#ar-q', 'tomorrow');
    await expect(page.locator('.ar-match', { hasText: 'Tomorrowland' }).locator('.ar-match-btn')).toBeDisabled();
  });

  test('Add stays disabled until the place is pinned; typed text alone is not enough', async ({ page }) => {
    await bootAuthedApp(page);
    await startCreate(page, 'Fresh Rave', '2099-05-01');
    await page.fill('#fe-loc', 'Somewhere');
    await expect(page.locator('#ar-add')).toBeDisabled();
    await expect(page.locator('#ar-err')).toContainText('Pick a place');
    await pinPlace(page);
    await expect(page.locator('#ar-add')).toBeEnabled();
    await page.click('#ar-add');
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);

    const id = await festIdByName(page, 'Fresh Rave');
    expect(id).not.toBe('');
    const row = await page.evaluate((n) => (window.__store.festivals || []).find(f => f.name === n), 'Fresh Rave');
    expect(row.lat).toBeCloseTo(51.0543);
    expect(row.date).toBe('2099-05-01');
    // Default RSVP is Going — no follow-up popup any more.
    await expect(page.locator('#confirm-overlay')).not.toHaveClass(/open/);
    expect(await youList(page)).toContain(id);
  });

  test('Interested and Just adding RSVP accordingly', async ({ page }) => {
    await bootAuthedApp(page);
    await startCreate(page, 'Maybe Rave', '2099-06-01');
    await pinPlace(page);
    await page.locator('#ar-rsvp .ar-chip', { hasText: 'Interested' }).click();
    await page.click('#ar-add');
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    const maybe = await festIdByName(page, 'Maybe Rave');
    expect(await youList(page, 'interestedFestIds')).toContain(maybe);
    expect(await youList(page)).not.toContain(maybe);

    await startCreate(page, 'Skip Rave', '2099-07-01');
    await pinPlace(page);
    await page.locator('#ar-rsvp .ar-chip', { hasText: 'Just adding' }).click();
    await page.click('#ar-add');
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    const skip = await festIdByName(page, 'Skip Rave');
    expect(skip).not.toBe('');
    expect(await youList(page)).not.toContain(skip);
    expect(await youList(page, 'interestedFestIds')).not.toContain(skip);
  });

  test('a past date offers Was there instead of Going / Interested', async ({ page }) => {
    await bootAuthedApp(page);
    await startCreate(page, 'Old Rave', '2020-03-01');
    await expect(page.locator('#ar-rsvp')).toContainText('Was there');
    await expect(page.locator('#ar-rsvp')).not.toContainText('Interested');
  });

  test('a likely duplicate (similar name, ±1 day) asks first, and "Use this one" RSVPs to it', async ({ page }) => {
    await bootAuthedApp(page);
    const before = await page.evaluate(() => festivals.length);
    await startCreate(page, 'Awakenings Festival', '2099-10-13');
    await pinPlace(page, 'Amsterdam, North Holland, Netherlands', 52.37, 4.9);
    await page.click('#ar-add');
    await expect(page.locator('#add-rave-content')).toContainText('Is it this one?');
    await page.locator('#add-rave-content button', { hasText: 'Use this one' }).click();
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => festivals.length)).toBe(before);
    expect(await youList(page)).toContain('f2');
  });

  test('"It\'s different" creates the rave anyway', async ({ page }) => {
    await bootAuthedApp(page);
    await startCreate(page, 'Awakenings Festival', '2099-10-12');
    await pinPlace(page);
    await page.click('#ar-add');
    await page.locator('#add-rave-content button', { hasText: "It's different" }).click();
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    expect(await festIdByName(page, 'Awakenings Festival')).not.toBe('');
  });

  test('only crews picked in "Tell a crew?" get notified', async ({ page }) => {
    await bootAuthedApp(page);
    const kaiNotes = () => page.evaluate(() => (window.__store.notifications || []).filter(n => n.user_id === 'kai-uid').length);

    await startCreate(page, 'Quiet Rave', '2099-08-01');
    await pinPlace(page);
    await page.click('#ar-add');
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    await page.waitForTimeout(150);
    expect(await kaiNotes()).toBe(0);

    await startCreate(page, 'Loud Rave', '2099-08-02', { crewId: 'c1' });
    await pinPlace(page);
    await expect(page.locator('#ar-crews .ar-chip', { hasText: 'Bass Syndicate' })).toHaveAttribute('aria-pressed', 'true');
    await page.click('#ar-add');
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    await page.waitForTimeout(150);
    expect(await kaiNotes()).toBe(1);
  });

  test('from another raver\'s profile, the RSVP is for them', async ({ page }) => {
    await bootAuthedApp(page);
    await startCreate(page, 'Sam Rave', '2099-09-01', { raverId: 'r-sam', source: 'profile' });
    await expect(page.locator('#add-rave-content')).toContainText('Adding for');
    await expect(page.locator('#ar-crews')).toHaveCount(0);
    await pinPlace(page);
    await page.click('#ar-add');
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    const id = await festIdByName(page, 'Sam Rave');
    expect(await page.evaluate(() => getRaver('r-sam').festIds.map(String))).toContain(id);
    expect(await youList(page)).not.toContain(id);
  });

  test('pasting a ticket link fills the form from the page\'s event data', async ({ page }) => {
    await bootAuthedApp(page);
    const url = 'https://dice.fm/event/abc-basement-fabric-tickets';
    await page.evaluate((url) => {
      window.__invokes = [];
      sb.functions = { invoke: async (name, { body }) => {
        window.__invokes.push({ name, body });
        return { data: { url, site: 'DICE', title: 'Basement Tickets | 4 Dec | Fabric | DICE', description: null, image: null,
          event: { name: 'Basement', start: '2099-12-04', days: 1, venue: 'Fabric London', locality: 'London', country: 'GB', lat: 51.5196, lng: -0.1025 } }, error: null };
      } };
      openAddRaveSheet();
    }, url);
    await page.fill('#ar-q', url);
    await expect(page.locator('#fe-name')).toHaveValue('Basement');
    await expect(page.locator('#fe-date')).toHaveValue('2099-12-04');
    await expect(page.locator('#ar-link')).toHaveValue(url);
    await expect(page.locator('.ar-note')).toContainText('dice.fm');
    await expect(page.locator('#ar-add')).toBeEnabled();
    expect(await page.evaluate(() => window.__invokes[0].body.wantEvent)).toBe(true);
    await page.click('#ar-add');
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    const row = await page.evaluate(() => (window.__store.festivals || []).find(f => f.name === 'Basement'));
    expect(row.ticket_url).toBe(url);
    expect(row.days).toBe(1);
  });

  test('an RA link skips the lookup and keeps the URL as the ticket link', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { window.__invokes = []; sb.functions = { invoke: async (n, o) => { window.__invokes.push(o); return { data: null, error: null }; } }; openAddRaveSheet(); });
    await page.fill('#ar-q', 'https://ra.co/events/2087441');
    await expect(page.locator('.ar-note.warn')).toContainText("Couldn't read ra.co");
    await expect(page.locator('#ar-link')).toHaveValue('https://ra.co/events/2087441');
    expect(await page.evaluate(() => window.__invokes.length)).toBe(0);
  });

  test('a rave you added with no map pin shows a Fix bar to you only', async ({ page }) => {
    const d = seedData();
    d.festivals = d.festivals.map(f => f.id === 'f1' ? { ...f, created_by: TEST_UID } : f.id === 'f2' ? { ...f, created_by: 'someone-else' } : f);
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { _raveFilters.time = 'upcoming'; setRaveView('card'); switchTab('events'); renderEvents(); });
    await expect(page.locator('.event-item[data-fest-id="f1"] .rave-fix-bar')).toContainText('Not on the map yet');
    await expect(page.locator('.event-item[data-fest-id="f2"] .rave-fix-bar')).toHaveCount(0);
    await page.locator('.event-item[data-fest-id="f1"] .rave-fix-bar').click();
    await expect(page.locator('#rave-edit-overlay')).toHaveClass(/open/);
    await expect(page.locator('#rave-edit-modal .rw-panel[data-rw-panel="place"]')).toBeVisible();
  });

  test('editing an existing rave still uses the wizard and saves', async ({ page }) => {
    const d = seedData();
    d.festivals = d.festivals.map(f => f.id === 'f1' ? { ...f, created_by: TEST_UID } : f);
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => openRaveEditor('f1'));
    await page.fill('#fe-name', 'Tomorrowland Updated');
    await page.evaluate(() => saveRave());
    await expect(page.locator('#add-rave-overlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => getFestival('f1').name)).toBe('Tomorrowland Updated');
  });
});

test.describe('nearby raves filter', () => {
  // The app's service worker intercepts cross-origin fetches (sw.js only passes
  // "cdn."/"fonts."/"supabase.co" straight to network) and issues them from its
  // own execution context, which page.route() can't see — block registration so
  // the Nominatim mocks below actually apply.
  test.use({ serviceWorkers: 'block' });

  test('narrows to raves within the chosen radius', async ({ page }) => {
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

  test('keeps date order (soonest first) when Nearby is active, not distance order', async ({ page }) => {
    // Antwerp is ~14mi from Boom (sooner date, farther away); Boom itself is 0mi
    // from the user (later date, closest). A distance sort would show them in
    // the wrong order — date should win.
    const ANTWERP_BE = { lat: 51.2194, lng: 4.4025 };
    const data = seedData();
    data.festivals = [
      { id: 'f1', name: 'Tomorrowland', date: '2099-07-18', location: 'Antwerp, BE', color: '#FF2D78', days: null, deleted_at: null, ...ANTWERP_BE },
      { id: 'f2', name: 'Awakenings', date: '2099-10-12', location: 'Boom, BE', color: '#00F5FF', days: null, deleted_at: null, ...BOOM_BE },
    ];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => switchTab('events'));
    await page.evaluate((loc) => {
      saveUserGeo({ ...loc, label: 'Boom, BE', source: 'manual' });
      _raveFilters.distance = 25;
      renderEvents();
    }, BOOM_BE);
    const names = await page.locator('#events-list .marquee-name').allTextContents();
    const tIdx = names.findIndex(n => n.includes('Tomorrowland'));
    const aIdx = names.findIndex(n => n.includes('Awakenings'));
    expect(tIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(tIdx).toBeLessThan(aIdx);
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
