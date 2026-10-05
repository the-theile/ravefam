const { test, devices } = require('/home/user/ravefam/node_modules/@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('/home/user/ravefam/tests/helpers.js');
test.use({ ...devices['iPhone 13'], browserName: 'chromium', deviceScaleFactor: 3 });

function richData() {
  const d = seedData();
  const dt = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  d.festivals[0].date = dt(285); d.festivals[1].date = dt(42);
  const sam = d.ravers.find(r => r.id === 'r-sam'); Object.assign(sam, { claimed_by: 'sam-uid', status: 'claimed' });
  d.point_totals = [{ raver_id: 'r-kai', peace_points: 140, love_points: 95, unity_points: 120, respect_points: 60 },
    { raver_id: 'r-you', peace_points: 110, love_points: 130, unity_points: 80, respect_points: 75 }];
  d.festivals.push(
    { id: 'f3', name: 'Hulaween', date: dt(24), location: 'Live Oak, FL', color: '#39FF14', days: null, deleted_at: null },
    { id: 'f4', name: 'EDC Las Vegas', date: dt(223), location: 'Las Vegas, NV', color: '#BF00FF', days: null, deleted_at: null },
    { id: 'f5', name: 'Movement', date: dt(231), location: 'Detroit, MI', color: '#FFD700', days: null, deleted_at: null });
  d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f3' }, { raver_id: 'r-you', festival_id: 'f4' },
    { raver_id: 'r-kai', festival_id: 'f3' }, { raver_id: 'r-kai', festival_id: 'f1' });
  const kai = d.ravers.find(r => r.id === 'r-kai');
  Object.assign(kai, { genres: ['Techno', 'Melodic', 'Trance'], vibe_tags: ['warehouse', 'rail rider'], instagram: '@kaibeats', radiate: 'Front left, always.' });
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  d.notifications = [
    { id: '00000000-0000-4000-8000-000000000001', user_id: TEST_UID, read: false, created_at: ago(2), type: 'festival_add',
      message: "🎪 Kai added you to Hulaween! You're on the lineup.", data: { festival_id: 'f3', raver_id: 'r-you', festival_name: 'Hulaween' } },
    { id: 'g1', user_id: TEST_UID, read: false, created_at: ago(8), message: "🎟️ Kai M. RSVP'd to Tomorrowland", type: null, data: { actor_id: 'kai-uid' } },
    { id: 'g2', user_id: TEST_UID, read: false, created_at: ago(14), message: "🎟️ Sam P. RSVP'd to Tomorrowland", type: null, data: { actor_id: 'sam-uid' } },
    { id: 'p1', user_id: TEST_UID, read: false, created_at: ago(40), message: '☮️ +10 Peace points', type: 'points_earned', data: { track: 'peace', amount: 10 } },
    { id: 'r1', user_id: TEST_UID, read: true, created_at: ago(60 * 30), message: '🗓️ Awakenings is coming up', type: null, data: { links: [{ t: 'Awakenings', k: 'rave', id: 'f2' }] } },
    { id: 'r2', user_id: TEST_UID, read: true, created_at: ago(60 * 24 * 3), message: '💬 Kai M. mentioned you in Bass Syndicate', type: null, data: null },
    { id: 'r3', user_id: TEST_UID, read: true, created_at: ago(60 * 24 * 20), message: '🤝 Sam P. joined Bass Syndicate', type: null, data: null },
  ];
  return d;
}
const out = n => `/tmp/claude-0/-home-user-ravefam/5e3688e5-3395-5945-a56c-c5864d6384eb/scratchpad/ig/${n}.png`;

test('profile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1240 });
  await bootAuthedApp(page, { data: richData() });
  await page.evaluate(() => openProfile('r-kai'));
  await page.waitForTimeout(800);
  
  await page.locator('#page-profile .profile-tab[data-tab="raves"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('shot-profile-raves') });
});
test('notifs', async ({ page }) => {
  await bootAuthedApp(page, { data: richData() });
  await page.evaluate(() => openNotifDrawer());
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('shot-notifs') });
});
test('settings', async ({ page }) => {
  await bootAuthedApp(page, { data: richData() });
  await page.evaluate(() => openPrivacySettingsModal('r-you'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('shot-settings') });
});
