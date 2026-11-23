#!/usr/bin/env node
// Captures App Store screenshots for iPhone 6.9" and iPad 13".
//
// Reuses the landing page's demo crew and mocked-Supabase harness
// (capture-landing-screenshots.js + tests/helpers.js): no login, no live
// backend, no real user data. The crew is fictional; festivals are real.
// The crew's upcoming rave is moved to Eternal NYE so it's still ahead.
//   node scripts/capture-appstore-screenshots.js
// Output: screenshots/appstore/{iphone,ipad}/NN-name.jpg (JPEG: App Store
// Connect rejects PNGs with an alpha channel).
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { bootAuthedApp, TEST_UID } = require('../tests/helpers');
const { startServer, stopServer, demoData, clearChrome, BASE_URL } = require('./capture-landing-screenshots');

const REPO_ROOT = path.join(__dirname, '..');
const OUT_ROOT = path.join(REPO_ROOT, 'screenshots', 'appstore');

// App Store Connect sizes: 1320x2868 (iPhone 6.9") and 2064x2752 (iPad 13").
const DEVICES = [
  { dir: 'iphone', viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 },
  { dir: 'ipad', viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2 },
];

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

// ===== Demo data: upcoming rave = Eternal NYE =====
function storeData(opts) {
  const data = demoData(opts);
  const f = data.festivals.find((x) => x.id === 'f-edc');
  Object.assign(f, { name: 'Eternal NYE', date: '2026-12-30', days: 2, location: 'Orlando Amphitheater, Orlando FL', color: '#BF00FF' });
  data.artists = [
    { id: 'a1', name: 'Knock2', genres: ['trap'] },
    { id: 'a2', name: 'Zeds Dead', genres: ['dubstep'] },
    { id: 'a3', name: 'RL Grime', genres: ['trap'] },
  ];
  const lines = [
    ['uid-dani', 'who has the parking pass?? need to know before the 30th', 58],
    ['uid-marco', 'me. 2 cars, both have room', 55],
    [TEST_UID, 'Tess + Kai ride with me. Priya with Marco', 52],
    ['uid-tess', 'calling it now: Knock2 rail or nothing', 30],
    ['uid-kai', 'meet at the disco ball totem after Zeds Dead', 12],
    ['uid-priya', 'NYE outfit check on the 29th, bring the glitter 🪩', 4],
  ];
  data.huddle_messages.forEach((m, i) => { m.sender_id = lines[i][0]; m.body = lines[i][1]; m.created_at = minsAgo(lines[i][2]); });
  // Crew feed: a poll, a playlist and a Dream Board pin from crewmates.
  const hrs = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  data.crew_polls = [{
    id: 'p1', crew_id: 'c1', created_by: 'uid-tess', question: 'Which night are we going hardest?', poll_type: 'choice',
    options: ['Dec 30 · Knock2', 'Dec 31 · Zeds Dead', 'Both. Obviously.'], is_anonymous: false, expires_at: null,
    is_locked: false, is_pinned: false, reactions: { '🔥': ['uid-dani', 'uid-kai'] }, created_at: hrs(1), deleted_at: null,
  }];
  data.crew_poll_votes = [
    ['uid-dani', '2'], ['uid-kai', '2'], ['uid-marco', '1'], ['uid-priya', '2'],
  ].map(([u, v], i) => ({ id: `pv${i}`, poll_id: 'p1', voter_user_id: u, vote_value: v }));
  data.crew_jams = [{
    id: 'j1', crew_id: 'c1', added_by: 'uid-dani', url: 'https://open.spotify.com/playlist/x', platform: 'spotify',
    title: 'Eternal NYE pregame 🪩', cover_url: null, track_count: 42, tag: null, description: '', festival_id: 'f-edc',
    reactions: { '💜': ['uid-tess'] }, is_pinned: false, poll_id: null, created_at: hrs(5), deleted_at: null,
  }];
  data.dream_board_pins = [{
    id: 'dp1', crew_id: 'c1', added_by: 'uid-kai', label: 'Tomorrowland 2027', hyped_by: ['uid-dani', 'uid-tess', 'uid-priya'],
    created_at: hrs(26), deleted_at: null,
  }];
  data.__rpc = { rave_check_status: [
    { raver_id: 'r-lena', last_checked_at: minsAgo(120), declined: false },
  ] };
  return data;
}

