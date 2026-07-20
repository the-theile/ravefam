const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// Content from a crewmate (kai-uid) in each of the five non-huddle Overview
// tiles, dated before "now" so a fresh read watermark actually clears it
// (huddle's own tests use far-future dates since they never mark read within
// the test; here we do, so the dates must be in the past).
function seedWithFeatureContent() {
  const data = seedData();
  data.dream_board_pins = [
    { id: 'dp1', crew_id: 'c1', added_by: 'kai-uid', label: 'Sunrise set', hyped_by: [], created_at: '2024-06-01T00:00:00Z', deleted_at: null },
  ];
  data.crew_archive_links = [
    { id: 'al1', crew_id: 'c1', added_by: 'kai-uid', url: 'https://example.com/photo.jpg', label: 'Gate pic', festival_id: null, created_at: '2024-06-01T00:00:00Z', deleted_at: null },
  ];
  data.crew_polls = [
    { id: 'p1', crew_id: 'c1', created_by: 'kai-uid', question: 'Meetup spot?', poll_type: 'single', options: [], is_anonymous: false, expires_at: null, is_locked: false, is_pinned: false, reactions: {}, created_at: '2024-06-01T00:00:00Z', deleted_at: null },
  ];
  data.crew_jams = [
    { id: 'j1', crew_id: 'c1', added_by: 'kai-uid', url: 'https://example.com/mix', platform: 'soundcloud', title: 'Warmup mix', cover_url: null, track_count: 1, tag: null, description: '', festival_id: null, reactions: {}, is_pinned: false, poll_id: null, created_at: '2024-06-01T00:00:00Z', deleted_at: null },
  ];
  data.crew_feed_events = [
    { id: 'fe1', crew_id: 'c1', event_type: 'badge_earned', raver_id: 'r-kai', badge_id: 'b1', badge_name: 'Squad Goals', badge_emoji: '🎯', is_crew_level: true, created_at: '2024-06-01T00:00:00Z' },
  ];
  data.crew_feature_reads = [];
  return data;
}

test.describe('crew feature tile unseen glow', () => {
  test('all five non-huddle tiles pulse when they hold content the user has never read', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithFeatureContent() });
    await page.evaluate(async () => { await openDetail('c1', {}); });
    await page.waitForTimeout(500);

    for (const f of ['pins', 'dreamboard', 'poll', 'jams', 'archive']) {
      const icon = page.locator(`.crew-feature-tile[data-feature="${f}"] .crew-feature-tile-icon`);
      await expect(icon, `${f} should have has-unseen`).toHaveClass(/has-unseen/);
    }
  });

  test('opening a tile clears only that tile\'s glow and persists a read watermark server-side', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithFeatureContent() });
    await page.evaluate(async () => { await openDetail('c1', {}); });
    await page.waitForTimeout(500);

    await page.locator('.crew-feature-tile[data-feature="dreamboard"]').click();
    await page.waitForTimeout(300);

    const dbIcon = page.locator('.crew-feature-tile[data-feature="dreamboard"] .crew-feature-tile-icon');
    await expect(dbIcon).not.toHaveClass(/has-unseen/);

    const pollIcon = page.locator('.crew-feature-tile[data-feature="poll"] .crew-feature-tile-icon');
    await expect(pollIcon).toHaveClass(/has-unseen/);

    const read = await page.evaluate(() =>
      (window.__store.crew_feature_reads || []).find(r => r.feature === 'dreamboard' && String(r.crew_id) === 'c1' && String(r.user_id) === 'test-user-id'));
    expect(read).toBeTruthy();

    // Re-opening the crew should keep dreamboard clear (watermark now beats
    // the content's created_at) while poll — never opened — stays lit.
    await page.evaluate(async () => { await openDetail('c1', {}); });
    await page.waitForTimeout(500);
    await expect(dbIcon).not.toHaveClass(/has-unseen/);
    await expect(pollIcon).toHaveClass(/has-unseen/);
  });

  test('own contributions never count as unseen for tiles with an author column; Pins (badge feed) has none so it still lights up', async ({ page }) => {
    const data = seedWithFeatureContent();
    data.dream_board_pins[0].added_by = TEST_UID;
    data.crew_archive_links[0].added_by = TEST_UID;
    data.crew_polls[0].created_by = TEST_UID;
    data.crew_jams[0].added_by = TEST_UID;
    await bootAuthedApp(page, { data });
    await page.evaluate(async () => { await openDetail('c1', {}); });
    await page.waitForTimeout(500);

    for (const f of ['dreamboard', 'poll', 'jams', 'archive']) {
      const icon = page.locator(`.crew-feature-tile[data-feature="${f}"] .crew-feature-tile-icon`);
      await expect(icon, `${f} should NOT have has-unseen`).not.toHaveClass(/has-unseen/);
    }
    const pinsIcon = page.locator('.crew-feature-tile[data-feature="pins"] .crew-feature-tile-icon');
    await expect(pinsIcon).toHaveClass(/has-unseen/);
  });
});
