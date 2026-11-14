#!/usr/bin/env node
// Captures the phone screenshots shown on the feature guide (guide.html)
// that differ from the landing page's. Reuses the landing script's mocked
// harness and fictional demo crew, so there's no login, no live backend and
// no real user data. Shots the guide shares with the landing page stay in
// screenshots/landing/ (scripts/capture-landing-screenshots.js).
//   node scripts/capture-guide-screenshots.js
// Output: screenshots/guide/*.webp (served; referenced from guide.html).
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { startServer, stopServer, demoData, shootApp, writeWebp, clearChrome, BASE_URL } = require('./capture-landing-screenshots');
const { installSupabaseStub } = require('../tests/helpers');

const OUT_DIR = path.join(__dirname, '..', 'screenshots', 'guide');

// The landing demo's one upcoming rave (EDC Orlando, Nov 6) has passed, which
// empties "Raves on Your Radar". Swap in a real rave that's still ahead
// (dates/venue from lineup-explorer/lights-all-night-2026.html), keeping the
// id so the crew's RSVPs carry over. Guide shots only.
function guideData() {
  const data = demoData();
  const f = data.festivals.find((x) => x.id === 'f-edc');
  if (f) Object.assign(f, { name: 'Lights All Night', date: '2026-12-30', days: 2, location: 'Fair Park, Dallas TX', color: '#BF00FF' });

  // Sets "you" checked off at the five past raves, so Stats' Artists Seen
  // tile shows a count instead of a dash (only the count is on screen).
  const seenAt = {
    'p-lost': ['Excision', 'Subtronics', 'Illenium', 'Zeds Dead', 'Svdden Death'],
    'p-okee': ['Kaskade', 'John Summit', 'GRiZ', 'Odesza'],
    'p-ultra': ['Martin Garrix', 'Tiësto', 'Armin van Buuren', 'Afrojack', 'Kaskade'],
    'p-edclv': ['Alison Wonderland', 'SLANDER', 'Above & Beyond', 'Gryffin', 'Illenium'],
    'p-forest': ['Subtronics', 'GRiZ', 'Seven Lions', 'Odesza', 'Tape B'],
  };
  const byName = new Map(data.artists.map((a) => [a.name, a]));
  Object.values(seenAt).flat().forEach((name) => {
    if (!byName.has(name)) { const a = { id: `ga-${byName.size}`, name, genres: [] }; byName.set(name, a); data.artists.push(a); }
  });
  data.raver_artist_sightings = Object.entries(seenAt).flatMap(([festival_id, names]) =>
    names.map((name) => ({ raver_id: 'r-you', artist_id: byName.get(name).id, festival_id })));
  return data;
}

// Crew extras: a couple of Dream Board pins, a voted poll and a shared jam.
function guideExtrasData() {
  const data = guideData();
  const t = '2026-10-01T00:00:00Z';
  data.dream_board_pins = [
    { id: 'pin-1', crew_id: 'c1', added_by: 'uid-tess', label: 'Tomorrowland 2027', created_at: t },
    { id: 'pin-2', crew_id: 'c1', added_by: 'uid-kai', label: 'Sunrise set at Lost Lands', created_at: t },
    { id: 'pin-3', crew_id: 'c1', added_by: 'uid-priya', label: 'Matching LED fits for EDC', created_at: t },
  ];
  data.crew_polls = [{
    id: 'poll-1', crew_id: 'c1', created_by: 'uid-dani', question: 'Camp together or get separate spots?',
    poll_type: 'choice', options: ['Camp together', 'Separate spots'], is_anonymous: false,
    expires_at: null, deleted_at: null, created_at: t,
  }];
  data.crew_poll_votes = ['uid-dani', 'uid-kai', 'uid-tess', 'uid-marco'].map((u, i) => ({ poll_id: 'poll-1', voter_user_id: u, vote_value: i === 3 ? '1' : '0' }));
  data.crew_jams = [{
    id: 'jam-1', crew_id: 'c1', added_by: 'uid-tess', url: 'https://open.spotify.com/playlist/example',
    platform: 'spotify', title: 'Lights All Night pregame', cover_url: null, track_count: 32, tag: 'bass',
    description: 'Warming up for Dallas.', festival_id: null, reactions: {}, created_at: t,
  }];
  return data;
}

