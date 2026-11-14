#!/usr/bin/env node
// Captures the Dreamstate SoCal 2026 Game Plan carousel screens from the real
// app.html, booted on the mocked-Supabase harness (tests/helpers.js): no login,
// no live backend, no real user data. The crew is fictional; the festival and
// artists are real, and SETS holds the official set times.
// Run from the repo root: node marketing/dreamstate-socal-2026/_build/capture.js
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { bootAuthedApp, TEST_UID } = require('../../../tests/helpers');

const PORT = 4323;
const REPO = path.join(__dirname, '..', '..', '..');
const OUT = path.join(__dirname, 'shots');
const NOW = new Date('2026-11-13T21:00:00-08:00'); // night before posting: T-minus reads 6d
let BASE = NOW; // the shot's clock; message times are relative to it
const minsAgo = (m) => new Date(BASE.getTime() - m * 60000).toISOString();
const ADDED = '2026-03-01T00:00:00Z';

const GRADS = ['linear-gradient(135deg,#FF2D78,#BF00FF)', 'linear-gradient(135deg,#00F5FF,#39FF14)',
  'linear-gradient(135deg,#BF00FF,#FF2D78)', 'linear-gradient(135deg,#FFD600,#FF2D78)',
  'linear-gradient(135deg,#39FF14,#00F5FF)', 'linear-gradient(135deg,#FF6BA8,#FFD600)'];
// [id, name, handle, uid, avatar]
const PEOPLE = [
  ['r-you', 'Alex R.', 'alexr', TEST_UID, 'alex.jpg'],
  ['r-dani', 'Dani V.', 'danivibes', 'uid-dani', 'dani.svg'],
  ['r-tess', 'Tess K.', 'tesswubs', 'uid-tess', 'tess.svg'],
  ['r-kai', 'Kai M.', 'kaibeats', 'uid-kai', 'kai.jpg'],
  ['r-marco', 'Marco D.', 'marcod', 'uid-marco', 'marco.svg'],
  ['r-priya', 'Priya S.', 'priyaplur', 'uid-priya', 'priya.svg'],
];
const UID = Object.fromEntries(PEOPLE.map(p => [p[0], p[3]]));

// Official set times (Pacific), from artist_festival_appearances on Nov 14 2026.
// [id, artist as billed, start, end, stage, who's catching it]
const SETS = [
  ['a4', 'ARTBAT', '2026-11-21T00:00', '2026-11-21T01:00', 'The Dream', ['r-kai', 'r-you', 'r-tess']],
  ['a2', 'Ferry Corsten + Marsh', '2026-11-21T22:00', '2026-11-21T23:00', 'The Dream', ['r-you', 'r-dani', 'r-marco', 'r-priya']],
  ['a1', 'Vini Vici', '2026-11-21T22:00', '2026-11-21T23:00', 'The Sequence', ['r-kai', 'r-tess']],
  ['a5', 'Above & Beyond (Anjunabeats Classics)', '2026-11-21T23:00', '2026-11-22T01:00', 'The Dream', ['r-you', 'r-dani', 'r-tess', 'r-kai', 'r-marco', 'r-priya']],
  ['a3', 'Paul van Dyk pres The Essence of Acid', '2026-11-21T23:45', '2026-11-22T01:00', 'The Void', ['r-dani', 'r-priya', 'r-marco']],
];
const pst = (s) => new Date(s + ':00-08:00').toISOString();
const MEET_SPOT = 'Under the Queen Mary bow, by the big light tunnel';

