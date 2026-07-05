#!/usr/bin/env node
// Captures screenshots of specific app.html features for embedding in the
// drip campaign emails (supabase/functions/send-drip-emails/index.ts).
//
// Reuses the Playwright test suite's mocked-Supabase harness
// (tests/helpers.js) so this needs no real login, no live backend, and no
// real user data -- just like the existing *.spec.js tests. Deliberately
// lives outside tests/ (playwright.config.js's testDir) so `npm test` / CI
// never picks it up. Run with: node scripts/capture-email-screenshots.js
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('../tests/helpers');

const PORT = 4321;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'screenshots', 'email');

let serverProc = null;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn('node', ['tests/static-server.js', String(PORT)], { cwd: REPO_ROOT });
    let settled = false;
    const onReady = () => { if (!settled) { settled = true; resolve(); } };
    serverProc.stdout.on('data', (d) => {
      if (d.toString().includes('listening')) onReady();
    });
    serverProc.stderr.on('data', (d) => process.stderr.write(d));
    serverProc.on('error', reject);
    // Fallback in case the log line format ever changes.
    setTimeout(onReady, 1500);
  });
}

function stopServer() {
  if (serverProc) serverProc.kill();
}

async function shoot(context, { name, data, run, target }) {
  const page = await context.newPage();
  await bootAuthedApp(page, { data });
  await run(page);
  await page.waitForTimeout(400); // let fire-and-forget dbLoad*().then(rerender*) calls in openDetail() settle
  // Clear chrome that isn't part of the feature being shown: the onboarding
  // tips banner, any toast fired by seeded data (e.g. badge-unlock side
  // effects), and the fixed bottom nav (which otherwise visually overlaps
  // whatever content happens to sit at the bottom of the viewport).
  await page.evaluate(() => {
    if (typeof dismissGuidanceBanner === 'function') { try { dismissGuidanceBanner(); } catch (e) {} }
    const toastEl = document.getElementById('toast');
    if (toastEl) { toastEl.innerHTML = ''; toastEl.className = 'toast'; }
    const navEl = document.querySelector('nav');
    if (navEl) navEl.style.display = 'none';
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${name}.png`);
  if (target) {
    await page.locator(target).first().screenshot({ path: outPath });
  } else {
    await page.screenshot({ path: outPath });
  }
  console.log('wrote', path.relative(REPO_ROOT, outPath));
  await page.close();
}

async function main() {
  await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  try {
    // 1. crew-header.png -- base seedData() already has crew c1 "Bass Syndicate"
    // with 3 members; a plain viewport shot at the top of the page frames the
    // gradient header + member list without guessing exact DOM nesting. The
    // base seed's festival is dated 2099 (intentionally far-future so RSVP
    // tests never go stale) which reads as a nonsensical "889 months" on a
    // "next rave up" card -- swap in a near-future date just for this shot.
    await shoot(context, {
      name: 'crew-header',
      data: (() => {
        const d = seedData();
        d.festivals = d.festivals.map((f) => (f.id === 'f1' ? { ...f, date: '2026-09-12' } : f));
        return d;
      })(),
      run: (p) => p.evaluate(() => openDetail('c1')),
    });

    // 2. dream-board.png
    {
      const d = seedData();
      d.dream_board_pins = [
        { id: 'pin-1', crew_id: 'c1', added_by: TEST_UID, label: 'Boiler Room Lisbon', created_at: '2026-06-01T00:00:00Z' },
        { id: 'pin-2', crew_id: 'c1', added_by: 'kai-uid', label: 'Awakenings Summer 2027', created_at: '2026-06-02T00:00:00Z' },
      ];
      await shoot(context, {
        name: 'dream-board',
        data: d,
        run: (p) => p.evaluate(() => openDetail('c1')),
        target: '#dream-board-section',
      });
    }

    // 3. raves-together.png -- mirrors tests/raves-together.spec.js's shared-history seed
    {
      const d = seedData();
      d.festivals.push({ id: 'f-past', name: 'Boom Festival', date: '2024-08-10', location: 'Idanha-a-Nova, PT', color: '#39FF14', days: 5, deleted_at: null });
      d.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-past' });
      d.raver_festivals.push({ raver_id: 'r-sam', festival_id: 'f-past' });
      await shoot(context, {
        name: 'raves-together',
        data: d,
        run: (p) => p.evaluate(() => openProfile('r-sam')),
        target: '.raves-together-hero',
      });
    }

    // 4. vibe-dna.png -- Vibe DNA unlocks at 3+ past raves for the logged-in user (app.html ~17067)
    {
      const d = seedData();
      const pastFests = [
        { id: 'f-past-1', name: 'Dekmantel', date: '2023-08-02', location: 'Amsterdam, NL', color: '#00F5FF', days: 4, deleted_at: null },
        { id: 'f-past-2', name: 'Time Warp', date: '2024-04-06', location: 'Mannheim, DE', color: '#BF00FF', days: 1, deleted_at: null },
        { id: 'f-past-3', name: 'Sonar', date: '2024-06-13', location: 'Barcelona, ES', color: '#FF2D78', days: 3, deleted_at: null },
      ];
      d.festivals.push(...pastFests);
      pastFests.forEach((f) => d.raver_festivals.push({ raver_id: 'r-you', festival_id: f.id }));
      await shoot(context, {
        name: 'vibe-dna',
        data: d,
        run: (p) => p.evaluate(() => { switchTab('stats'); loadStatsPage(); }),
        target: '.stats-section-card:has-text("Vibe DNA")',
      });
    }

    // 5. crew-jams.png
    {
      const d = seedData();
      d.crew_jams = [{
        id: 'jam-1', crew_id: 'c1', added_by: TEST_UID,
        url: 'https://open.spotify.com/playlist/example',
        platform: 'spotify', title: 'Pregame Warmup', cover_url: null,
        track_count: 24, tag: 'techno', description: 'Getting hyped before doors open.',
        festival_id: null, reactions: {}, created_at: '2026-06-01T00:00:00Z',
      }];
      await shoot(context, {
        name: 'crew-jams',
        data: d,
        run: (p) => p.evaluate(() => openDetail('c1')),
        target: '#jam-section',
      });
    }
  } finally {
    await browser.close();
    stopServer();
  }
}

main().catch((err) => {
  console.error(err);
  stopServer();
  process.exit(1);
});
