// Builds the DUSK Arizona 2026 campaign slides (1080×1350) as HTML, then renders
// them to ../dayN-M.png with Playwright. Screens come from ./shots (captured
// with demo data by tests/zz_dusk_capture.spec.js).
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
mkdirSync(path.join(HERE, 'html'), { recursive: true });

const CSS = `
@import url('../fonts/local.css');
* { box-sizing: border-box; margin: 0; }
html, body { width: 1080px; height: 1350px; }
body { position: relative; overflow: hidden; background: #07050f; color: #f3eefb; font-family: 'Space Grotesk', sans-serif; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(900px 700px at 0% 0%, rgba(255,45,149,0.35), transparent 60%),
  radial-gradient(800px 700px at 100% 100%, rgba(46,230,200,0.28), transparent 60%),
  radial-gradient(700px 600px at 90% 10%, rgba(177,92,255,0.30), transparent 60%), #07050f; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(160,140,220,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(160,140,220,0.07) 1px, transparent 1px);
  background-size: 54px 54px; -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 80%); }
.top { position: absolute; top: 56px; left: 64px; right: 64px; display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; font-family: 'Urbanist'; font-weight: 800; font-size: 34px; }
.brand img { width: 52px; height: 52px; }
.brand .g { color: #39FF14; }
.day { font-family: 'Orbitron'; font-weight: 700; font-size: 22px; letter-spacing: 0.18em; padding: 12px 20px; border-radius: 999px;
  border: 1.5px solid rgba(243,238,251,0.35); background: rgba(12,8,30,0.6); }
.eyebrow { font-family: 'Orbitron'; font-weight: 700; font-size: 24px; letter-spacing: 0.32em; text-transform: uppercase; color: #2ee6c8; }
h1 { font-family: 'Orbitron'; font-weight: 900; line-height: 0.98; letter-spacing: 0.01em; text-transform: uppercase;
  background: linear-gradient(100deg, #ff2d95 0%, #b15cff 50%, #2ee6c8 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 30px rgba(177,92,255,0.35)); }
.sub { font-size: 36px; line-height: 1.32; color: #cfc6ea; }
.sub b { color: #fff; }
.copy { position: absolute; left: 64px; right: 64px; top: 170px; display: flex; flex-direction: column; gap: 22px; }
.phone { position: absolute; left: 50%; transform: translateX(-50%); width: 560px; border-radius: 72px; padding: 16px; background: #0d0a1c;
  border: 2px solid rgba(243,238,251,0.18); box-shadow: 0 40px 120px -20px rgba(177,92,255,0.55), 0 0 0 10px rgba(255,255,255,0.03); }
.phone .screen { border-radius: 58px; overflow: hidden; background: #07050f; }
.phone .screen img { display: block; width: 100%; }
.card { position: absolute; left: 50%; transform: translateX(-50%); border-radius: 36px; overflow: hidden;
  box-shadow: 0 30px 100px -18px rgba(177,92,255,0.6), 0 0 0 2px rgba(243,238,251,0.14); }
.card img { display: block; width: 100%; }
.card { -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 90px), transparent); }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 104px; display: flex; align-items: center; justify-content: space-between; padding: 0 64px;
  background: linear-gradient(0deg, rgba(7,5,15,0.96), rgba(7,5,15,0.75)); border-top: 1px solid rgba(243,238,251,0.12);
  font-size: 26px; color: #cfc6ea; }
.foot b { color: #fff; font-weight: 700; }
.dots { display: flex; gap: 10px; }
.dots i { width: 14px; height: 14px; border-radius: 50%; background: rgba(243,238,251,0.25); }
.dots i.on { background: #2ee6c8; box-shadow: 0 0 14px #2ee6c8; }
.pills { display: flex; flex-wrap: wrap; gap: 14px; }
.pill { font-size: 28px; font-weight: 700; padding: 14px 24px; border-radius: 999px; border: 2px solid var(--c, #2ee6c8); color: #fff; background: rgba(12,8,30,0.7); }
.steps { display: flex; flex-direction: column; gap: 26px; margin-top: 16px; }
.step { display: flex; gap: 28px; align-items: center; padding: 30px 34px; border-radius: 30px; background: rgba(18,12,38,0.82); border: 1.5px solid rgba(243,238,251,0.14); }
.step .n { flex: none; width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; font-family: 'Orbitron'; font-weight: 900; font-size: 36px; color: #0a0512;
  background: linear-gradient(135deg, #ff2d95, #2ee6c8); }
.step .t { font-size: 34px; line-height: 1.3; color: #cfc6ea; }
.step .t b { display: block; color: #fff; font-size: 40px; margin-bottom: 4px; }
.notif { position: absolute; left: 64px; right: 64px; border-radius: 40px; padding: 30px 34px; display: flex; gap: 24px; align-items: flex-start;
  background: rgba(38,32,58,0.86); border: 1.5px solid rgba(255,255,255,0.14); box-shadow: 0 24px 80px -20px rgba(0,0,0,0.8); backdrop-filter: blur(20px); }
.notif img { width: 84px; height: 84px; border-radius: 22px; background: #07050f; padding: 8px; flex: none; }
.notif .app { font-size: 24px; color: #b9b0d6; display: flex; justify-content: space-between; width: 100%; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.06em; }
.notif .ti { font-size: 34px; font-weight: 700; color: #fff; line-height: 1.25; }
.notif .bo { font-size: 30px; color: #d8d0f0; margin-top: 6px; line-height: 1.3; }
.notif .body { flex: 1; }
.lock { position: absolute; left: 0; right: 0; text-align: center; font-family: 'Space Grotesk'; }
.lock .tm { font-size: 190px; font-weight: 500; letter-spacing: -0.03em; color: #fff; line-height: 1; }
.lock .dt { font-size: 34px; color: #cfc6ea; margin-top: 8px; }
.big-emoji { font-size: 150px; line-height: 1; }
`;

