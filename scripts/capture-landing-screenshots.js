#!/usr/bin/env node
// Captures the phone screenshots shown on the landing page (index.html):
// the hero crew page, one shot per feature tab, and the Lineup Explorer.
//
// Same approach as capture-email-screenshots.js: boots app.html on the
// mocked-Supabase harness (tests/helpers.js), so there's no login, no live
// backend and no real user data. The crew is fictional; festivals are real.
// Re-run after UI changes so the landing page keeps showing the current app:
//   node scripts/capture-landing-screenshots.js
// Output: screenshots/landing/*.webp (served; referenced from index.html).
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');
const { bootAuthedApp, TEST_UID } = require('../tests/helpers');

const PORT = 4322;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'screenshots', 'landing');
const WEBP_QUALITY = 0.82;

let serverProc = null;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn('node', ['tests/static-server.js', String(PORT)], { cwd: REPO_ROOT });
    let settled = false;
    const onReady = () => { if (!settled) { settled = true; resolve(); } };
    serverProc.stdout.on('data', (d) => { if (d.toString().includes('listening')) onReady(); });
    serverProc.stderr.on('data', (d) => process.stderr.write(d));
    serverProc.on('error', reject);
    setTimeout(onReady, 1500);
  });
}

// ===== Demo crew =====
const ADDED = '2026-03-01T00:00:00Z';
const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60000).toISOString();

const GRADS = [
  'linear-gradient(135deg,#FF2D78,#BF00FF)', 'linear-gradient(135deg,#00F5FF,#39FF14)',
  'linear-gradient(135deg,#BF00FF,#FF2D78)', 'linear-gradient(135deg,#FFD600,#FF2D78)',
  'linear-gradient(135deg,#39FF14,#00F5FF)', 'linear-gradient(135deg,#FF6BA8,#FFD600)',
];

// [id, name, handle, uid (null = unclaimed), base, genres, vibe tags]
const PEOPLE = [
  ['r-you', 'Alex R.', 'alexr', TEST_UID, 'Orlando, FL', ['Bass', 'House'], ['vt-bassface']],
  ['r-dani', 'Dani V.', 'danivibes', 'uid-dani', 'Tampa, FL', ['Melodic Bass', 'Trance'],
    ['vt-kandi', 'vt-glittergremlin', 'vt-lineupguru', 'vt-raincoat', 'vt-mirrorball']],
  ['r-tess', 'Tess K.', 'tesswubs', 'uid-tess', 'Orlando, FL', ['Dubstep', 'Riddim'], ['vt-bassface']],
  ['r-kai', 'Kai M.', 'kaibeats', 'uid-kai', 'Miami, FL', ['Techno'], ['vt-sunglasses']],
  ['r-marco', 'Marco D.', 'marcod', 'uid-marco', 'Orlando, FL', ['House'], []],
  ['r-priya', 'Priya S.', 'priyaplur', 'uid-priya', 'Gainesville, FL', ['Trance'], []],
  ['r-jo', 'Jordan L.', 'jordanl', null, 'Orlando, FL', ['Bass'], []],
  ['r-sam', 'Sam P.', 'samraves', null, 'Jacksonville, FL', ['DnB'], []],
  ['r-lena', 'Lena W.', 'lenaw', null, 'Orlando, FL', ['House'], []],
  ['r-rio', 'Rio C.', 'rioc', null, 'Tampa, FL', ['Bass'], []],
  ['r-nico', 'Nico B.', 'nicob', null, 'Miami, FL', ['Techno'], []],
];

const UPCOMING = [
  { id: 'f-edc', name: 'EDC Orlando', date: '2026-11-06', days: 3, location: 'Tinker Field, Orlando FL', color: '#FF2D78' },
];
const PAST = [
  { id: 'p-lost', name: 'Lost Lands', date: '2025-09-19', days: 3, location: 'Legend Valley, OH', color: '#39FF14' },
  { id: 'p-okee', name: 'Okeechobee', date: '2026-03-05', days: 4, location: 'Okeechobee, FL', color: '#FFD600' },
  { id: 'p-ultra', name: 'Ultra Miami', date: '2026-03-27', days: 3, location: 'Bayfront Park, Miami FL', color: '#00F5FF' },
  { id: 'p-edclv', name: 'EDC Las Vegas', date: '2026-05-15', days: 3, location: 'Las Vegas Motor Speedway', color: '#BF00FF' },
  { id: 'p-forest', name: 'Electric Forest', date: '2026-06-25', days: 4, location: 'Rothbury, MI', color: '#39FF14' },
];