function data() {
  const ravers = PEOPLE.map(([id, name, handle, uid, av], i) => ({
    id, name, handle, is_you: id === 'r-you', created_by: TEST_UID, claimed_by: uid, status: 'claimed',
    base: 'Los Angeles, CA', gradient: GRADS[i], avatar_url: `/scripts/landing-avatars/${av}`, blocked_tags: [],
    genres: ['Trance'], instagram: '', radiate: '', phone: '', phone_visible: false, met_story: '', notes: '',
    qr_token: `qr-${id}`, vibe_tags: [], custom_vibe_tags: [], deleted_at: null,
  }));
  const room = { id: 'room-ds', crew_id: 'c1', room_key: 'festival:f-ds', kind: 'festival', name: 'Dreamstate SoCal Huddle', festival_id: 'f-ds', created_by: TEST_UID, created_at: ADDED };
  const msg = (i, sender, body, m, extra = {}) => ({ id: `m${i}`, room_id: 'room-ds', crew_id: 'c1', sender_id: sender, kind: 'text', body,
    reactions: {}, created_at: minsAgo(m), deleted_at: null, mentions: [], ...extra });
  return {
    festivals: [{ id: 'f-ds', name: 'Dreamstate SoCal', slug: 'dreamstate-socal-2026', date: '2026-11-20', days: 2,
      location: 'Queen Mary Waterfront, Long Beach CA', color: '#00F5FF', timezone: 'America/Los_Angeles', deleted_at: null }],
    ravers,
    crews: [{ id: 'c1', name: 'Trance Fam', color: '#00F5FF', gradient: 'linear-gradient(90deg,#FF2D78,#00F5FF)', status: 'recruiting',
      leader_id: TEST_UID, totem_photo_url: null, totem_icon: '🌀', invite_token: 'inv-c1', created_at: ADDED, deleted_at: null }],
    crew_members: ravers.map(r => ({ crew_id: 'c1', raver_id: r.id, added_at: ADDED, added_by: TEST_UID, deleted_at: null })),
    raver_festivals: ravers.map(r => ({ raver_id: r.id, festival_id: 'f-ds', ticket_type: 'ga' })),
    raver_festival_interest: [],
    artists: SETS.map(([id, name]) => ({ id, name, name_lower: name.toLowerCase(), genres: ['trance'] })),
    artist_festival_appearances: SETS.map(([id, , s, e, stage]) => ({ artist_id: id, festival_id: 'f-ds', start_at: pst(s), end_at: pst(e), stage, night: null })),
    raver_artist_plans: SETS.flatMap(([id, , , , , who]) => who.map(r => ({ raver_id: r, artist_id: id, festival_id: 'f-ds' }))),
    raver_favorite_artists: [],
    game_plans: [{ id: 'gp1', crew_id: 'c1', festival_id: 'f-ds', created_by: TEST_UID, meetup_at: pst('2026-11-20T18:30'),
      meetup_location: MEET_SPOT, theme_text: 'Night one: all white. Night two: holo.', created_at: ADDED }],
    game_plan_items: [
      ['g1', 'carpool_driver', UID['r-marco'], 'r-marco', { seats: 4, vibe_tag: 'Anjunabeats only' }],
      ['g2', 'carpool_rider', UID['r-dani'], 'r-dani', { driver_item_id: 'g1' }],
      ['g3', 'carpool_rider', UID['r-priya'], 'r-priya', { driver_item_id: 'g1' }],
      ['g4', 'carpool_driver', TEST_UID, 'r-you', { seats: 3, vibe_tag: 'psy warmup' }],
      ['g5', 'carpool_rider', UID['r-tess'], 'r-tess', { driver_item_id: 'g4' }],
      ['g6', 'carpool_rider', UID['r-kai'], 'r-kai', { driver_item_id: 'g4' }],
      ...PEOPLE.map(([id, , , uid], i) => [`rd${i}`, 'ready', uid, id, { is_done: true }]),
    ].map(([id, kind, by, raver, extra], i) => ({ id, game_plan_id: 'gp1', crew_id: 'c1', kind, added_by: by, assignee_raver_id: raver,
      is_done: false, created_at: minsAgo(3000 - i), deleted_at: null, ...extra })),
    set_meetups: [{ id: 'sm1', crew_id: 'c1', festival_id: 'f-ds', artist_id: 'a5', spot: 'Left of the sound booth', meet_at: pst('2026-11-21T22:45'), created_by: TEST_UID }],
    huddle_rooms: [room, { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: ADDED }],
    huddle_messages: [
      msg(0, 'uid-dani', '6 DAYS 😭 who is ready', 64),
      msg(1, 'uid-marco', "I've got 2 seats left. Anjunabeats the whole drive, no skips", 58),
      msg(2, TEST_UID, 'meetup is pinned 👇 6:30 Friday, phones die fast', 41),
      msg(3, TEST_UID, MEET_SPOT, 40, { kind: 'meetup', meetup_at: pst('2026-11-20T18:30') }),
      msg(4, 'uid-tess', 'locked in ✅', 33, { reactions: { '💙': ['uid-kai', 'uid-dani'] } }),
      msg(5, 'uid-kai', 'locked in. ARTBAT at midnight Friday or bust', 21),
      msg(6, 'uid-priya', 'locked in 🪩 bringing the kandi', 9, { reactions: { '🔥': ['uid-dani', 'uid-tess', 'uid-marco'] } }),
    ],
    huddle_room_reads: [{ room_id: 'room-ds', user_id: TEST_UID, last_read_at: minsAgo(1) }],
  };
}

