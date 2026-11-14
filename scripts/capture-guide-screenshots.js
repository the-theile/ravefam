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
  return data;
}

async function main() {
  await startServer();
  // CHROMIUM_PATH: use a preinstalled Chrome when Playwright's own browser isn't downloaded.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    // Stats tab from the top: the headline numbers, not Ticket Mix + Passport.
    await shootApp(context, {
      name: 'stats',
      outDir: OUT_DIR,
      data: guideData(),
      run: (p) => p.evaluate(() => { window.scrollTo(0, 0); switchTab('stats'); loadStatsPage(); }),
    });
  } finally {
    await browser.close();
    stopServer();
  }
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