function demoData({ crewStatus = 'recruiting' } = {}) {
  const ravers = PEOPLE.map(([id, name, handle, uid, base, genres, vibes], i) => ({
    id, name, handle, is_you: id === 'r-you', created_by: TEST_UID, claimed_by: uid,
    status: uid ? 'claimed' : 'unclaimed', base, gradient: GRADS[i % GRADS.length],
    avatar_url: null, blocked_tags: [], genres, instagram: '', radiate: '', phone: '',
    phone_visible: false, met_story: '', notes: '', qr_token: `qr-${id}`,
    vibe_tags: vibes, custom_vibe_tags: [], deleted_at: null,
  }));
  const dani = ravers.find((r) => r.id === 'r-dani');
  dani.met_story = 'Rail at Illenium, Lost Lands 2025. Shared a poncho in the rain.';
  dani.instagram = '@danivibes';

  const festivals = [...UPCOMING, ...PAST].map((f) => ({ ...f, deleted_at: null }));
  const going = ['r-you', 'r-dani', 'r-tess', 'r-kai', 'r-marco', 'r-priya'];
  const interested = ['r-jo', 'r-sam', 'r-lena'];
  const raver_festivals = [
    ...going.map((r) => ({ raver_id: r, festival_id: 'f-edc' })),
    ...PAST.map((f, i) => ({ raver_id: 'r-you', festival_id: f.id, ticket_type: ['ga', 'ga', 'vip', 'ga', 'ga'][i] })),
    ...['p-lost', 'p-ultra', 'p-edclv'].map((f) => ({ raver_id: 'r-dani', festival_id: f })),
  ];

  return {
    festivals,
    ravers,
    crews: [{
      id: 'c1', name: 'Vibe Tribe', color: '#FF2D78', gradient: 'linear-gradient(90deg,#FF2D78,#BF00FF)',
      status: crewStatus, leader_id: TEST_UID, totem_photo_url: null, totem_icon: '⚡',
      invite_token: 'inv-c1', created_at: ADDED, deleted_at: null,
    }],
    crew_members: ravers.map((r) => ({ crew_id: 'c1', raver_id: r.id, added_at: ADDED, added_by: TEST_UID, deleted_at: null })),
    raver_festivals,
    raver_festival_interest: interested.map((r) => ({ raver_id: r, festival_id: 'f-edc' })),
    artists: [
      { id: 'a1', name: 'Alison Wonderland', genres: ['bass'] },
      { id: 'a2', name: 'SLANDER', genres: ['melodic bass'] },
      { id: 'a3', name: 'Kaskade', genres: ['house'] },
    ],
    raver_favorite_artists: [
      { raver_id: 'r-dani', artist_id: 'a1' }, { raver_id: 'r-dani', artist_id: 'a2' },
      { raver_id: 'r-you', artist_id: 'a2' }, { raver_id: 'r-you', artist_id: 'a3' },
    ],
    huddle_rooms: [
      { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: ADDED },
    ],
    huddle_messages: [
      ['uid-dani', 'who has the camping passes?? need to know before friday', 58],
      ['uid-marco', 'me. 2 cars, both have room', 55],
      [TEST_UID, 'Tess + Kai ride with me. Priya with Marco', 52],
      ['uid-tess', 'calling it now: SLANDER rail or nothing', 30],
      ['uid-kai', 'meet at the big ferris wheel after their set', 12],
      ['uid-priya', 'outfit check thursday night, bring the glitter 🪩', 4],
    ].map(([sender, body, m], i) => ({
      id: `m${i}`, room_id: 'room-main', crew_id: 'c1', sender_id: sender, kind: 'text', body,
      reactions: i === 3 ? { '🔥': ['uid-dani', 'uid-kai'] } : {}, created_at: minsAgo(m), deleted_at: null, mentions: [],
    })),
    huddle_room_reads: [{ room_id: 'room-main', user_id: TEST_UID, last_read_at: minsAgo(20) }],
  };
}

// ===== Capture =====
async function clearChrome(page) {
  await page.evaluate(() => {
    if (typeof dismissGuidanceBanner === 'function') { try { dismissGuidanceBanner(); } catch (e) {} }
    const toastEl = document.getElementById('toast');
    if (toastEl) { toastEl.innerHTML = ''; toastEl.className = 'toast'; }
    const fabEl = document.getElementById('qr-fab');
    if (fabEl) fabEl.style.display = 'none';
  });
  // Coachmarks re-queue the next tip 150ms after a dismiss; drain the queue.
  for (let i = 0; i < 4; i++) {
    const stillShowing = await page.evaluate(() => {
      if (typeof dismissCoachmark !== 'function') return false;
      const el = document.getElementById('coachmark');
      const wasShowing = !!(el && el.classList.contains('show'));
      try { dismissCoachmark(); } catch (e) {}
      return wasShowing;
    });
    if (!stillShowing) break;
    await page.waitForTimeout(200);
  }
}

