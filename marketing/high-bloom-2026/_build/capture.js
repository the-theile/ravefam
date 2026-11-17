// Captures the High Bloom 11.21 carousel screens.
//  - explorer.png: the real Tapesgiving 2026 Lineup Explorer page (High Bloom has
//    no lineup posted yet; Tapesgiving, Clearwater Nov 27-28, is the nearest
//    Florida rave with one). Logged out, no picks seeded, page data untouched.
//  - create-crew.png / rsvp.png / poll.png: the real app.html UI on the mocked
//    harness from scripts/capture-landing-screenshots.js (stubbed Supabase, the
//    fictional demo crew, no real user data). The crew's upcoming rave is the
//    real High Bloom row (Nov 21 2026, 1 day, Port Charlotte FL).
// Run from the repo root: node marketing/high-bloom-2026/_build/capture.js
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { startServer, stopServer, demoData, clearChrome, BASE_URL } = require('../../../scripts/capture-landing-screenshots');
const { bootAuthedApp, TEST_UID } = require('../../../tests/helpers');

const OUT = path.join(__dirname, 'shots');
const ONLY = process.argv[2]; // optional: capture one shot by name

// The demo crew's upcoming rave becomes High Bloom (id kept so RSVPs carry over).
function highBloomData() {
  const data = demoData();
  const f = data.festivals.find((x) => x.id === 'f-edc');
  Object.assign(f, { name: 'High Bloom', date: '2026-11-21', days: 1, location: 'Port Charlotte, FL', color: '#FF2D78' });
  return data;
}

function pollData() {
  const data = highBloomData();
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  data.crew_polls = [{
    id: 'poll-drive', crew_id: 'c1', created_by: 'uid-dani', question: "Who's driving to High Bloom? 🚗",
    poll_type: 'choice', options: ['Marco (4 seats)', 'Tess (3 seats)', 'Alex (4 seats)', 'Splitting a rideshare'],
    is_anonymous: false, expires_at: null, deleted_at: null, created_at: ago(1),
  }];
  data.crew_poll_votes = [[TEST_UID, '0'], ['uid-dani', '0'], ['uid-priya', '0'], ['uid-kai', '1'], ['uid-marco', '0'], ['uid-tess', '1']]
    .map(([voter_user_id, vote_value]) => ({ poll_id: 'poll-drive', voter_user_id, vote_value }));
  return data;
}

async function shot(browser, name, data, run) {
  if (ONLY && ONLY !== name) return;
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark' });
  try {
    const page = await context.newPage();
    if (data) {
      await bootAuthedApp(page, { data, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
    }
    await run(page);
    await page.waitForTimeout(700);
    if (data) await clearChrome(page);
    await page.addStyleTag({ content: '*, *::before, *::after { animation-play-state: paused !important; caret-color: transparent !important; }' });
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('wrote', name);
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await startServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  try {
    await shot(browser, 'explorer', null, async (p) => {
      await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await p.goto('/lineup-explorer/tapesgiving-2026.html');
      await p.waitForSelector('.act');
      await p.evaluate(() => document.fonts.ready);
      await p.addStyleTag({ content: '.cta-bar, .lp-toast, .a2hs-btn, .lp-sheet, .lp-coach { display: none !important; }' });
    });

    // Same page, scrolled so the artist list fills the screen.
    await shot(browser, 'explorer-acts', null, async (p) => {
      await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await p.goto('/lineup-explorer/tapesgiving-2026.html');
      await p.waitForSelector('.act');
      await p.evaluate(() => document.fonts.ready);
      await p.addStyleTag({ content: '.cta-bar, .lp-toast, .a2hs-btn, .lp-sheet, .lp-coach { display: none !important; }' });
      await p.evaluate(() => window.scrollTo(0, document.getElementById('count').getBoundingClientRect().top + scrollY - 16));
    });

    await shot(browser, 'create-crew', highBloomData(), async (p) => {
      await p.evaluate(() => { window.scrollTo(0, 0); openModal(); });
      await p.waitForTimeout(400);
      await p.locator('#crew-name-input').fill('Bloom Squad');
      await p.locator('#crew-desc-input').fill('Port Charlotte or bust 🌸');
      await p.locator('.color-swatch[aria-label="Neon cyan"]').click();
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
    });

    await shot(browser, 'rsvp', highBloomData(), async (p) => {
      await p.evaluate(() => { window.scrollTo(0, 0); openRaveFocus('f-edc'); });
    });

    // Same sheet, Crew tab: who in the crew is going / interested.
    await shot(browser, 'rsvp-crew', highBloomData(), async (p) => {
      await p.evaluate(() => { window.scrollTo(0, 0); openRaveFocus('f-edc'); raveFocusSwitchTab('crew'); });
    });

    await shot(browser, 'poll', pollData(), async (p) => {
      await p.evaluate(() => { window.scrollTo(0, 0); openDetail('c1'); });
      await p.waitForTimeout(600);
      await p.evaluate(() => openCrewFeedItem('poll', 'poll-drive'));
      await p.waitForTimeout(900);
    });
  } finally {
    await browser.close();
    stopServer();
  }
})();