// Vendor Village: a few fictional festival vendors with reviews.
function guideVillageData() {
  const data = guideData();
  const t = '2026-10-01T00:00:00Z';
  const v = (id, name, category, description, sponsor_priority = 0) => ({
    id, name, category, description, created_by: 'uid-kai', website_url: null, instagram: null,
    discount_code: null, discount_description: null, sponsor_priority, deleted_at: null, created_at: t,
  });
  data.vendors = [
    v('v1', 'Neon Kandi Co.', 'jewelry_kandi', 'Custom kandi cuffs and PLUR trade bracelets, made to order.'),
    v('v2', 'Glow Threads', 'apparel_merch', 'Reflective festival fits and rave sets in every size.'),
    v('v3', 'Hydrate Collective', 'safety_comfort', 'Hydration packs, earplugs and cooling towels.'),
    v('v4', 'Totem Lab', 'gear_accessories', 'LED totems built to be seen from the back of the crowd.'),
  ];
  data.vendor_reviews = [
    ['v1', 'uid-dani', 5], ['v1', 'uid-tess', 5], ['v2', 'uid-kai', 4], ['v3', 'uid-priya', 5], ['v4', 'uid-marco', 5],
  ].map(([vendor_id, raver_id, rating], i) => ({ id: `rev-${i}`, vendor_id, raver_id, rating, body: null, photo_url: null, attribute_tags: null, deleted_at: null, created_at: t }));
  return data;
}

// The profile shot shows the founder's real profile (photo, name, handle, city,
// Instagram; used with their permission) on the demo crewmate's slot. The
// how-we-met story is cleared so nothing fictional is attributed to a real
// person; the vibe tags and sound stay as demo content.
function guideProfileData() {
  const data = guideData();
  const r = data.ravers.find((x) => x.id === 'r-dani');
  if (r) Object.assign(r, { name: 'Theile', handle: 'theile', avatar_url: '/scripts/landing-avatars/theile.jpg', base: 'Lakewood Ranch, FL', instagram: 'the_theile', met_story: '' });
  return data;
}

async function main() {
  await startServer();
  // CHROMIUM_PATH: use a preinstalled Chrome when Playwright's own browser isn't downloaded.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  // A fresh context per shot: a second app boot in one context never shows
  // #main-app here, so each capture starts clean.
  const shoot = async (opts) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    try { await shootApp(context, { outDir: OUT_DIR, ...opts }); } finally { await context.close(); }
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    // Ravers tab: a profile from the top, so the photo and name show.
    await shoot({
      name: 'raver',
      data: guideProfileData(),
      run: (p) => p.evaluate(() => {
        window.scrollTo(0, 0); openProfile('r-dani'); setProfileTab('r-dani', 'vibe');
        // The rainbow ring spins and the photo inside spins with it; hold it upright.
        document.querySelectorAll('.profile-avatar-ring').forEach((el) => { el.style.animation = 'none'; });
      }),
    });

    // Stats tab from the top: the headline numbers, not Ticket Mix + Passport.
    await shoot({
      name: 'stats',
      data: guideData(),
      run: (p) => p.evaluate(() => { window.scrollTo(0, 0); switchTab('stats'); loadStatsPage(); }),
    });

    // Getting in: the signed-out sign-up screen (email or phone, no password).
    {
      const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
      try {
        const page = await context.newPage();
        await installSupabaseStub(page, { session: null, data: {} });
        await page.goto('/app.html?tab=signup');
        await page.waitForTimeout(1500);
        await clearChrome(page);
        // RaveFAM is out of beta; the app's old BETA banner stays out of the guide.
        await page.evaluate(() => document.querySelectorAll('.landing-beta').forEach((el) => el.style.setProperty('display', 'none', 'important')));
        await writeWebp(context, await page.screenshot(), 'join', OUT_DIR);
      } finally { await context.close(); }
    }

    // Crew extras: the feature tiles with Dream Board open below them
    // (the crew page shows one panel at a time).
    await shoot({
      name: 'crew-extras',
      data: guideExtrasData(),
      run: (p) => p.evaluate(() => {
        openDetail('c1');
        toggleCrewFeatureTile('dreamboard', document.querySelector('.crew-feature-tile[data-feature="dreamboard"]'));
      }),
      scrollTo: '.crew-feature-tile[data-feature="huddle"]',
      scrollBy: -100,
    });

    // Raves tab.
    await shoot({
      name: 'raves',
      data: guideData(),
      run: (p) => p.evaluate(() => { window.scrollTo(0, 0); switchTab('events'); }),
    });

    // Vendor Village.
    await shoot({
      name: 'vendor-village',
      data: guideVillageData(),
      run: (p) => p.evaluate(() => { window.scrollTo(0, 0); switchTab('checklist'); renderVillage(); }),
    });

    // Safety & help: Settings > Privacy & Notifications.
    await shoot({
      name: 'privacy',
      data: guideData(),
      run: (p) => p.evaluate(() => { window.scrollTo(0, 0); openPrivacySettingsModal('r-you'); }),
    });
  } finally {
    await browser.close();
    stopServer();
  }
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
