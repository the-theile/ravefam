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
const { startServer, stopServer, demoData, shootApp, BASE_URL } = require('./capture-landing-screenshots');

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
  } finally {
    await browser.close();
    stopServer();
  }
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
