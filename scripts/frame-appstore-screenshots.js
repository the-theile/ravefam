#!/usr/bin/env node
// Captioned App Store screenshots: puts each raw shot from
// capture-appstore-screenshots.js on a neon background under a headline.
//   node scripts/capture-appstore-screenshots.js   (raw shots first)
//   node scripts/frame-appstore-screenshots.js
// Output: screenshots/appstore/captioned/{iphone,ipad}/NN-name.jpg, same sizes
// as the raw shots (1320x2868, 2064x2752).
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const REPO_ROOT = path.join(__dirname, '..');
const IN_ROOT = path.join(REPO_ROOT, 'screenshots', 'appstore');
const OUT_ROOT = path.join(IN_ROOT, 'captioned');

// [headline (accent word in *stars*), subline]
const CAPTIONS = {
  '01-crew': ['Your rave *crew*, all in one place', 'Countdowns, polls, jams and dream raves'],
  '02-huddle': ['A group chat built for *raves*', 'Rides, meetups and outfit checks'],
  '03-rave-plan': ['Plan the rave *together*', 'Tasks, roles, rides, stays and outfits'],
  '04-rave-check': ['Know who’s *actually* going', 'Send a Rave Check, get answers fast'],
  '05-raver': ['Remember every raver you *meet*', 'Vibe tags, their sound, your next rave'],
  '06-stats': ['Your rave life, *stamped*', 'Rave Passport, Vibe DNA and ticket mix'],
  '07-lineup': ['Pick your sets before the *gates*', 'Explore the lineup and save your picks'],
};

const LAYOUT = {
  iphone: { w: 440, h: 956, dpr: 3, head: 34, sub: 17, top: 66, shotW: 360, shotTop: 236, radius: 34 },
  ipad: { w: 1032, h: 1376, dpr: 2, head: 52, sub: 24, top: 74, shotW: 780, shotTop: 270, radius: 30 },
};

const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
const FONT_600 = dataUrl(path.join(REPO_ROOT, 'fonts', 'outfit-latin-600-normal.woff'), 'font/woff');
const FONT_700 = dataUrl(path.join(REPO_ROOT, 'fonts', 'outfit-latin-700-normal.woff'), 'font/woff');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function html(L, img, [head, sub]) {
  const headline = esc(head).replace(/\*(.+?)\*/g, '<em>$1</em>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Outfit; font-weight: 600; src: url(${FONT_600}) format('woff'); }
  @font-face { font-family: Outfit; font-weight: 700; src: url(${FONT_700}) format('woff'); }
  html, body { margin: 0; width: ${L.w}px; height: ${L.h}px; overflow: hidden; }
  body {
    background:
      radial-gradient(60% 40% at 15% 8%, rgba(255,45,120,.38), transparent 70%),
      radial-gradient(55% 40% at 90% 22%, rgba(191,0,255,.34), transparent 70%),
      radial-gradient(70% 45% at 50% 100%, rgba(0,245,255,.20), transparent 70%),
      #0B0614;
    font-family: Outfit, sans-serif; color: #fff; text-align: center; position: relative;
  }
  .cap { position: absolute; left: 0; right: 0; top: 0; height: ${L.shotTop}px; padding: 0 ${Math.round(L.w * 0.08)}px;
    box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; }
  h1 { margin: 0; font-weight: 700; font-size: ${L.head}px; line-height: 1.12; letter-spacing: -0.01em; text-wrap: balance; }
  h1 em { font-style: normal; background: linear-gradient(90deg,#FF2D78,#BF00FF 55%,#00F5FF);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  p { margin: ${Math.round(L.sub * 0.7)}px 0 0; font-weight: 600; font-size: ${L.sub}px; color: rgba(255,255,255,.72); text-wrap: balance; }
  .shot { position: absolute; left: 50%; top: ${L.shotTop}px; width: ${L.shotW}px; transform: translateX(-50%);
    border-radius: ${L.radius}px; overflow: hidden;
    box-shadow: 0 0 0 2px rgba(255,255,255,.14), 0 0 40px rgba(191,0,255,.45), 0 24px 60px rgba(0,0,0,.6); }
  .shot img { display: block; width: 100%; }
  </style></head><body>
  <div class="cap"><h1>${headline}</h1><p>${esc(sub)}</p></div>
  <div class="shot"><img src="${img}"></div>
  </body></html>`;
}

async function main() {
  const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    for (const [dir, L] of Object.entries(LAYOUT)) {
      const outDir = path.join(OUT_ROOT, dir);
      fs.mkdirSync(outDir, { recursive: true });
      const page = await browser.newPage({ viewport: { width: L.w, height: L.h }, deviceScaleFactor: L.dpr });
      for (const [name, caption] of Object.entries(CAPTIONS)) {
        const src = path.join(IN_ROOT, dir, `${name}.jpg`);
        if (!fs.existsSync(src)) { console.warn('missing', path.relative(REPO_ROOT, src)); continue; }
        await page.setContent(html(L, dataUrl(src, 'image/jpeg'), caption));
        await page.evaluate(() => document.fonts.ready);
        await page.locator('.shot img').evaluate((img) => img.decode());
        const out = path.join(outDir, `${name}.jpg`);
        await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
        console.log('wrote', path.relative(REPO_ROOT, out));
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
