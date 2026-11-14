// Builds the Florida Groves 2027 lineup-drop carousel (1080×1350) as HTML, then
// renders it to ../slideN.png with Playwright. Screens in ./shots come from the
// real Lineup Explorer page via capture.js (logged out, 6 picks seeded).
// Run from the repo root: node marketing/florida-groves-2027/_build/slides.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
mkdirSync(path.join(HERE, 'html'), { recursive: true }); // scratch, removed after render

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Space+Grotesk:wght@400;500;700&family=Urbanist:wght@800;900&display=swap');
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
<div class="top"><div class="brand"><img src="../brand-mark.svg" alt=""><span>Rave<span class="g">FAM</span></span></div><div class="day">${s.day}</div></div>
${s.body}
<div class="foot"><span>Free · no signup · <b>myravefam.com/lineup-explorer</b></span><span class="dots">${dots}</span></div>
</body></html>`;
}
const phone = (shot, top, h = 1400, pos = 'top') => `<div class="phone" style="top:${top}px"><div class="screen" style="height:${h}px"><img src="../shots/${shot}" style="object-fit:cover;object-position:${pos};height:100%"></div></div>`;
// Cards stop 36px above the footer; anything taller fades out there.
const card = (shot, top, w = 880) => `<div class="card" style="top:${top}px;width:${w}px;max-height:${1350 - 104 - 36 - top}px"><img src="../shots/${shot}"></div>`;

const TAG = 'LINEUP DROP';

slide('slide1', TAG, 1, 3, `<div class="copy"><div class="eyebrow">Florida Groves · Apr 10–11, 2027</div>
  <h1 style="font-size:96px">The Groves<br>lineup is here.</h1>
  <div class="pills"><span class="pill" style="--c:#b15cff">Of The Trees</span><span class="pill" style="--c:#ffd23c">Wiz Khalifa</span><span class="pill" style="--c:#ff2d95">Big Gigantic x Boogie T</span><span class="pill">Know Good</span><span class="pill" style="--c:rgba(243,238,251,0.35)">+ 29 more</span></div></div>
  ${phone('deck.png', 640, 900)}`);
slide('slide2', TAG, 2, 3, `<div class="copy"><div class="eyebrow">📋 My picks</div>
  <h1 style="font-size:92px">Lock in<br>your sets.</h1>
  <div class="sub">All <b>33 acts</b>, filter by vibe, tap 📋 on the ones you can't miss. One tap to preview anyone.</div></div>
  ${phone('picks.png', 590, 900, 'center 62%')}`);
slide('slide3', TAG, 3, 3, `<div class="copy"><div class="eyebrow">Central FL Fairgrounds · Orlando</div>
  <h1 style="font-size:92px">Plan it<br>with the fam.</h1>
  <div class="steps">
    <div class="step"><div class="n">1</div><div class="t"><b>Pick your sets</b>Free, no signup. Your picks save on your phone.</div></div>
    <div class="step"><div class="n">2</div><div class="t"><b>Bring the crew</b>Save to RaveFAM and see who's going and what they picked.</div></div>
    <div class="step"><div class="n">3</div><div class="t"><b>Get the drop</b>Mark it Going and we'll ping you when days and set times post.</div></div>
  </div></div>`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const s of SLIDES) {
  const file = path.join(HERE, 'html', s.id + '.html');
  writeFileSync(file, frame(s));
  await page.goto('file://' + file, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, s.id + '.png') });
}
await browser.close();
rmSync(path.join(HERE, 'html'), { recursive: true, force: true });
console.log(`Rendered ${SLIDES.length} slides to ${OUT}`);