const SLIDES = [];
function slide(id, day, idx, count, body) { SLIDES.push({ id, day, idx, count, body }); }
function frame(s) {
  const dots = Array.from({ length: s.count }, (_, i) => `<i class="${i === s.idx - 1 ? 'on' : ''}"></i>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="top"><div class="brand"><img src="../brand-mark.svg" alt=""><span>Rave<span class="g">FAM</span></span></div><div class="day">POST ${s.day}/4</div></div>
${s.body}
<div class="foot"><span>Free · no signup · <b>myravefam.com/lineup-explorer</b></span><span class="dots">${dots}</span></div>
</body></html>`;
}
const phone = (shot, top, h = 1400, pos = 'top') => `<div class="phone" style="top:${top}px"><div class="screen" style="height:${h}px"><img src="../shots/${shot}" style="object-fit:cover;object-position:${pos};height:100%"></div></div>`;
// Cards stop 36px above the footer; anything taller fades out there.
const card = (shot, top, w = 880) => `<div class="card" style="top:${top}px;width:${w}px;max-height:${1350 - 104 - 36 - top}px"><img src="../shots/${shot}"></div>`;

// ----- Post 1 (Wed Nov 11): 42 artists, two nights -----
slide('post1-1', 1, 1, 3, `<div class="copy"><div class="eyebrow">DUSK Arizona · Nov 13–14 · Tucson</div>
  <h1 style="font-size:100px">42 artists.<br>Two nights.</h1>
  <div class="sub">DUSK's <b>10th anniversary</b> lineup, split by day. Search it, filter by vibe, or roll the bass 🎲</div></div>
  ${phone('explorer-hero.png', 690, 900)}`);
slide('post1-2', 1, 2, 3, `<div class="copy"><div class="eyebrow">📋 My picks</div>
  <h1 style="font-size:92px">Lock in<br>your sets.</h1>
  <div class="sub">Tap 📋 on everyone you can't miss. Fri or Sat, your picks stay together in one list.</div></div>
  ${phone('explorer-picks.png', 690, 900)}`);
slide('post1-3', 1, 3, 3, `<div class="copy"><div class="eyebrow">🔥 Most wanted</div>
  <h1 style="font-size:86px">See what the<br>fam is chasing.</h1>
  <div class="sub"><b>Most wanted</b> ranks the sets everyone's picking for DUSK, and who's climbing this week.</div></div>
  ${card('explorer-mostwanted.png', 640, 820)}`);

// ----- Post 2 (Thu Nov 12): bring the crew -----
slide('post2-1', 2, 1, 3, `<div class="copy"><div class="eyebrow">Crew layer</div>
  <h1 style="font-size:92px">Who's your<br>crew catching?</h1>
  <div class="sub">See who's going, what they picked, and where your picks overlap. <b>No group-chat archaeology.</b></div></div>
  ${card('explorer-crew.png', 660, 860)}`);
slide('post2-2', 2, 2, 3, `<div class="copy"><div class="eyebrow">Crew votes · ⭐ Fam Faves</div>
  <h1 style="font-size:92px">Can't agree?<br>Vote it.</h1>
  <div class="sub">Start a crew vote on the lineup. The winners become <b>⭐ Fam Faves</b> for the whole crew.</div></div>
  ${card('explorer-vote.png', 650, 820)}`);
slide('post2-3', 2, 3, 3, `<div class="copy"><div class="eyebrow">Artist pages</div>
  <h1 style="font-size:86px">Every artist.<br>One page.</h1>
  <div class="sub">Where they're playing, who in your crew wants to catch them, and a tap to preview. <b>♡ them</b> to get pinged when they land on a lineup.</div></div>
  ${phone('artist-page.png', 760, 900)}`);

// ----- Post 3 (Fri Nov 13, Day 1): set times alert + doors game plan -----
slide('post3-1', 3, 1, 3, `<div class="copy"><div class="eyebrow">Set times are coming</div>
  <h1 style="font-size:96px">We'll ping<br>you. 🔔</h1>
  <div class="sub">Mark DUSK <b>Going</b> or <b>Interested</b> in RaveFAM and we'll let you know the moment set times are posted.</div></div>
  ${card('app-alerts.png', 720, 900)}`);
slide('post3-2', 3, 2, 3, `<div class="copy"><div class="eyebrow">Doors 2:30 · Jácome Plaza</div>
  <h1 style="font-size:88px">Your DUSK<br>game plan.</h1>
  <div class="steps">
    <div class="step"><div class="n">1</div><div class="t"><b>Pick your sets</b>Tap 📋 on the Lineup Explorer. Free, no signup.</div></div>
    <div class="step"><div class="n">2</div><div class="t"><b>Share one link</b>📤 Share my picks so your crew sees yours next to theirs.</div></div>
    <div class="step"><div class="n">3</div><div class="t"><b>Turn on alerts</b>Get set times the minute they're posted.</div></div>
  </div></div>`);
slide('post3-3', 3, 3, 3, `<div class="copy" style="top:300px;align-items:center;text-align:center"><div class="big-emoji">📴</div>
  <h1 style="font-size:100px">No signal?<br>No problem.</h1>
  <div class="sub" style="max-width:860px">Log in and open your DUSK lineup once. It's <b>saved on your phone</b>, so your picks are there even when the plaza's signal isn't.</div>
  <div class="pills" style="justify-content:center;margin-top:24px"><span class="pill">Works offline</span><span class="pill" style="--c:#FFE600">Your picks</span><span class="pill" style="--c:#ff2d95">Your ♡ favorites</span></div></div>`);

// ----- Post 4 (Sun Nov 15): after the glow -----
slide('post4-1', 4, 1, 2, `<div class="copy"><div class="eyebrow">📼 Post-fest check-off</div>
  <h1 style="font-size:92px">Who'd you<br>catch?</h1>
  <div class="sub">Tick off the sets you saw at DUSK. <b>Saw them</b> or <b>Missed</b>, one tap each.</div></div>
  ${card('explorer-checkoff.png', 640, 760)}`);
slide('post4-2', 4, 2, 2, `<div class="copy"><div class="eyebrow">Your rave history</div>
  <h1 style="font-size:92px">Every set<br>counts.</h1>
  <div class="sub">Your seen-live count grows with every fest, on each artist's page next to the crewmates who want to catch them too.</div></div>
  <div class="card" style="top:640px;width:880px;height:560px;-webkit-mask-image:none"><img src="../shots/artist-page.png" style="margin-top:-345px"></div>`);

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const s of SLIDES) {
  const file = path.join(HERE, 'html', s.id + '.html');
  writeFileSync(file, frame(s));
  await page.goto('file://' + file);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, s.id + '.png') });
}
await browser.close();
console.log(`Rendered ${SLIDES.length} slides to ${OUT}`);