// ===== Shots (App Store order: strongest first) =====
const SHOTS = [
  { name: '01-crew', run: (p) => p.evaluate(() => openDetail('c1')), hide: '.crew-quests' },
  { name: '02-huddle', run: (p) => p.evaluate(async () => { await openHuddle('c1'); }) },
  {
    name: '03-rave-plan',
    run: (p) => p.evaluate(async (me) => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f-edc');
      const rows = [
        { kind: 'task', added_by: 'uid-dani', text: 'Parking pass', is_done: true },
        { kind: 'task', added_by: me, text: 'Book the Airbnb near the venue', is_done: true },
        { kind: 'task', added_by: 'uid-tess', text: 'Hydration packs for everyone', is_done: false },
        { kind: 'task', added_by: 'uid-priya', text: 'Totem: the giant disco ball', is_done: false },
      ];
      for (const r of rows) {
        const { data } = await sb.from('game_plan_items').insert({ game_plan_id: gp.id, crew_id: 'c1', ...r }).select().single();
        gamePlanItems.push(data);
      }
      await openDetail('c1', { tab: 'gameplan' });
    }, TEST_UID),
    scrollTo: '#crew-feature-panel-raveplan', scrollBy: -96,
  },
  { name: '04-rave-check', run: (p) => p.evaluate(() => { openRaveFocus('f-edc'); raveFocusSwitchTab('crew'); }) },
  { name: '05-raver', run: (p) => p.evaluate(() => { openProfile('r-dani'); setProfileTab('r-dani', 'vibe'); }) },
  {
    name: '06-stats',
    run: (p) => p.evaluate(() => { switchTab('stats'); loadStatsPage(); }),
    scrollTo: '.stats-section-card:has-text("Rave Passport")', scrollBy: 150,
  },
];

async function save(page, dir, name) {
  const out = path.join(OUT_ROOT, dir, `${name}.jpg`);
  await page.screenshot({ path: out, type: 'jpeg', quality: 92, animations: 'disabled' });
  console.log('wrote', path.relative(REPO_ROOT, out));
}

async function shoot(context, dir, shot) {
  const page = await context.newPage();
  await bootAuthedApp(page, {
    data: storeData(shot.opts),
    sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } },
  });
  await shot.run(page);
  await page.waitForTimeout(700);
  await clearChrome(page);
  if (shot.hide) {
    await page.evaluate((sel) => document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; }), shot.hide);
  }
  if (shot.scrollTo) {
    await page.locator(shot.scrollTo).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(200);
  }
  if (shot.scrollBy) {
    await page.evaluate((y) => window.scrollBy(0, y), shot.scrollBy);
    await page.waitForTimeout(200);
  }
  await save(page, dir, shot.name);
  await page.close();
}

// Lineup Explorer (public, signed-out) with a few picks saved.
async function shootLineup(context, dir) {
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.addInitScript(() => {
    try {
      localStorage.setItem('rf_picks', JSON.stringify({
        'eternal-nye-2026': { t: 'Eternal NYE 2026', n: ['Knock2', 'Zeds Dead', 'RL Grime', 'NGHTMRE', 'LSDREAM'] },
      }));
    } catch (e) {}
  });
  await page.goto('/lineup-explorer/eternal-nye-2026.html');
  await page.locator('.lp-f[data-v="picks"]').click();
  await page.locator('.lp-f[data-v="picks"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -16));
  await page.waitForTimeout(800);
  await save(page, dir, '07-lineup');
  await page.close();
}

async function main() {
  await startServer();
  // The pinned @playwright/test may not match the preinstalled browser.
  const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    for (const d of DEVICES) {
      fs.mkdirSync(path.join(OUT_ROOT, d.dir), { recursive: true });
      // A fresh context per shot: app state saved by one boot can stall the next.
      const fresh = () => browser.newContext({ baseURL: BASE_URL, viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, colorScheme: 'dark' });
      for (const s of [...SHOTS, null]) {
        const context = await fresh();
        if (s) await shoot(context, d.dir, s); else await shootLineup(context, d.dir);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    stopServer();
  }
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
