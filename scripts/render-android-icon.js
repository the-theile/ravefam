#!/usr/bin/env node
// Renders native/icon-source.html into the Android launcher icons: adaptive
// layers (foreground, background, monochrome for Android 13 themed icons) and
// legacy square/round PNGs at every density, plus the 512x512 Play Store icon.
// Writes into android/app/src/main/res once the Capacitor Android project
// exists (npx cap add android), otherwise into native/android/res to copy in.
// Run: node scripts/render-android-icon.js
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'native/icon-source.html');
const APP_RES = path.join(REPO_ROOT, 'android/app/src/main/res');
const RES = fs.existsSync(APP_RES) ? APP_RES : path.join(REPO_ROOT, 'native/android/res');
const PLAY_ICON = path.join(REPO_ROOT, 'native/android/play-store-icon-512.png');

// Launcher icons are 48dp; adaptive layers are 108dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;

async function main() {
  // CHROME_PATH: use an already-installed Chromium instead of Playwright's own.
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const render = async (size, mode) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.goto(`file://${SOURCE}${mode ? '#' + mode : ''}`);
    const png = await page.screenshot({ type: 'png', omitBackground: true });
    await page.close();
    return png;
  };
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    console.log('Wrote', path.relative(REPO_ROOT, file));
  };

  for (const [name, scale] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${name}`);
    const launcher = Math.round(48 * scale), layer = Math.round(108 * scale);
    write(path.join(dir, 'ic_launcher.png'), await render(launcher, 'legacy'));
    write(path.join(dir, 'ic_launcher_round.png'), await render(launcher, 'round'));
    write(path.join(dir, 'ic_launcher_foreground.png'), await render(layer, 'fg'));
    write(path.join(dir, 'ic_launcher_background.png'), await render(layer, 'bg'));
    write(path.join(dir, 'ic_launcher_monochrome.png'), await render(layer, 'mono'));
  }
  for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    write(path.join(RES, 'mipmap-anydpi-v26', file), ADAPTIVE_XML);
  }
  // Play Console wants a full-bleed 512x512 square; Google Play applies the mask.
  write(PLAY_ICON, await render(512, ''));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
