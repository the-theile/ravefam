// Builds the Tapesgiving Night 1 IG story frames (1080×1920) as HTML, then renders
// them to ../frame-N.png with Playwright. App screens come from ./shots
// (captured from app.html with a demo crew by capture.spec.js).
// Frame 3: a recreated iOS push banner using the exact title/body send-beacon-push sends (style matched to
// a real RaveFAM push screenshot, real app icon), above the real Huddle screen it opens to.
// Run from the repo root: node marketing/tapesgiving-2026/night1/_build/frames.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
mkdirSync(path.join(HERE, 'html'), { recursive: true });

// IG safe zone: no text above y=250 or below y=1580 (bottom 340px).
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Urbanist:wght@900&family=JetBrains+Mono:wght@500;700&family=Inter:wght@400;600&display=swap');
* { box-sizing: border-box; margin: 0; }
html, body { width: 1080px; height: 1920px; }
body { position: relative; overflow: hidden; background: #050509; color: #fff; font-family: 'Urbanist', sans-serif; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(760px 620px at 0% 12%, rgba(255,45,120,0.30), transparent 62%),
  radial-gradient(760px 700px at 100% 88%, rgba(0,245,255,0.22), transparent 62%),
  radial-gradient(520px 420px at 92% 30%, rgba(57,255,20,0.10), transparent 60%), #050509; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(0,245,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,245,255,0.06) 1px, transparent 1px);
  background-size: 60px 60px; -webkit-mask-image: radial-gradient(110% 70% at 50% 40%, #000 25%, transparent 78%); }
.label { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; letter-spacing: 0.16em; text-transform: uppercase; }
.top { position: absolute; top: 280px; left: 72px; right: 72px; display: flex; flex-direction: column; gap: 22px; }
.tag { display: flex; align-items: center; gap: 14px; color: #00F5FF; }
.tag img { width: 44px; height: 44px; }
.tag .dot { width: 8px; height: 8px; border-radius: 50%; background: #39FF14; box-shadow: 0 0 12px #39FF14; }
h1 { font-weight: 900; font-size: 108px; line-height: 0.96; letter-spacing: -0.01em; }
h1 .p { color: #FF2D78; text-shadow: 0 0 40px rgba(255,45,120,0.55); }
h1 .c { color: #00F5FF; text-shadow: 0 0 40px rgba(0,245,255,0.5); }
h1 .g { color: #39FF14; text-shadow: 0 0 40px rgba(57,255,20,0.5); }
.chip { align-self: flex-start; padding: 14px 24px; border-radius: 999px; border: 2px solid var(--c); color: var(--c);
  background: rgba(5,5,9,0.75); box-shadow: 0 0 28px -6px var(--c); font-size: 28px; }
.shot { position: absolute; left: 50%; transform: translateX(-50%); overflow: hidden; border-radius: 48px; background: #050509;
  border: 3px solid var(--c); box-shadow: 0 0 0 10px rgba(255,255,255,0.03), 0 0 90px -10px var(--c), 0 40px 120px -30px rgba(0,0,0,0.9); }
.shot img { display: block; width: 100%; }
.fade::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 120px; background: linear-gradient(transparent, #050509); }
.ph { position: absolute; left: 50%; transform: translateX(-50%); border-radius: 48px; border: 4px dashed #FF2D78; background: rgba(255,45,120,0.06);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; text-align: center; padding: 60px; }
.ph .big { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 44px; color: #FF2D78; letter-spacing: 0.08em; }
.ph .small { font-family: 'JetBrains Mono'; font-weight: 500; font-size: 26px; color: #c9c4dc; line-height: 1.5; letter-spacing: 0.04em; }
.sticker { position: absolute; left: 50%; transform: translateX(-50%); width: 620px; height: 150px; border-radius: 40px; }
.push { position: absolute; left: 70px; right: 70px; border-radius: 56px; padding: 34px 36px; display: flex; gap: 28px; align-items: flex-start;
  background: rgba(36,36,38,0.94); border: 1.5px solid rgba(255,255,255,0.10); box-shadow: 0 0 90px -16px rgba(57,255,20,0.45), 0 30px 90px -20px rgba(0,0,0,0.9);
  font-family: 'Inter', -apple-system, sans-serif; }
.push img { flex: none; width: 104px; height: 104px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.12); }
.push .b { flex: 1; min-width: 0; }
.push .t { display: flex; justify-content: space-between; gap: 16px; font-size: 36px; font-weight: 600; color: #fff; line-height: 1.25; }
.push .t i { font-style: normal; font-weight: 400; color: rgba(235,235,245,0.6); font-size: 32px; flex: none; }
.push .m { font-size: 35px; color: #fff; line-height: 1.3; margin-top: 4px; }
`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div>${body}</body></html>`;
const tag = (txt) => `<div class="tag label"><img src="../brand-mark.svg" alt=""><span>RaveFAM</span><span class="dot"></span><span style="color:#fff">${txt}</span></div>`;
// Crop a 1170×2532 app shot: show source rows [y0, y1] at a given width.
const crop = (file, top, w, y0, y1, c, fade = false) => {
  const s = w / 1170, h = Math.round((y1 - y0) * s);
  return `<div class="shot${fade ? ' fade' : ''}" style="--c:${c};top:${top}px;width:${w}px;height:${h}px"><img src="${file}" style="margin-top:${-Math.round(y0 * s)}px"></div>`;
};

const FRAMES = {
  'frame-1': page(`<div class="top">${tag('TAPESGIVING · NIGHT 1')}
    <h1 style="font-size:98px">Tapesgiving<br><span class="p">day one.</span><br>Find your <span class="c">crew.</span></h1>
    <div class="chip label" style="--c:#39FF14">📍 DROP YOUR MEETUP SPOT</div></div>
    ${crop('../shots/huddle-meetup.png', 755, 560, 0, 1655, '#FF2D78')}`),
  'frame-2': page(`<div class="top">${tag('FRI 11/27 · CLEARWATER FL')}
    <h1>Night one.<br>Who you <span class="g">catching?</span></h1>
    <div class="chip label" style="--c:#00F5FF">📋 MARK YOUR MUST-SEES</div></div>
    ${crop('../shots/focus-lineup.png', 720, 820, 880, 2050, '#00F5FF')}`),
  'frame-3': page(`<div class="top">${tag('TAPESGIVING · NIGHT 1')}
    <h1>Lost in the<br>crowd? <span class="p">Never.</span></h1>
    <div class="chip label" style="--c:#FF2D78">🔔 PUSH ON. NO PING LOST.</div></div>
    <div class="push" style="top:700px"><img src="../app-icon.png" alt=""><div class="b">
      <div class="t"><span>📣 Beacon from Bass Syndicate</span><i>now</i></div>
      <div class="m">Lost Sam. Everyone to the Plaza, by the food trucks 📍</div></div></div>
    ${crop('../shots/huddle-beacon.png', 990, 940, 0, 470, '#FF2D78')}
    <!-- empty: room for the myravefam.com link sticker (y≈1410–1560) -->
    <div class="sticker" style="top:1410px"></div>`),
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
for (const [id, html] of Object.entries(FRAMES)) {
  const file = path.join(HERE, 'html', id + '.html');
  writeFileSync(file, html);
  await p.goto('file://' + file);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  // Guard the IG safe zone: no text above 250 or below 1580.
  const bad = await p.evaluate(() => [...document.querySelectorAll('h1, .label, .push')].map(e => e.getBoundingClientRect())
    .filter(r => r.top < 250 || r.bottom > 1580).length);
  if (bad) throw new Error(`${id}: text outside IG safe zone`);
  await p.screenshot({ path: path.join(OUT, id + '.png') });
  console.log('wrote', id + '.png');
}
await browser.close();