async function clearChrome(page) {
  await page.evaluate(() => {
    try { if (typeof dismissGuidanceBanner === 'function') dismissGuidanceBanner(); } catch (e) {}
    const t = document.getElementById('toast'); if (t) { t.innerHTML = ''; t.className = 'toast'; }
    const fab = document.getElementById('qr-fab'); if (fab) fab.style.display = 'none';
  });
  for (let i = 0; i < 4; i++) {
    const showing = await page.evaluate(() => {
      if (typeof dismissCoachmark !== 'function') return false;
      const el = document.getElementById('coachmark'); const was = !!(el && el.classList.contains('show'));
      try { dismissCoachmark(); } catch (e) {} return was;
    });
    if (!showing) break;
    await page.waitForTimeout(200);
  }
}

let browser;
async function shoot(_, name, run, after, clock = NOW) {
  const ctx = await browser.newContext({ baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark', timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => console.warn(`[${name}] pageerror:`, e.message));
  BASE = clock;
  await page.clock.setFixedTime(clock);
  await bootAuthedApp(page, { data: data(), sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await run(page);
  await page.waitForTimeout(700);
  await clearChrome(page);
  if (after) { await after(page); await page.waitForTimeout(250); }
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot', name);
  await ctx.close();
}

const toSection = (sec) => async (p) => {
  await p.evaluate(async (s) => { await openDetail('c1', { tab: 'gameplan' }); await new Promise(r => setTimeout(r, 600));
    const b = document.querySelector(`#crew-feature-panel-raveplan .game-plan-section-tab[data-section="${s}"]`); if (b) b.click(); }, sec);
};
const scrollTo = (sel, by = -96) => (p) => p.evaluate(([s, y]) => { const el = document.querySelector(s); if (el) { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, y); } }, [sel, by]);

(async () => {
  const srv = spawn('node', ['tests/static-server.js', String(PORT)], { cwd: REPO });
  await new Promise(r => setTimeout(r, 1500));
  browser = await chromium.launch();
  const ctx = null;
  try {
    
    await shoot(ctx, 'plan-lineup', toSection('lineup'), scrollTo('#game-plan-section-lineup', -175));
    
    for (const card of ['cover', 'logistics', 'meetup'])
      await shoot(ctx, 'mb-' + card, (p) => p.evaluate(c => openMissionBriefing('c1', 'f-ds', c), card));
    // Huddle header countdown rounds 6d+ evenings up to "1 wk"; shoot it the next morning.
    await shoot(ctx, 'huddle', (p) => p.evaluate(() => openHuddle('c1', { festivalId: 'f-ds' })), null, new Date('2026-11-14T10:00:00-08:00'));
  } finally { await browser.close(); srv.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
