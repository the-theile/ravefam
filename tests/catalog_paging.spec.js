// The artist catalog tables are past Supabase's 1000-row response cap
// (max_rows), which truncates silently. The app must page through them.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

test('artist catalog loads every row past the 1000-row cap', async ({ page }) => {
  const artists = Array.from({ length: 1016 }, (_, i) => ({ id: i + 1, name: 'Artist ' + String(i + 1).padStart(4, '0'), genres: [] }));
  const appearances = Array.from({ length: 1523 }, (_, i) => ({ id: i + 1, artist_id: (i % 1016) + 1, festival_id: 'f-seed', is_headliner: false, night: null, note: null }));
  await bootAuthedApp(page, { data: { ...seedData(), artists, artist_festival_appearances: appearances } });
  await expect.poll(() => page.evaluate(() => artists.length)).toBe(1016);
  await expect.poll(() => page.evaluate(() => artistAppearances.length)).toBe(1523);
  expect(await page.evaluate(() => artists[artists.length - 1].name)).toBe('Artist 1016');
});
