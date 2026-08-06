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

  test('Vibe DNA share card opens with your genres, vibes and personality', async ({ page }) => {
    const d = statsData();
    // Vibe DNA only unlocks at 3+ logged raves.
    d.festivals.push({ id: 'f-past2', name: 'Second Past Fest', date: '2021-06-01', location: 'Berlin, DE', color: '#00F5FF', days: 1, deleted_at: null });
    d.festivals.push({ id: 'f-past3', name: 'Third Past Fest', date: '2019-06-01', location: 'Berlin, DE', color: '#00F5FF', days: 1, deleted_at: null });
    d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-past2' }, { raver_id: 'r-you', festival_id: 'f-past3' });
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });

    const vibeDnaCard = page.locator('#stats-content .stats-section-card', { has: page.locator('.stats-section-title', { hasText: 'Vibe DNA' }) });
    await vibeDnaCard.locator('button', { hasText: 'Share' }).click();

    await expect(page.locator('#vibedna-share-overlay')).toHaveClass(/open/);
    await expect(page.locator('#vibedna-share-card .radar-share-name')).toHaveText('Theile');
    await expect(page.locator('#vibedna-share-card')).toContainText('Techno');
    await expect(page.locator('#vibedna-share-card')).toContainText('House');
    await page.evaluate(() => closeVibeDnaShareCard());
    await expect(page.locator('#vibedna-share-overlay')).not.toHaveClass(/open/);
  });

  test('Rave Passport: tapping a filled stamp opens that rave, tapping an empty slot starts logging one', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });

    await page.locator('#stats-content .stats-stamp', { hasText: 'Past Fest' }).click();
    await expect(page.locator('#rave-focus-overlay')).toHaveClass(/open/);
    await expect(page.locator('#rave-focus-modal')).toContainText('Past Fest');
    await page.evaluate(() => closeRaveFocus());

    await page.locator('#stats-content .stats-stamp.empty').first().click();
    await expect(page.locator('#new-rave-popup-overlay')).toHaveClass(/open/);
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

  test('Crew Stats shows your ticket mix next to the crew aggregate', async ({ page }) => {
    const d = statsData();
    // r-you already RSVP'd to f-past via statsData() — give that RSVP a ticket
    // type, and add Kai's own RSVP+ticket so the crew aggregate has 2 tickets total.
    d.raver_festivals.find(rf => rf.raver_id === 'r-you' && rf.festival_id === 'f-past').ticket_type = 'vip';
    d.raver_festivals.push({ raver_id: 'r-kai', festival_id: 'f-past', ticket_type: 'ga' });
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => {
      switchTab('stats');
      loadStatsPage();
      const tabs = document.querySelectorAll('.stats-subtab');
      switchStatTab('crew', tabs[1]);
    });

    const card = page.locator('#stats-crew-content .stats-section-card', { has: page.locator('.stats-section-title', { hasText: 'Ticket Mix vs. Crew' }) });
    await expect(card).toContainText('VIP · 100%'); // your mix: 1 vip / 1 total
    await expect(card).toContainText('GA · 50%');    // crew aggregate: 1 vip + 1 ga = 50/50
    await expect(card).toContainText('Bass Syndicate'); // selectedCrew.name label
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

  test('Raves on Your Radar hides the share quick action when there are no upcoming RSVPs', async ({ page }) => {
    const d = statsData();
    d.raver_festivals = d.raver_festivals.filter(rf => rf.festival_id !== 'f1');
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    const radarCard = page.locator('#stats-content .stats-section-title', { hasText: 'Raves on Your Radar' });
    await expect(radarCard.locator('button', { hasText: 'Share' })).toHaveCount(0);
  });

  test('Radar share card lists every upcoming RSVP and opens from both entry points', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });

    // Quick action from the Stats home hero section
    const homeShareBtn = page.locator('#stats-content .stats-section-title', { hasText: 'Raves on Your Radar' }).locator('button', { hasText: 'Share' });
    await homeShareBtn.click();
    await expect(page.locator('#radar-share-overlay')).toHaveClass(/open/);
    await expect(page.locator('#radar-share-card .radar-share-row')).toHaveCount(1);
    await expect(page.locator('#radar-share-card .radar-share-row-name')).toHaveText('Tomorrowland');
    await expect(page.locator('#radar-share-card .radar-share-name')).toHaveText('Theile');
    await page.evaluate(() => closeRadarShareCard());
    await expect(page.locator('#radar-share-overlay')).not.toHaveClass(/open/);

    // Same share card from the dedicated Raves on Your Radar page
    await page.evaluate(() => openRavesRadarPage());
    const pageShareBtn = page.locator('#page-raves-radar .section-header button', { hasText: 'Share' });
    await pageShareBtn.click();
    await expect(page.locator('#radar-share-overlay')).toHaveClass(/open/);
  });

  test('Radar share card lets you leave raves off it and put them back', async ({ page }) => {
    const d = statsData();
    d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f2' }); // second upcoming rave: Awakenings
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });
    await page.evaluate(() => openRadarShareCard());

    const card = page.locator('#radar-share-card');
    await expect(card.locator('.radar-share-row')).toHaveCount(2);
    await expect(card.locator('.radar-share-count')).toHaveText('2 raves coming up');

    // Drop Tomorrowland — the card narrows to Awakenings and offers it back
    await card.locator('.radar-share-row', { hasText: 'Tomorrowland' }).locator('.radar-share-remove').click();
    await expect(card.locator('.radar-share-row-name')).toHaveText('Awakenings');
    await expect(card.locator('.radar-share-count')).toHaveText('1 rave coming up');
    await expect(card.locator('.radar-share-hidden-chip')).toHaveText('+ Tomorrowland');

    // The last remaining rave can't be dropped
    await card.locator('.radar-share-row .radar-share-remove').click();
    await expect(card.locator('.radar-share-row')).toHaveCount(1);

    await card.locator('.radar-share-hidden-chip').click();
    await expect(card.locator('.radar-share-row')).toHaveCount(2);
    await expect(card.locator('.radar-share-hidden-bar')).toHaveCount(0);

    // Reopening the card starts from the full radar again
    await card.locator('.radar-share-row', { hasText: 'Tomorrowland' }).locator('.radar-share-remove').click();
    await expect(card.locator('.radar-share-row')).toHaveCount(1);
    await page.evaluate(() => { closeRadarShareCard(); openRadarShareCard(); });
    await expect(card.locator('.radar-share-row')).toHaveCount(2);
  });

  test('Radar share card hides the remove control when there is only one upcoming rave', async ({ page }) => {
    await bootAuthedApp(page, { data: statsData() });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); openRadarShareCard(); });
    await expect(page.locator('#radar-share-card .radar-share-row')).toHaveCount(1);
    await expect(page.locator('#radar-share-card .radar-share-remove')).toHaveCount(0);
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

  test('Artists Seen Live: genre pills filter the Full List and clear back to all artists', async ({ page }) => {
    const d = statsData();
    d.artists.push({ id: 'a2', name: 'Peggy Gou', genres: ['house'] });
    d.artist_festival_appearances = [
      { artist_id: 'a1', festival_id: 'f-past' },
      { artist_id: 'a2', festival_id: 'f-past' },
    ];
    d.raver_artist_sightings = [
      { raver_id: 'r-you', artist_id: 'a1', festival_id: 'f-past' },
      { raver_id: 'r-you', artist_id: 'a2', festival_id: 'f-past' },
    ];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); openArtistsSeenPage(); });
    await expect(page.locator('#page-artists-seen .rlog-item-name')).toHaveCount(2);

    // Tap the Techno breakdown pill — Full List narrows to just Charlotte de Witte,
    // and the page title/hero swap to reflect the active filter.
    await page.locator('#page-artists-seen .stats-pill.cyan', { hasText: 'Techno' }).click();
    await expect(page.locator('#page-artists-seen .section-title')).toHaveText('Techno Artists 🎤');
    await expect(page.locator('#page-artists-seen .rlog-item-name')).toHaveCount(1);
    await expect(page.locator('#page-artists-seen .rlog-item-name')).toHaveText('Charlotte de Witte');
    await expect(page.locator('#page-artists-seen .stats-pill.cyan', { hasText: 'Techno' })).toHaveClass(/active/);

    // Both breakdown pills stay visible while filtered, so switching genres
    // doesn't require clearing first.
    await page.locator('#page-artists-seen .stats-pill.cyan', { hasText: 'House' }).click();
    await expect(page.locator('#page-artists-seen .rlog-item-name')).toHaveText('Peggy Gou');

    // Clearing goes back to the full unfiltered list.
    await page.locator('#page-artists-seen .profile-back', { hasText: 'all artists' }).click();
    await expect(page.locator('#page-artists-seen .section-title')).toHaveText('Artists Seen Live 🎤');
    await expect(page.locator('#page-artists-seen .rlog-item-name')).toHaveCount(2);
  });

  test('Artists Seen Live: genre pills stay clickable even when Chart.js loads (statsChartOrFallback swaps in a canvas)', async ({ page }) => {
    // Regression test: statsChartOrFallback() renders a <canvas> instead of the
    // fallback HTML whenever window.Chart is defined — this sandbox blocks the
    // Chart.js CDN so every other test only exercises the fallback branch. Real CI
    // has internet access and Chart.js loads for real, so the genre pills must be
    // rendered outside statsChartOrFallback's fallbackHtml, not inside it, or they
    // silently vanish in production while every local/offline test stays green.
    const d = statsData();
    d.artists.push({ id: 'a2', name: 'Peggy Gou', genres: ['house'] });
    d.artist_festival_appearances = [
      { artist_id: 'a1', festival_id: 'f-past' },
      { artist_id: 'a2', festival_id: 'f-past' },
    ];
    d.raver_artist_sightings = [
      { raver_id: 'r-you', artist_id: 'a1', festival_id: 'f-past' },
      { raver_id: 'r-you', artist_id: 'a2', festival_id: 'f-past' },
    ];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { window.Chart = function () { this.destroy = () => {}; }; });
    await page.evaluate(() => { switchTab('stats'); openArtistsSeenPage(); });

    await expect(page.locator('#artists-genre-chart')).toBeAttached(); // proves the "Chart loaded" branch ran
    await page.locator('#page-artists-seen .stats-pill.cyan', { hasText: 'Techno' }).click();
    await expect(page.locator('#page-artists-seen .section-title')).toHaveText('Techno Artists 🎤');
  });

  test('Vibe DNA genre pills open Artists Seen Live pre-filtered to that genre', async ({ page }) => {
    const d = statsData();
    // Vibe DNA only unlocks at 3+ logged raves — add two more past RSVPs on top
    // of statsData()'s one so the section actually renders.
    d.festivals.push({ id: 'f-past2', name: 'Second Past Fest', date: '2021-06-01', location: 'Berlin, DE', color: '#00F5FF', days: 1, deleted_at: null });
    d.festivals.push({ id: 'f-past3', name: 'Third Past Fest', date: '2019-06-01', location: 'Berlin, DE', color: '#00F5FF', days: 1, deleted_at: null });
    d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-past2' }, { raver_id: 'r-you', festival_id: 'f-past3' });
    d.artist_festival_appearances = [{ artist_id: 'a1', festival_id: 'f-past' }];
    d.raver_artist_sightings = [{ raver_id: 'r-you', artist_id: 'a1', festival_id: 'f-past' }];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); loadStatsPage(); });

    const vibeDnaCard = page.locator('#stats-content .stats-section-card', { has: page.locator('.stats-section-title', { hasText: 'Vibe DNA' }) });
    await vibeDnaCard.locator('.stats-pill', { hasText: 'Techno' }).click();
    await expect(page.locator('#page-artists-seen')).toHaveClass(/active/);
    await expect(page.locator('#page-artists-seen .section-title')).toHaveText('Techno Artists 🎤');
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

    // Detroit -> LA is ~1,980 miles: past the 500/1,000 badges, short of 2,500/5,000.
    await page.evaluate(() => {
      saveUserGeo({ lat: 34.0522, lng: -118.2437, label: 'Los Angeles, CA', source: 'manual' });
      loadStatsPage();
    });
    const milesCard = page.locator('#stats-content .stats-section-card', { has: page.locator('.stats-section-title', { hasText: 'Miles Raved Milestones' }) });
    await expect(milesCard.locator('.milestone-badge.unlocked')).toHaveCount(2);
    await expect(milesCard).toContainText('more miles to unlock 🥇 Gold');
  });

  test('Cities Hit page shows milestone badges toward the next tier', async ({ page }) => {
    const d = statsData(); // Detroit is city #1
    ['Berlin, DE', 'London, UK', 'Amsterdam, NL', 'Tokyo, JP'].forEach((loc, i) => {
      d.festivals.push({ id: `f-city${i}`, name: `City Fest ${i}`, date: `201${i}-06-01`, location: loc, color: '#39FF14', days: 1, deleted_at: null });
      d.raver_festivals.push({ raver_id: 'r-you', festival_id: `f-city${i}` });
    });
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); openCitiesMapPage(); });

    const milestoneCard = page.locator('#page-cities-map .stats-section-card', { has: page.locator('.stats-section-title', { hasText: 'Cities Hit Milestones' }) });
    // 5 distinct cities logged — Bronze (5) unlocked, Silver (10) is next.
    await expect(milestoneCard.locator('.milestone-badge.unlocked')).toHaveCount(1);
    await expect(milestoneCard).toContainText('5 more cities to unlock 🥈 Silver');
  });

  test('Artists Seen Live shows milestone badges toward the next tier', async ({ page }) => {
    const d = statsData();
    d.artist_festival_appearances = [{ artist_id: 'a1', festival_id: 'f-past' }];
    d.raver_artist_sightings = [{ raver_id: 'r-you', artist_id: 'a1', festival_id: 'f-past' }];
    await bootAuthedApp(page, { data: d });
    await page.evaluate(() => { switchTab('stats'); openArtistsSeenPage(); });

    const milestoneCard = page.locator('#page-artists-seen .stats-section-card', { has: page.locator('.stats-section-title', { hasText: 'Artists Seen Milestones' }) });
    await expect(milestoneCard.locator('.milestone-badge.unlocked')).toHaveCount(0);
    await expect(milestoneCard).toContainText('9 more artists to unlock 🥉 Bronze');
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
