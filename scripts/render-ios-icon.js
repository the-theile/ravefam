#!/usr/bin/env node
// Renders native/icon-source.html into the iOS app icon (1024x1024, the single
// size Xcode needs) and the launch-screen image. App Store Connect rejects
// icons with an alpha channel, so the icon is re-encoded as 8-bit RGB PNG by the
// small encoder below. The launch image is scaled to fill the screen, so 1366px
// is plenty (headless Chromium stalls at 2732px); it keeps Xcode's file names.
// Run: node scripts/render-ios-icon.js
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'native/icon-source.html');
const ASSETS = path.join(REPO_ROOT, 'ios/App/App/Assets.xcassets');
const TARGETS = [
  { size: 1024, hash: '', rgb: true, outs: ['AppIcon.appiconset/AppIcon-512@2x.png'] },
  { size: 1366, hash: '#splash', rgb: false, outs: ['Splash.imageset/splash-2732x2732.png', 'Splash.imageset/splash-2732x2732-1.png', 'Splash.imageset/splash-2732x2732-2.png'] },
];

async function main() {
  const browser = await chromium.launch();
  for (const { size, hash, rgb, outs } of TARGETS) {
    const png = await render(browser, size, hash, rgb);
    for (const out of outs) {
      fs.writeFileSync(path.join(ASSETS, out), png);
      console.log(`Wrote ${out} (${size}x${size}${rgb ? ', RGB, no alpha' : ''})`);
    }
  }
  await browser.close();
}

async function render(browser, size, hash, rgb) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.goto(`file://${SOURCE}${hash}`);
  if (!rgb) {
    const png = await page.screenshot({ type: 'png' });
    await page.close();
    return png;
  }
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 100 });
  // Decode the opaque screenshot to pixels so it can be re-encoded as RGB PNG.
  const rgba = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
  }, jpeg.toString('base64'));
  await page.close();
  return encodeRgbPng(size, size, rgba);
}

// Minimal PNG encoder: 8-bit RGB (color type 2), so the file has no alpha channel.
function encodeRgbPng(w, h, rgba) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

main().catch((err) => { console.error(err); process.exit(1); });