// PNG -> WebP inside Chromium (canvas.toDataURL), so no image dependency.
async function writeWebp(context, png, name) {
  const page = await context.newPage();
  const b64 = await page.evaluate(async ({ src, q }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', q).split(',')[1];
  }, { src: 'data:image/png;base64,' + png.toString('base64'), q: WEBP_QUALITY });
  await page.close();
  const out = path.join(OUT_DIR, `${name}.webp`);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', path.relative(REPO_ROOT, out), `${Math.round(fs.statSync(out).size / 1024)}KB`);
}

async function shootApp(context, { name, data, run, scrollTo, scrollBy }) {
  const page = await context.newPage();
  await bootAuthedApp(page, {
    data,
    sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } },
  });
  await run(page);
  await page.waitForTimeout(600);
  await clearChrome(page);
  if (scrollTo) {
    await page.locator(scrollTo).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(200);
  }
  if (scrollBy) {
    await page.evaluate((y) => window.scrollBy(0, y), scrollBy);
    await page.waitForTimeout(200);
  }
  await writeWebp(context, await page.screenshot(), name);
  await page.close();
}

async function main() {
  await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    // Hero: the crew page, still in Secret.
    await shootApp(context, {
      name: 'crew',
      data: demoData({ crewStatus: 'secret' }),
      run: (p) => p.evaluate(() => openDetail('c1')),
    });

    // Crews tab: the Huddle chat.
    await shootApp(context, {
      name: 'huddle',
      data: demoData(),
      run: (p) => p.evaluate(async () => { await openHuddle('c1'); }),
    });

    // Raves tab: the Rave Plan board for EDC Orlando, with tasks, roles and rides.
    await shootApp(context, {
      name: 'rave-plan',
      data: demoData(),
      run: (p) => p.evaluate(async (me) => {
        const gp = await dbGetOrCreateGamePlan('c1', 'f-edc');
        const rows = [
          { kind: 'task', added_by: 'uid-dani', text: 'Camping passes', is_done: true },
          { kind: 'task', added_by: me, text: 'Buy shuttle wristbands', is_done: true },
          { kind: 'task', added_by: 'uid-tess', text: 'Hydration packs for everyone', is_done: false },
          { kind: 'task', added_by: 'uid-priya', text: 'Totem: the giant disco ball', is_done: false },
        ];
        for (const r of rows) {
          const { data } = await sb.from('game_plan_items').insert({ game_plan_id: gp.id, crew_id: 'c1', ...r }).select().single();
          gamePlanItems.push(data);
        }
        await openDetail('c1', { tab: 'gameplan' });
      }, TEST_UID),
      scrollTo: '#crew-feature-panel-raveplan',
      scrollBy: -96, // clear the sticky app header
    });

    // Ravers tab: a crewmate's profile.
    await shootApp(context, {
      name: 'raver',
      data: demoData(),
      run: (p) => p.evaluate(() => { openProfile('r-dani'); setProfileTab('r-dani', 'vibe'); }),
      scrollBy: 250, // next-rave card just under the sticky header
    });

    // Stats tab.
    await shootApp(context, {
      name: 'stats',
      data: demoData(),
      run: (p) => p.evaluate(() => { switchTab('stats'); loadStatsPage(); }),
      scrollTo: '.stats-section-card:has-text("Rave Passport")',
      scrollBy: 150, // the match above lands on Vibe DNA; this shows Ticket Mix + Passport
    });

    // Lineup Explorer (public, signed-out) with a few picks saved.
    {
      const page = await context.newPage();
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await page.addInitScript(() => {
        try {
          localStorage.setItem('rf_picks', JSON.stringify({
            'edc-orlando-2026': { t: 'EDC Orlando 2026', n: ['SLANDER', 'Kaskade', 'Alison Wonderland', 'San Holo', 'Martin Garrix'] },
          }));
        } catch (e) {}
      });
      await page.goto('/lineup-explorer/edc-orlando-2026.html');
      await page.locator('.lp-f[data-v="picks"]').click();
      await page.locator('.lp-f[data-v="picks"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -16));
      await page.waitForTimeout(800);
      await writeWebp(context, await page.screenshot(), 'lineup');
      await page.close();
    }
  } finally {
    await browser.close();
    if (serverProc) serverProc.kill();
  }
}

main().catch((err) => { console.error(err); if (serverProc) serverProc.kill(); process.exit(1); });
