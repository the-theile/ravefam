#!/usr/bin/env node
// Captures the raw phone screens for the Tapesgiving Instagram carousel
// (marketing/tapesgiving-2026/). Real app UI only:
//   - Lineup Explorer: the real tapesgiving-2026 page (signed-out view).
//   - Crew page + Game Plan carpool + poll: app.html on the mocked-Supabase
//     harness with the fictional demo crew (no login, no real user data).
//     Everyone gets an illustrated avatar, never a real photo.
//   node marketing/tapesgiving-2026/_build/capture.js
// Output: marketing/tapesgiving-2026/_build/shots/*.png
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { startServer, stopServer, demoData, clearChrome, BASE_URL } = require('../../../scripts/capture-landing-screenshots');
const { bootAuthedApp, TEST_UID } = require('../../../tests/helpers');

const OUT_DIR = path.join(__dirname, 'shots');

// Demo crew, with Tapesgiving (Nov 27–28, The BayCare Sound) as the one
// upcoming rave. Same id as the landing demo so RSVPs carry over.
function igData() {
  const data = demoData();
  const f = data.festivals.find((x) => x.id === 'f-edc');
  Object.assign(f, { name: 'Tapesgiving', date: '2026-11-27', days: 2, location: 'The BayCare Sound, Clearwater FL', color: '#FF2D78' });
  data.ravers.forEach((r) => { if (r.avatar_url) r.avatar_url = r.avatar_url.replace(/\.jpg$/, '.svg'); });
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  data.crew_polls = [{
    id: 'poll-1', crew_id: 'c1', created_by: 'uid-dani', question: 'Meetup spot before Tape B Friday?',
    poll_type: 'choice', options: ['Merch tent', 'Sound booth', 'Left rail'], is_anonymous: false,
    expires_at: null, deleted_at: null, created_at: ago(1),
  }];
  data.crew_poll_votes = [['uid-dani', '1'], ['uid-kai', '1'], ['uid-tess', '2'], ['uid-marco', '1'], ['uid-priya', '0'], [TEST_UID, '1']]
    .map(([u, v]) => ({ poll_id: 'poll-1', voter_user_id: u, vote_value: v }));
  return data;
}

async function boot(context, data) {
  const page = await context.newPage();
  await bootAuthedApp(page, { data, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  return page;
}

async function snap(page, name) {
  await page.waitForTimeout(600);
  await clearChrome(page);
  const out = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: out });
  console.log('wrote', path.relative(process.cwd(), out));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await startServer();
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark', serviceWorkers: 'block' });
  try {
    // 1 + 2: Lineup Explorer, signed-out. Only Google Fonts may load; the
    // lineup itself is in the page, and Supabase only adds set times (none
    // are published for Tapesgiving yet).
    {
      const page = await context.newPage();
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|fonts\.(googleapis|gstatic)\.com)/, (r) => r.abort());
      await page.goto('/lineup-explorer/tapesgiving-2026.html');
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({ content: '.blob{animation:none!important}' });
      await page.locator('#ctaClose').click().catch(() => {});
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT_DIR, 'explorer-hero.png') });
      await page.locator('#count').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -12));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT_DIR, 'explorer-lineup.png') });
      console.log('wrote explorer-hero.png, explorer-lineup.png');
      await page.close();
    }

    // 3: Crew page with members.
    {
      const page = await boot(context, igData());
      await page.evaluate(() => openDetail('c1'));
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: 'Nice' }).click().catch(() => {});
      await snap(page, 'crew');
      await page.evaluate(() => openCrewManifestSheet());
      await page.waitForTimeout(600);
      await snap(page, 'crew-manifest');
      await page.close();
    }

    // 4a: Game Plan carpool for Tapesgiving.
    {
      const page = await boot(context, igData());
      await page.evaluate(async (me) => {
        const gp = await dbGetOrCreateGamePlan('c1', 'f-edc');
        const ins = async (row) => {
          const { data } = await sb.from('game_plan_items').insert({ game_plan_id: gp.id, crew_id: 'c1', added_by: me, ...row }).select().single();
          gamePlanItems.push(data); return data;
        };
        const d1 = await ins({ kind: 'carpool_driver', assignee_raver_id: 'r-marco', seats: 4 });
        const d2 = await ins({ kind: 'carpool_driver', assignee_raver_id: 'r-you', seats: 3 });
        for (const r of ['r-priya', 'r-jo']) await ins({ kind: 'carpool_rider', driver_item_id: d1.id, assignee_raver_id: r });
        for (const r of ['r-tess', 'r-kai', 'r-dani']) await ins({ kind: 'carpool_rider', driver_item_id: d2.id, assignee_raver_id: r });
        await openDetail('c1', { tab: 'gameplan' });
        openCrewFeature('raveplan');
      }, TEST_UID);
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: 'Nice' }).click().catch(() => {});
      await page.locator('[onclick*="switchGamePlanSection"]', { hasText: 'Rides' }).first().click();
      await page.waitForTimeout(500);
      await page.locator('#game-plan-section-logistics').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -260));
      await snap(page, 'gameplan-carpool');
      await page.close();
    }

    // 4b: Meetup poll in the crew feed.
    {
      const page = await boot(context, igData());
      await page.evaluate(() => { openDetail('c1'); openCrewFeature('poll'); });
      await page.waitForTimeout(500);
      await page.locator('#crew-feature-panel-poll').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -110));
      await snap(page, 'poll');
      await page.close();
    }
  } finally {
    await browser.close();
    stopServer();
  }
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
