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

// Base seedData()'s f1/f2 are dated 2099 (intentionally far-future so RSVP
// tests never go stale), which reads as a nonsensical multi-decade countdown
// anywhere a festival's date is actually displayed (crew "next rave up"
// cards, the Raves list, each raver's "next rave" tag). Swap in near-future
// dates for any shot that renders one of these.
function withNearFutureFestivalDates(d) {
  d.festivals = d.festivals.map((f) => {
    if (f.id === 'f1') return { ...f, date: '2026-09-12' };
    if (f.id === 'f2') return { ...f, date: '2026-11-01' };
    return f;
  });
  return d;
}

async function shoot(context, { name, data, run, target }) {
  const page = await context.newPage();
  await bootAuthedApp(page, { data });
  await run(page);
  await page.waitForTimeout(400); // let fire-and-forget dbLoad*().then(rerender*) calls in openDetail() settle
  // Clear chrome that isn't part of the feature being shown: the onboarding
  // tips banner, any queued coachmark bubble (e.g. the "Lost on the floor?"
  // tip that auto-shows over the crew header), any toast fired by seeded
  // data (e.g. badge-unlock side effects), the fixed bottom nav, and the
  // floating QR-scan button -- all of which otherwise visually overlap
  // whatever sits at the top, bottom, or corner of the viewport.
  await page.evaluate(() => {
    if (typeof dismissGuidanceBanner === 'function') { try { dismissGuidanceBanner(); } catch (e) {} }
    if (typeof dismissCoachmark === 'function') { try { dismissCoachmark(); } catch (e) {} }
    const toastEl = document.getElementById('toast');
    if (toastEl) { toastEl.innerHTML = ''; toastEl.className = 'toast'; }
    const navEl = document.querySelector('nav');
    if (navEl) navEl.style.display = 'none';
    const fabEl = document.getElementById('qr-fab');
    if (fabEl) fabEl.style.display = 'none';
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
    // gradient header + member list without guessing exact DOM nesting.
    await shoot(context, {
      name: 'crew-header',
      data: withNearFutureFestivalDates(seedData()),
      run: (p) => p.evaluate(() => openDetail('c1')),
    });

    // 2. dream-board.png -- Dream Board now lives inside a collapsed Overview
    // tile (buildCrewFeatureTilesHTML, only Huddle starts open); open it via
    // toggleCrewFeatureTile before the section is visible enough to shoot.
    {
      const d = seedData();
      d.dream_board_pins = [
        { id: 'pin-1', crew_id: 'c1', added_by: TEST_UID, label: 'Boiler Room Lisbon', created_at: '2026-06-01T00:00:00Z' },
        { id: 'pin-2', crew_id: 'c1', added_by: 'kai-uid', label: 'Awakenings Summer 2027', created_at: '2026-06-02T00:00:00Z' },
      ];
      await shoot(context, {
        name: 'dream-board',
        data: d,
        run: (p) => p.evaluate(() => {
          openDetail('c1');
          toggleCrewFeatureTile('dreamboard', document.querySelector('.crew-feature-tile[data-feature="dreamboard"]'));
        }),
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

    // 4/6/7. vibe-dna.png, rave-passport.png, rave-wrapped.png -- share one seed.
    // Vibe DNA unlocks at 3+ past raves (app.html ~17067); Rave Wrapped needs
    // 5+ past raves AND December, or 3 taps on the hidden star to force-unlock
    // the gate (wrappedStarTap(), app.html:16958) -- so 5 past festivals covers
    // both cards from a single seed.
    function statsSeed() {
      const d = seedData();
      const pastFests = [
        { id: 'f-past-1', name: 'Dekmantel', date: '2023-08-02', location: 'Amsterdam, NL', color: '#00F5FF', days: 4, deleted_at: null },
        { id: 'f-past-2', name: 'Time Warp', date: '2024-04-06', location: 'Mannheim, DE', color: '#BF00FF', days: 1, deleted_at: null },
        { id: 'f-past-3', name: 'Sonar', date: '2024-06-13', location: 'Barcelona, ES', color: '#FF2D78', days: 3, deleted_at: null },
        { id: 'f-past-4', name: 'Circoloco', date: '2024-08-20', location: 'Ibiza, ES', color: '#39FF14', days: 1, deleted_at: null },
        { id: 'f-past-5', name: 'Dimensions', date: '2025-08-27', location: 'Pula, HR', color: '#FF6BA8', days: 4, deleted_at: null },
      ];
      d.festivals.push(...pastFests);
      pastFests.forEach((f) => d.raver_festivals.push({ raver_id: 'r-you', festival_id: f.id }));
      return d;
    }

    await shoot(context, {
      name: 'vibe-dna',
      data: statsSeed(),
      run: (p) => p.evaluate(() => { switchTab('stats'); loadStatsPage(); }),
      target: '.stats-section-card:has-text("Vibe DNA")',
    });

    await shoot(context, {
      name: 'rave-passport',
      data: statsSeed(),
      run: (p) => p.evaluate(() => { switchTab('stats'); loadStatsPage(); }),
      target: '.stats-section-card:has-text("Rave Passport")',
    });

    await shoot(context, {
      name: 'rave-wrapped',
      data: statsSeed(),
      run: (p) => p.evaluate(() => {
        switchTab('stats');
        loadStatsPage();
        wrappedStarTap(); wrappedStarTap(); wrappedStarTap(); // force-unlocks Wrapped outside December
        openWrapped();
      }),
      target: '#wrapped-card',
    });

    // 5. crew-jams.png -- Jams tile also starts collapsed; open it (see the
    // dream-board.png note above for why).
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
        run: (p) => p.evaluate(() => {
          openDetail('c1');
          toggleCrewFeatureTile('jams', document.querySelector('.crew-feature-tile[data-feature="jams"]'));
        }),
        target: '#jam-section',
      });
    }

    // 8. fam-poll.png -- needs votes (not just a bare poll) to render result
    // bars instead of an empty ballot; TEST_UID voting makes hasVoted true.
    // Poll tile also starts collapsed.
    {
      const d = seedData();
      d.crew_polls = [{
        id: 'poll-1', crew_id: 'c1', created_by: TEST_UID,
        question: 'Opener or headliner?', poll_type: 'choice',
        options: ['Opener', 'Headliner'], is_anonymous: false,
        expires_at: null, deleted_at: null, created_at: '2026-06-01T00:00:00Z',
      }];
      d.crew_poll_votes = [
        { poll_id: 'poll-1', voter_user_id: TEST_UID, vote_value: '1' },
        { poll_id: 'poll-1', voter_user_id: 'kai-uid', vote_value: '1' },
        { poll_id: 'poll-1', voter_user_id: 'sam-uid', vote_value: '0' },
      ];
      await shoot(context, {
        name: 'fam-poll',
        data: d,
        run: (p) => p.evaluate(() => {
          openDetail('c1');
          toggleCrewFeatureTile('poll', document.querySelector('.crew-feature-tile[data-feature="poll"]'));
        }),
        target: '#fam-poll-section',
      });
    }

    // 9. archive-links.png -- Archive tile also starts collapsed.
    {
      const d = seedData();
      d.crew_archive_links = [{
        id: 'link-1', crew_id: 'c1', added_by: TEST_UID,
        url: 'https://youtube.com/watch?v=example',
        label: 'Boiler Room aftermovie', festival_id: null, deleted_at: null, created_at: '2026-06-01T00:00:00Z',
      }];
      await shoot(context, {
        name: 'archive-links',
        data: d,
        run: (p) => p.evaluate(() => {
          openDetail('c1');
          toggleCrewFeatureTile('archive', document.querySelector('.crew-feature-tile[data-feature="archive"]'));
        }),
        target: '#archive-section',
      });
    }

    // 10. our-photos.png -- a pairwise shared-photo feature between "you" and
    // one other raver (viewed on their profile), not a crew-wide gallery.
    // photo_url points at existing repo assets served by the local static
    // server. og-preview-1.png crops awkwardly here (off-center screenshot
    // content, reads as a mistake rather than a photo) -- og-image.png and
    // og-preview-2.png are both centered wordmark art that crop cleanly.
    {
      const d = seedData();
      d.our_photos = [
        { uploader_user_id: TEST_UID, raver_a_id: 'r-sam', raver_b_id: 'r-you', photo_url: `${BASE_URL}/og-image.png`, deleted_at: null },
        { uploader_user_id: 'sam-uid', raver_a_id: 'r-sam', raver_b_id: 'r-you', photo_url: `${BASE_URL}/og-preview-2.png`, deleted_at: null },
      ];
      await shoot(context, {
        name: 'our-photos',
        data: d,
        run: (p) => p.evaluate(() => openProfile('r-sam')),
        target: '#our-photos-async-wrap',
      });
    }

    // 11. raves-list.png
    await shoot(context, {
      name: 'raves-list',
      data: withNearFutureFestivalDates(seedData()),
      run: (p) => p.evaluate(() => switchTab('events')),
      target: '#events-list',
    });

    // 12. ravers-list.png -- base seedData()'s 3 ravers already populate this
    // (the page lists every raver you own/created/claimed app-wide, not just
    // one crew's members); still needs the near-future date fix since each
    // raver's card shows their own "next rave" countdown.
    await shoot(context, {
      name: 'ravers-list',
      data: withNearFutureFestivalDates(seedData()),
      run: (p) => p.evaluate(() => switchTab('members')),
      target: '#members-grid',
    });

    // 13. game-plan.png -- Checklist section of the Game Plan hub. A Game Plan
    // only appears for a rave both "you" and a crewmate are attending; base
    // seedData() already has r-you + r-sam both RSVP'd to f1, so the tab
    // exists without extra wiring. Default active section is Huddle (a live
    // chat, unfit for a static shot) -- switch to Checklist after the async
    // game-plan load settles.
    {
      const d = withNearFutureFestivalDates(seedData());
      d.game_plans = [{
        id: 'gp-1', crew_id: 'c1', festival_id: 'f1',
        theme_text: null, meetup_at: null, meetup_location: null,
        created_by: TEST_UID, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
      }];
      d.game_plan_items = [
        { id: 'gpi-1', game_plan_id: 'gp-1', crew_id: 'c1', kind: 'task', added_by: TEST_UID, text: 'Grab tickets', phase: 'before_we_leave', assignee_raver_id: 'r-you', is_done: true, seats: null, driver_item_id: null, created_at: '2026-06-01T00:00:00Z', deleted_at: null },
        { id: 'gpi-2', game_plan_id: 'gp-1', crew_id: 'c1', kind: 'task', added_by: TEST_UID, text: 'Charge glowsticks + portable battery', phase: 'night_before', assignee_raver_id: 'r-sam', is_done: false, seats: null, driver_item_id: null, created_at: '2026-06-01T00:01:00Z', deleted_at: null },
        { id: 'gpi-3', game_plan_id: 'gp-1', crew_id: 'c1', kind: 'task', added_by: TEST_UID, text: 'Book the Airbnb', phase: 'before_we_leave', assignee_raver_id: null, is_done: false, seats: null, driver_item_id: null, created_at: '2026-06-01T00:02:00Z', deleted_at: null },
        { id: 'gpi-4', game_plan_id: 'gp-1', crew_id: 'c1', kind: 'task', added_by: TEST_UID, text: 'Print the tickets / screenshot the QR', phase: null, assignee_raver_id: null, is_done: false, seats: null, driver_item_id: null, created_at: '2026-06-01T00:03:00Z', deleted_at: null },
      ];
      await shoot(context, {
        name: 'game-plan',
        data: d,
        run: async (p) => {
          await p.evaluate(() => openDetail('c1'));
          await p.evaluate(() => {
            const gpBtn = document.querySelector('#page-crew-detail .stats-subtab[data-tab="gameplan"]');
            switchCrewDetailTab('gameplan', gpBtn);
          });
          await p.waitForTimeout(500); // openGamePlanTab's game_plans/game_plan_items/huddle_rooms round-trips
          await p.evaluate(() => {
            const checklistBtn = document.querySelector('#crew-detail-panel-gameplan .game-plan-section-tab[data-section="checklist"]');
            switchGamePlanSection('checklist', checklistBtn);
          });
        },
        target: '#game-plan-section-checklist',
      });
    }

    // 14. plur-points.png -- PLUR Points crew leaderboard on Stats > Crew
    // Stats. get_leaderboard/get_my_rank/get_raver_points are security-definer
    // RPCs re-implemented in tests/helpers.js's mock (same pattern as the
    // other RPCs already stubbed there) against a seeded point_totals table.
    {
      const d = seedData();
      d.point_totals = [
        { raver_id: 'r-you', peace_points: 40, love_points: 65, unity_points: 20, respect_points: 15, leaderboard_visible: true },
        { raver_id: 'r-kai', peace_points: 30, love_points: 20, unity_points: 50, respect_points: 10, leaderboard_visible: true },
        { raver_id: 'r-sam', peace_points: 10, love_points: 5, unity_points: 5, respect_points: 0, leaderboard_visible: true },
      ];
      await shoot(context, {
        name: 'plur-points',
        data: d,
        run: async (p) => {
          await p.evaluate(() => { switchTab('stats'); loadStatsPage(); });
          await p.evaluate(() => {
            const crewBtn = document.querySelector('.stats-subtab[onclick*="crew"]');
            switchStatTab('crew', crewBtn);
          });
          await p.waitForTimeout(500); // loadAndRenderPlurLeaderboard's RPC round-trip
        },
        target: '#plur-leaderboard-wrap',
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
