#!/usr/bin/env node
// Renders lineup-explorer/icon-source.html (a vmin-scaled square icon design)
// into the PNG sizes the lineup-explorer pages need for home-screen shortcuts:
// apple-touch-icon (iOS) and the manifest icons (Android). The source uses vmin
// units, so re-rendering at each viewport size produces crisp output at that
// size directly, no raster resizing needed. Run with: node scripts/render-lineup-icon.js
'use strict';

const path = require('path');
const { chromium } = require('@playwright/test');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE = 'lineup-explorer/icon-source.html';

const TARGETS = [
  { size: 512, out: 'lineup-explorer/icon-512.png' },
  { size: 192, out: 'lineup-explorer/icon-192.png' },
  { size: 180, out: 'lineup-explorer/apple-touch-icon.png' },
];

async function main() {
  const browser = await chromium.launch();
  for (const { size, out } of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.goto(`file://${path.join(REPO_ROOT, SOURCE)}`);
    await page.screenshot({ path: path.join(REPO_ROOT, out) });
    await page.close();
    console.log(`Wrote ${out} (${size}x${size})`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
