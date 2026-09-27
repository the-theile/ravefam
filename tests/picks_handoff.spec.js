// Lineup Explorer → /app handoff: browser ☆ picks (rf_picks) become RSVPs
// + raver_artist_plans after login. See processPendingPicks() in app.html.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

function data() {
  const d = seedData();
  d.festivals[0].slug = 'tomorrowland-2099';           // r-you is Going (seed)
  d.festivals.push({ id: 'f3', name: 'EDC Orlando 2099', date: '2099-11-06', location: 'Orlando, FL', slug: 'edc-orlando-2099', deleted_at: null });
  d.festivals.push({ id: 'f4', name: 'Old Rave', date: '2001-01-01', location: 'Nowhere', slug: 'old-rave-2001', deleted_at: null });
  d.artists.push(
    { id: 'a2', name: 'Kaskade', name_lower: 'kaskade', genres: [] },
    { id: 'a3', name: 'Benda', name_lower: 'benda', genres: [] },
    { id: 'a4', name: 'Vastive', name_lower: 'vastive', genres: [] },
    { id: 'a5', name: 'Adam Beyer', name_lower: 'adam beyer', genres: [] },
  );
  d.raver_artist_plans = [];
  return d;
}

async function seedPicks(page, picks, pending = 'edc-orlando-2099') {
  await page.addInitScript(([p, pend]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('rf_picks', JSON.stringify(p));
    localStorage.setItem('pendingPicksHandoff', pend);
    localStorage.setItem('rf_picks_from', JSON.stringify({ slug: pend, back: '/lineup-explorer/' + pend + '.html' }));
  }, [picks, pending]);
}

const PICKS = {
  'edc-orlando-2099': { n: ['Kaskade', 'Benda b2b Vastive', 'Not In Catalog'] },
  'tomorrowland-2099': { n: ['Adam Beyer'] },
  'old-rave-2001': { n: ['Kaskade'] },
};

test('saves picks per upcoming rave, starting the one they came from as Interested', async ({ page }) => {
  await seedPicks(page, PICKS);
  const errors = await bootAuthedApp(page, { data: data() });
  const sheet = page.locator('#picks-handoff-overlay.open');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('#picks-handoff-title')).toHaveText('Welcome to the fam 🎉');

  const cards = sheet.locator('.ph-card');
  await expect(cards).toHaveCount(2); // the past rave is left out
  // Sorted by date: Tomorrowland (Jul) then EDC (Nov).
  await expect(cards.nth(0).locator('.ph-fest')).toHaveText('Tomorrowland');
  await expect(cards.nth(0).locator('.ph-going')).toHaveAttribute('aria-pressed', 'true');   // already Going
  await expect(cards.nth(1).locator('.ph-interested')).toHaveAttribute('aria-pressed', 'true'); // came from here
  await expect(sheet.locator('#ph-save')).toHaveText('Save 4 picks');

  await sheet.locator('#ph-save').click();
  await expect(sheet.locator('#picks-handoff-title')).toHaveText('Who are you rolling with to EDC Orlando 2099? 🎟️');

  const s = await page.evaluate(() => window.__store);
  expect(s.raver_festival_interest.some(r => r.raver_id === 'r-you' && r.festival_id === 'f3')).toBe(true);
  expect(s.raver_festivals.some(r => r.raver_id === 'r-you' && r.festival_id === 'f3')).toBe(false);
  const plans = s.raver_artist_plans.map(p => p.festival_id + ':' + p.artist_id).sort();
  expect(plans).toEqual(['f1:a5', 'f3:a2', 'f3:a3', 'f3:a4']);

  // Saved picks leave the browser; an act with no catalog artist stays.
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem('rf_picks')));
  expect(left['edc-orlando-2099'].n).toEqual(['Not In Catalog']);
  expect(left['tomorrowland-2099']).toBeUndefined();
  expect(left['old-rave-2001']).toBeDefined();
  expect(await page.evaluate(() => localStorage.getItem('pendingPicksHandoff'))).toBeNull();

  await sheet.getByRole('button', { name: 'Solo for now' }).click();
  await expect(sheet.locator('#picks-handoff-title')).toHaveText("You're locked in ✨");
  await expect(sheet.getByRole('link', { name: /Back to the lineup/ })).toHaveAttribute('href', '/lineup-explorer/edc-orlando-2099.html');
  expect(errors).toEqual([]);
});

test('Later keeps picks in the browser and does not ask again', async ({ page }) => {
  await seedPicks(page, PICKS);
  await bootAuthedApp(page, { data: data() });
  const sheet = page.locator('#picks-handoff-overlay.open');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => window.__store.raver_artist_plans.length)).toBe(0);
  expect(Object.keys(await page.evaluate(() => JSON.parse(localStorage.getItem('rf_picks'))))).toHaveLength(3);
  await page.reload();
  await page.locator('#main-app').waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
  await expect(page.locator('#picks-handoff-overlay.open')).toHaveCount(0);
});

test('choosing Not now on every rave disables Save', async ({ page }) => {
  await seedPicks(page, { 'edc-orlando-2099': { n: ['Kaskade'] } });
  await bootAuthedApp(page, { data: data() });
  const sheet = page.locator('#picks-handoff-overlay.open');
  await sheet.locator('.ph-card .ph-none').click();
  await expect(sheet.locator('#ph-save')).toBeDisabled();
  await expect(sheet.locator('#ph-save')).toHaveText('Save 0 picks');
});

test('?picks=1&from= sets the pending handoff and is stripped from the URL', async ({ page }) => {
  await bootAuthedApp(page, { data: data() });
  await page.goto('/app.html?picks=1&from=edc-orlando-2099');
  expect(new URL(page.url()).search).toBe('');
  // No browser picks, so nothing to show — but the flag was consumed.
  await page.locator('#main-app').waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
  await expect(page.locator('#picks-handoff-overlay.open')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pendingPicksHandoff'))).toBeNull();
});
