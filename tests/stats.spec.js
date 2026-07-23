const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Dataset where "you" have actually attended one past festival, so stats are
// non-zero (stats only count raves that have already happened).
function statsData() {
  const d = seedData();
  d.festivals.push({ id: 'f-past', name: 'Past Fest', date: '2020-06-01', location: 'Detroit, US', color: '#39FF14', days: 2, deleted_at: null });
  d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-past' });
  return d;
}

test.describe('stats', () => {
  test('hero numbers reflect attended past raves', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });

    const heroNumbers = page.locator('#stats-content .stats-hero-number');
    await expect(heroNumbers.nth(0)).toHaveText('1');       // Raves Logged
    await expect(heroNumbers.nth(1)).toHaveText('2');       // Days Raved (days:2)
    await expect(heroNumbers.nth(3)).toHaveText('2020');    // Raving Since
  });

  test('empty stats shows the empty state when no past raves', async ({ page }) => {
    await bootAuthedApp(page); // seed has only future raves
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    const heroNumbers = page.locator('#stats-content .stats-hero-number');
    await expect(heroNumbers.nth(0)).toHaveText('0');       // 0 Raves Logged
  });

  test('switching to the Crew Stats subtab shows the crew panel', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('.stats-subtab');
      switchStatTab('crew', tabs[1]);
    });
    await expect(page.locator('#stats-crew-panel')).toBeVisible();
    await expect(page.locator('#stats-my-panel')).toBeHidden();
  });

  test('Raves on Your Radar shows the next upcoming RSVP (f1 is 2099-dated)', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    const radarCard = page.locator('#stats-content .stats-section-title', { hasText: 'Raves on Your Radar' });
    await expect(radarCard).toContainText('1 upcoming');
    await expect(page.locator('#stats-content .stats-personality-label')).toHaveText('Tomorrowland');
  });

  test('Raves on Your Radar shows a friendly empty state with no upcoming RSVPs', async ({ page }) => {
    const d = statsData();
    d.raver_festivals = d.raver_festivals.filter(rf => rf.festival_id !== 'f1'); // drop the only upcoming RSVP
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    await expect(page.locator('#stats-content .stats-empty-title', { hasText: 'Nothing on the radar yet' })).toBeVisible();
  });

  test('Artists Seen Live tile counts distinct artists this raver personally checked off, not just the lineup', async ({ page }) => {
    const d = statsData();
    // Charlotte de Witte (a1) and a second artist both appeared at f-past, which
    // r-you attended — but r-you only checked off a1 as personally seen, so the
    // stat should reflect that, not the full 2-artist lineup.
    d.artists.push({ id: 'a2', name: 'Amelie Lens', genres: ['techno'] });
    d.artist_festival_appearances = [
      { artist_id: 'a1', festival_id: 'f-past' },
      { artist_id: 'a2', festival_id: 'f-past' },
    ];
    d.raver_artist_sightings = [{ raver_id: 'r-you', artist_id: 'a1', festival_id: 'f-past' }];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });

    const heroNumbers = page.locator('#stats-content .stats-hero-number');
    await expect(heroNumbers.nth(4)).toHaveText('1'); // Artists Seen — only the checked-off one

    await page.evaluate(() => openArtistsSeenPage());
    await expect(page.locator('#page-artists-seen .rlog-item-name')).toHaveText('Charlotte de Witte');
    await expect(page.locator('#page-artists-seen')).toContainText('Distinct Artists');
  });

  test('Artists Seen Live shows a dedicated empty state with no lineup data', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() }); // no artist_festival_appearances seeded
    await page.evaluate(() => { switchTab('stats'); openArtistsSeenPage(); });
    await expect(page.locator('#page-artists-seen .stats-empty-title')).toHaveText('No lineup data yet');
  });

  test('Artists Seen Live stays empty when a lineup exists but nothing is checked off yet', async ({ page }) => {
    const d = statsData();
    d.artist_festival_appearances = [{ artist_id: 'a1', festival_id: 'f-past' }];
    // No raver_artist_sightings seeded — attending a rave with a lineup isn't
    // enough on its own; the raver has to have checked an artist off.
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); openArtistsSeenPage(); });
    await expect(page.locator('#page-artists-seen .stats-empty-title')).toHaveText('No lineup data yet');
  });

  test('Artists Seen Live: tapping an artist opens a modal to toggle seen/missed per rave', async ({ page }) => {
    const d = statsData();
    // Charlotte de Witte (a1) played two past raves r-you attended; already
    // checked off at f-past, still unmarked at f-past2 — the modal should
    // show both with independent toggles, not just a single aggregate action.
    d.festivals.push({ id: 'f-past2', name: 'Second Past Fest', date: '2021-06-01', location: 'Berlin, DE', color: '#00F5FF', days: 1, deleted_at: null });
    d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-past2' });
    d.artist_festival_appearances = [
      { artist_id: 'a1', festival_id: 'f-past' },
      { artist_id: 'a1', festival_id: 'f-past2' },
    ];
    d.raver_artist_sightings = [{ raver_id: 'r-you', artist_id: 'a1', festival_id: 'f-past' }];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); openArtistsSeenPage(); });

    await expect(page.locator('#page-artists-seen .rlog-item-name')).toHaveText('Charlotte de Witte');
    await page.locator('#page-artists-seen .rlog-item', { hasText: 'Charlotte de Witte' }).click();

    const modal = page.locator('#artist-sightings-modal');
    await expect(modal).toContainText('Past Fest');
    await expect(modal).toContainText('Second Past Fest');
    const rows = modal.locator('.rlog-item');
    await expect(rows).toHaveCount(2);
    const seenRow = modal.locator('.rlog-item', { hasText: 'Past Fest' }).filter({ hasNotText: 'Second' });
    const missedRow = modal.locator('.rlog-item', { hasText: 'Second Past Fest' });
    await expect(seenRow.locator('.lineup-seen-btn')).toHaveClass(/seen/);
    await expect(missedRow.locator('.lineup-seen-btn')).toHaveClass(/missed/);

    // Toggle the still-unmarked rave to seen — the modal row should flip, and
    // the aggregate count behind it should go from 1x to 2x once closed.
    await missedRow.locator('.lineup-seen-btn').click();
    await expect(missedRow.locator('.lineup-seen-btn')).toHaveClass(/seen/);

    await page.locator('#artist-sightings-modal .modal-actions button', { hasText: 'Close' }).click();
    await expect(page.locator('#artist-sightings-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#page-artists-seen .rlog-item', { hasText: 'Charlotte de Witte' })).toContainText('2x');
  });

  test('Distance Traveled tile prompts to set a location, then shows miles once one is set', async ({ page }) => {
    const d = statsData();
    d.festivals.find(f => f.id === 'f-past').lat = 42.3314;
    d.festivals.find(f => f.id === 'f-past').lng = -83.0458; // Detroit
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });

    const heroLabels = page.locator('#stats-content .stats-hero-label');
    await expect(heroLabels.nth(5)).toHaveText('Set Location');

    await page.evaluate(() => {
      saveUserGeo({ lat: 40.7128, lng: -74.0060, label: 'New York, NY', source: 'manual' });
      loadStatsPage();
    });
    await expect(page.locator('#stats-content .stats-hero-label').nth(5)).toHaveText('Miles Raved');
    await expect(page.locator('#stats-content .stats-hero-number').nth(5)).not.toHaveText('0');
  });

  test('Crew Stats surfaces a Most Vibes Left award for the member with the most reactions', async ({ page }) => {
    const d = statsData();
    d.raver_festivals.push({ raver_id: 'r-kai', festival_id: 'f-past' }); // Kai also attended
    d.festival_vibes = [
      { raver_id: 'r-you', festival_id: 'f-past', emoji: '🔥', caption: '' },
      { raver_id: 'r-kai', festival_id: 'f-past', emoji: '✨', caption: '' },
      { raver_id: 'r-kai', festival_id: 'f1', emoji: '💫', caption: '' },
    ];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => {
      switchTab('stats');
      loadStatsPage();
      const tabs = document.querySelectorAll('.stats-subtab');
      switchStatTab('crew', tabs[1]);
    });
    await expect(page.locator('#stats-crew-content')).toContainText('Most Vibes Left');
    await expect(page.locator('#stats-crew-content .stats-personality-label')).toContainText('Kai M.');
  });
});
