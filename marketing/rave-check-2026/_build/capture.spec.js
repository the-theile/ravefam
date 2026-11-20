// Captures real Rave Check screens from app.html with the repo's stubbed
// Supabase and a made-up crew. Run from the repo root (it has to sit inside
// tests/ for Playwright to pick it up):
//   cp marketing/rave-check-2026/_build/capture.spec.js tests/_ig_capture.spec.js
//   npx playwright test tests/_ig_capture.spec.js --project=chromium --trace off
//   rm tests/_ig_capture.spec.js
const { test } = require('@playwright/test');
const path = require('path');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

const OUT = path.resolve(__dirname, '../marketing/rave-check-2026/_build/shots');
const ADDED = '2024-01-01T00:00:00Z';
const G = {
  pink: 'linear-gradient(135deg,#FF2D78,#BF00FF)', cyan: 'linear-gradient(135deg,#00F5FF,#39FF14)',
  purple: 'linear-gradient(135deg,#BF00FF,#5B6EFF)', yellow: 'linear-gradient(135deg,#FFE600,#FF6B35)',
  green: 'linear-gradient(135deg,#39FF14,#00F5FF)', orange: 'linear-gradient(135deg,#FF6B35,#FF2D78)',
};

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

// youName: who's signed in. Everyone else is a claimed crewmate in "Bass Fam".
function crewData(youName, others) {
  const data = seedData();
  const base = data.ravers.find(r => r.id === 'r-kai');
  const you = { ...data.ravers.find(r => r.is_you), name: youName, handle: youName.toLowerCase(), gradient: G.pink };
  data.ravers = [you, ...others.map(o => ({ ...base, id: o.id, name: o.name, handle: o.name.toLowerCase(), claimed_by: o.uid, qr_token: 'qr-' + o.id, gradient: o.g }))];
  data.crews[0] = { ...data.crews[0], name: 'Bass Fam' };
  data.crew_members = data.ravers.map(r => ({ crew_id: 'c1', raver_id: r.id, added_at: ADDED, added_by: TEST_UID, deleted_at: null }));
  data.festivals = [{ id: 'f9', name: 'Eternal NYE', date: '2026-12-30', location: 'Tampa, FL', color: '#BF00FF', days: 2, deleted_at: null }];
  data.raver_festival_interest = [];
  data.raver_festivals = [];
  data.__rpc = { rave_check_status: [] };
  return data;
}

test('sender: crew tab + send sheet', async ({ page }) => {
  const data = crewData('Alex', [
    { id: 'r-jess', name: 'Jess', uid: 'u-jess', g: G.green }, { id: 'r-marco', name: 'Marco', uid: 'u-marco', g: G.cyan },
    { id: 'r-priya', name: 'Priya', uid: 'u-priya', g: G.yellow }, { id: 'r-dani', name: 'Dani', uid: 'u-dani', g: G.orange },
    { id: 'r-kev', name: 'Kev', uid: 'u-kev', g: G.purple }, { id: 'r-sam', name: 'Sam', uid: 'u-sam', g: G.pink },
  ]);
  data.raver_festivals = ['r-you', 'r-jess', 'r-marco'].map(id => ({ raver_id: id, festival_id: 'f9' }));
  data.raver_festival_interest = [{ raver_id: 'r-priya', festival_id: 'f9' }];
  data.__rpc.rave_check_status = [{ raver_id: 'r-sam', last_checked_at: new Date(Date.now() - 2 * 3600e3).toISOString(), declined: false }];
  await bootAuthedApp(page, { data });
  await page.evaluate(() => { openRaveFocus('f9'); raveFocusSwitchTab('crew'); });
  await page.waitForTimeout(500);
  // Scroll the meter + "Not answered yet" into view.
  await page.evaluate(() => document.getElementById('rc-meter-wrap')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'crew.png'), animations: 'disabled' });
  await page.evaluate(() => openRaveCheckSheet('f9', null));
  await page.waitForTimeout(400);
  await page.locator('#rave-check-sheet-content .rc-preset', { hasText: 'Carpool?' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'sheet.png'), animations: 'disabled' });
});

test('crew screen: Rave Plan ticket with the Rave check button', async ({ page }) => {
  const data = crewData('Alex', [
    { id: 'r-jess', name: 'Jess', uid: 'u-jess', g: G.green }, { id: 'r-marco', name: 'Marco', uid: 'u-marco', g: G.cyan },
    { id: 'r-priya', name: 'Priya', uid: 'u-priya', g: G.yellow }, { id: 'r-dani', name: 'Dani', uid: 'u-dani', g: G.orange },
    { id: 'r-kev', name: 'Kev', uid: 'u-kev', g: G.purple }, { id: 'r-sam', name: 'Sam', uid: 'u-sam', g: G.pink },
  ]);
  data.raver_festivals = ['r-you', 'r-jess', 'r-marco'].map(id => ({ raver_id: id, festival_id: 'f9' }));
  data.raver_festival_interest = [{ raver_id: 'r-priya', festival_id: 'f9' }];
  await bootAuthedApp(page, { data });
  await page.evaluate(async () => { await openDetail('c1', { tab: 'gameplan' }); });
  // The test account's quest banner isn't part of the feature; hide it.
  await page.evaluate(() => document.querySelectorAll('.crew-quests').forEach(el => { el.style.display = 'none'; }));
  await page.waitForTimeout(700);
  // From the crew name down to the bottom of the ticket (skips the app header).
  const name = await page.getByText('Bass Fam', { exact: true }).filter({ visible: true }).first().boundingBox();
  const t = await page.locator('.crew-ticket[data-fest="f9"]').boundingBox();
  const top = Math.max(0, Math.floor(name.y - 60));
  await page.screenshot({ path: path.join(OUT, 'ticket.png'), animations: 'disabled', clip: { x: 0, y: top, width: 390, height: Math.ceil(t.y + t.height + 14 - top) } });
});

test('receiver: card in the rave popup', async ({ page }) => {
  const data = crewData('Dani', [
    { id: 'r-alex', name: 'Alex', uid: 'u-alex', g: G.pink }, { id: 'r-jess', name: 'Jess', uid: 'u-jess', g: G.green },
    { id: 'r-marco', name: 'Marco', uid: 'u-marco', g: G.cyan },
  ]);
  data.raver_festivals = ['r-alex', 'r-jess', 'r-marco'].map(id => ({ raver_id: id, festival_id: 'f9' }));
  data.notifications = [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', user_id: TEST_UID, crew_id: 'c1', read: false, created_at: new Date().toISOString(),
    message: '🎧 Rave check from Alex: you coming to Eternal NYE?', type: 'rave_check',
    data: { rave_check_id: '11111111-2222-4333-8444-555555555555', festival_id: 'f9', festival_name: 'Eternal NYE', note: 'Carpool?', actor_id: 'u-alex',
      links: [{ t: 'Eternal NYE', k: 'rave', id: 'f9' }] } }];
  await bootAuthedApp(page, { data });
  await page.evaluate(() => openRaveFocus('f9'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'card.png'), animations: 'disabled' });
});
