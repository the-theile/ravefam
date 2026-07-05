#!/usr/bin/env node
// Renders the invite OG image source templates (og-invite-*-source.html) into
// 1200x630 PNGs using Playwright, the same way the existing og-design-*.html
// mockups are meant to be turned into og-preview-*.png / og-image.png -- just
// automated instead of done by hand. Run with: node scripts/render-og-images.js
'use strict';

const path = require('path');
const { chromium } = require('@playwright/test');

const REPO_ROOT = path.join(__dirname, '..');

const TARGETS = [
  { source: 'og-invite-crew-source.html', out: 'og-invite-crew.png' },
  { source: 'og-invite-claim-source.html', out: 'og-invite-claim.png' },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const { source, out } of TARGETS) {
    await page.goto(`file://${path.join(REPO_ROOT, source)}`);
    await page.waitForTimeout(200); // let web fonts finish loading
    await page.screenshot({ path: path.join(REPO_ROOT, out) });
    console.log(`Wrote ${out}`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
