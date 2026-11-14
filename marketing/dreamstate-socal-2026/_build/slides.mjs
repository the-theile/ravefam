// Builds the Dreamstate SoCal 2026 "Game Plan" carousel (6 × 1080×1350) as HTML,
// then renders it to ../slideN.png with Playwright. Screens in ./shots are real
// app.html renders from capture.js (mocked backend, fictional crew).
// Run from the repo root: node marketing/dreamstate-socal-2026/_build/slides.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
mkdirSync(path.join(HERE, 'html'), { recursive: true }); // scratch, removed after render

const PINK = '#FF2D78', CYAN = '#00F5FF', GREEN = '#39FF14';
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Space+Grotesk:wght@400;500;700&family=Urbanist:wght@800;900&display=swap');
* { box-sizing: border-box; margin: 0; }
html, body { width: 1080px; height: 1350px; }
body { position: relative; overflow: hidden; background: #050409; color: #f3eefb; font-family: 'Space Grotesk', sans-serif; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(760px 620px at -5% -5%, rgba(255,45,120,0.30), transparent 62%),
  radial-gradient(760px 700px at 105% 100%, rgba(0,245,255,0.22), transparent 62%), #050409; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(0,245,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,245,255,0.05) 1px, transparent 1px);
  background-size: 54px 54px; -webkit-mask-image: radial-gradient(120% 80% at 50% 0%, #000 25%, transparent 75%); }
.top { position: absolute; top: 56px; left: 64px; right: 64px; display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; font-family: 'Urbanist'; font-weight: 800; font-size: 34px; }
.brand img { width: 52px; height: 52px; }
.brand .g { color: ${GREEN}; }
.tag { font-family: 'Orbitron'; font-weight: 700; font-size: 20px; letter-spacing: 0.18em; padding: 12px 20px; border-radius: 999px;
  border: 1.5px solid rgba(0,245,255,0.5); color: ${CYAN}; background: rgba(5,4,9,0.6); }
.copy { position: absolute; left: 64px; right: 64px; top: 168px; display: flex; flex-direction: column; gap: 20px; }
.eyebrow { font-family: 'Orbitron'; font-weight: 700; font-size: 23px; letter-spacing: 0.3em; text-transform: uppercase; color: ${CYAN}; }
h1 { font-family: 'Orbitron'; font-weight: 900; line-height: 1.0; text-transform: uppercase; color: #fff; }
h1 .p { color: ${PINK}; text-shadow: 0 0 34px rgba(255,45,120,0.65); }
h1 .c { color: ${CYAN}; text-shadow: 0 0 34px rgba(0,245,255,0.6); }
.sub { font-size: 34px; line-height: 1.32; color: #c9c2dd; max-width: 900px; }
.sub b { color: #fff; }
.phone { position: absolute; left: 50%; transform: translateX(-50%); width: 560px; border-radius: 72px; padding: 16px; background: #0b0912;
  border: 2px solid rgba(243,238,251,0.16); box-shadow: 0 40px 120px -24px rgba(255,45,120,0.5), 0 0 60px -10px rgba(0,245,255,0.35); }
.phone .screen { border-radius: 58px; overflow: hidden; background: #050409; }
.phone .screen img { display: block; width: 100%; object-fit: cover; height: 100%; }
.sticker { position: absolute; z-index: 5; transform: rotate(-9deg); padding: 22px 34px 18px; border-radius: 28px; text-align: center;
  background: ${PINK}; color: #050409; box-shadow: 0 0 0 6px #050409, 0 0 0 9px ${CYAN}, 0 0 60px rgba(255,45,120,0.7); }
.sticker .n { font-family: 'Orbitron'; font-weight: 900; font-size: 92px; line-height: 0.95; letter-spacing: 0.02em; }
.sticker .l { font-family: 'Orbitron'; font-weight: 700; font-size: 22px; letter-spacing: 0.28em; margin-top: 6px; }
.callout { position: absolute; z-index: 5; font-family: 'Space Grotesk'; font-weight: 700; font-size: 28px; padding: 16px 24px; border-radius: 20px;
  background: rgba(5,4,9,0.92); border: 2px solid var(--c); color: #fff; box-shadow: 0 0 30px -4px var(--c); }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 100px; z-index: 6; display: flex; align-items: center; justify-content: space-between; padding: 0 64px;
  background: linear-gradient(0deg, rgba(5,4,9,0.98), rgba(5,4,9,0.82)); border-top: 1px solid rgba(0,245,255,0.18); font-size: 25px; color: #c9c2dd; }
.foot b { color: #fff; font-weight: 700; }
.dots { display: flex; gap: 10px; }
.dots i { width: 13px; height: 13px; border-radius: 50%; background: rgba(243,238,251,0.22); }
.dots i.on { background: ${PINK}; box-shadow: 0 0 14px ${PINK}; }
/* CTA */
.cta { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; text-align: center; padding: 0 70px 80px; }
.logo { display: flex; flex-direction: column; align-items: center; gap: 22px; }
.logo img { width: 230px; height: 230px; filter: drop-shadow(0 0 40px rgba(57,255,20,0.6)); }
.logo .word { font-family: 'Urbanist'; font-weight: 900; font-size: 128px; line-height: 1; color: ${GREEN};
  text-shadow: 0 0 22px rgba(57,255,20,0.85), 0 0 70px rgba(57,255,20,0.5); }
.btn { font-family: 'Orbitron'; font-weight: 900; font-size: 34px; letter-spacing: 0.12em; text-transform: uppercase; padding: 28px 48px; border-radius: 999px;
  color: #050409; background: linear-gradient(90deg, ${PINK}, ${CYAN}); box-shadow: 0 0 60px -6px rgba(255,45,120,0.7); }
.checks { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
.checks span { font-size: 28px; font-weight: 700; padding: 12px 22px; border-radius: 999px; border: 2px solid rgba(0,245,255,0.45); color: #fff; background: rgba(5,4,9,0.7); }
`;

const COUNT = 6;
const SLIDES = [];
const slide = (id, body, { tag = 'DREAMSTATE · NOV 20–21', top = true } = {}) => SLIDES.push({ id, body, tag, top });
function frame(s, idx) {
  const dots = Array.from({ length: COUNT }, (_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div>
${s.top ? `<div class="top"><div class="brand"><img src="../brand-mark.svg" alt=""><span>Rave<span class="g">FAM</span></span></div><div class="tag">${s.tag}</div></div>` : ''}
${s.body}
<div class="foot"><span>Your crew's <b>Game Plan</b> · myravefam.com</span><span class="dots">${dots}</span></div>
</body></html>`;
}
// Phone mockup; the screen bleeds under the footer. pos = object-position of the shot.
const phone = (shot, top, h = 1000, pos = 'top') =>
  `<div class="phone" style="top:${top}px"><div class="screen" style="height:${h}px"><img src="../shots/${shot}" style="object-position:${pos}"></div></div>`;

slide('slide1', `<div class="copy"><div class="eyebrow">Dreamstate SoCal · Long Beach</div>
  <h1 style="font-size:88px">Your crew<br>has <span class="p">no plan</span>.<br>Yet.</h1></div>
  <div class="sticker" style="top:470px;right:70px"><div class="n">6 DAYS</div><div class="l">UNTIL DREAMSTATE</div></div>
  ${phone('mb-cover.png', 600)}`);
slide('slide2', `<div class="copy"><div class="eyebrow">🎤 Set times</div>
  <h1 style="font-size:84px">Who's catching<br><span class="c">what</span>, when.</h1>
  <div class="sub">Every set your crew picked, in order. <b>Clash at 10?</b> Split up, set a meetup.</div></div>
  ${phone('plan-lineup.png', 600, 1000, 'center bottom')}`);
slide('slide3', `<div class="copy"><div class="eyebrow">🚗 Rides</div>
  <h1 style="font-size:84px">Who's <span class="p">driving</span>.<br>Who's <span class="c">pooling</span>.</h1>
  <div class="sub">Post your car, claim a seat. Open seats show up so nobody's left on read.</div></div>
  ${phone('mb-logistics.png', 600, 1000, 'center 8%')}`);
slide('slide4', `<div class="copy"><div class="eyebrow">📍 Meetup spot</div>
  <h1 style="font-size:84px">Pick it <span class="p">now</span>,<br>not at the <span class="c">gates</span>.</h1>
  <div class="sub">Signal dies at the gates. Pin the spot and time while everyone can still read it.</div></div>
  ${phone('mb-meetup.png', 600, 1000, 'center 8%')}`);
slide('slide5', `<div class="copy"><div class="eyebrow">💬 Huddle</div>
  <h1 style="font-size:84px">All pinged.<br>All <span class="c">locked in</span>.</h1>
  <div class="sub">One chat per rave. The plan lands there, and so does everyone's ✅.</div></div>
  ${phone('huddle.png', 600, 1000, 'top')}`);
slide('slide6', `<div class="cta">
  <div class="logo"><img src="../brand-mark.svg" alt=""><div class="word">RaveFAM</div></div>
  <h1 style="font-size:78px">Build your<br><span class="p">Game Plan</span></h1>
  <div class="checks"><span>🎤 Set times</span><span>🚗 Rides</span><span>📍 Meetup</span><span>💬 Huddle</span></div>
  <div class="btn">Link in bio ↗</div></div>`, { top: false });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const [i, s] of SLIDES.entries()) {
  const file = path.join(HERE, 'html', s.id + '.html');
  writeFileSync(file, frame(s, i));
  await page.goto('file://' + file, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, s.id + '.png') });
}
await browser.close();
rmSync(path.join(HERE, 'html'), { recursive: true, force: true });
console.log(`Rendered ${SLIDES.length} slides to ${OUT}`);
