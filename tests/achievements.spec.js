const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// Regression test for a bug where awardAchievement() re-posted the "unlocked"
// Huddle system message and crew_feed_events row every time it was called for
// an already-earned badge, because a 23505 (unique violation) insert error —
// the real Postgres signal that this crew already has the badge — fell
// through to the notify/post code instead of returning early. Several
// checkAndAwardBadges() call sites across the app can race with a stale
// in-memory crewAchievements snapshot, so this path is reachable in practice
// (observed in production: 7 duplicate messages from the app's 7 call sites).
test.describe('crew achievements', () => {
  test('re-awarding an already-earned crew badge does not re-announce it', async ({ page }) => {
    const data = seedData();
    data.crew_achievements = [
      { id: 'ca1', crew_id: 'c1', badge_id: 'first_festival_together', earned_at: '2026-01-01T00:00:00Z' },
    ];
    data.crew_feed_events = [
      { id: 'fe1', crew_id: 'c1', event_type: 'achievement_unlocked', badge_id: 'first_festival_together', badge_name: 'First Rave Together', badge_emoji: '🎪', is_crew_level: true, created_at: '2026-01-01T00:00:00Z' },
    ];
    await bootAuthedApp(page, { data });

    // Simulate a second call site racing in with a stale (empty) local
    // crewAchievements snapshot — the exact scenario that used to fall
    // through the unique-constraint error and re-post the unlock.
    await page.evaluate(async () => {
      crewAchievements = [];
      await awardAchievement('first_festival_together', 'c1', null);
    });
    await page.waitForTimeout(200);

    const feedCount = await page.evaluate(() =>
      (window.__store.crew_feed_events || []).filter(e => e.crew_id === 'c1' && e.badge_id === 'first_festival_together').length);
    expect(feedCount).toBe(1);

    const huddleSystemCount = await page.evaluate(() =>
      (window.__store.huddle_messages || []).filter(m => m.kind === 'system').length);
    expect(huddleSystemCount).toBe(0);

    const achievementRows = await page.evaluate(() =>
      (window.__store.crew_achievements || []).filter(a => a.crew_id === 'c1' && a.badge_id === 'first_festival_together').length);
    expect(achievementRows).toBe(1);
  });

  test('awarding a genuinely new crew badge posts exactly one announcement', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await page.evaluate(async () => { await awardAchievement('first_festival_together', 'c1', null); });
    await page.waitForTimeout(200);

    const feedCount = await page.evaluate(() =>
      (window.__store.crew_feed_events || []).filter(e => e.crew_id === 'c1' && e.badge_id === 'first_festival_together').length);
    expect(feedCount).toBe(1);

    const huddleSystemCount = await page.evaluate(() =>
      (window.__store.huddle_messages || []).filter(m => m.kind === 'system').length);
    expect(huddleSystemCount).toBe(1);
  });
});
