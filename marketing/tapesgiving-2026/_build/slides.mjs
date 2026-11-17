// Builds the Tapesgiving feed carousel (5 slides, 1080×1350) as HTML, then
// renders it to ../slideN.png with Playwright. Screens in ./shots come from
// capture.js (real Lineup Explorer page + real app UI on the demo-crew harness).
// Run from the repo root: node marketing/tapesgiving-2026/_build/slides.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
mkdirSync(path.join(HERE, 'html'), { recursive: true }); // scratch, removed after render

const PINK = '#ff2d95', CYAN = '#00f5ff', GREEN = '#39FF14';
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Urbanist:wght@700;800;900&display=swap');
* { box-sizing: border-box; margin: 0; }
html, body { width: 1080px; height: 1350px; }
body { position: relative; overflow: hidden; background: #07050c; color: #f3eefb; font-family: 'Space Grotesk', sans-serif; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(900px 700px at 0% 0%, rgba(255,45,149,0.30), transparent 60%),
  radial-gradient(900px 750px at 100% 100%, rgba(0,245,255,0.22), transparent 60%), #07050c; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(160,140,220,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(160,140,220,0.06) 1px, transparent 1px);
  background-size: 54px 54px; -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 80%); }
.top { position: absolute; top: 56px; left: 64px; right: 64px; display: flex; justify-content: space-between; align-items: center; z-index: 3; }
.brand { display: flex; align-items: center; gap: 14px; font-family: 'Urbanist'; font-weight: 800; font-size: 34px; }
.brand img { width: 52px; height: 52px; }
.brand .g { color: ${GREEN}; }
.tag { font-family: 'Urbanist'; font-weight: 800; font-size: 24px; letter-spacing: 0.16em; padding: 12px 22px; border-radius: 999px;
  border: 1.5px solid rgba(243,238,251,0.35); background: rgba(12,8,24,0.6); }
.eyebrow { font-family: 'Urbanist'; font-weight: 800; font-size: 28px; letter-spacing: 0.24em; text-transform: uppercase; color: ${CYAN}; }
h1 { font-family: 'Urbanist'; font-weight: 900; line-height: 0.98; letter-spacing: -0.01em; font-size: 100px;
  background: linear-gradient(100deg, ${PINK} 0%, #c85cff 50%, ${CYAN} 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 28px rgba(255,45,149,0.35)); }
.sub { font-size: 34px; line-height: 1.34; color: #cfc6ea; }
.sub b { color: #fff; }
.copy { position: absolute; left: 64px; right: 64px; top: 170px; display: flex; flex-direction: column; gap: 20px; z-index: 2; }
.phone { position: absolute; width: 520px; border-radius: 68px; padding: 15px; background: #0d0a18;
  border: 2px solid rgba(243,238,251,0.18); box-shadow: 0 40px 120px -20px rgba(255,45,149,0.45), 0 0 0 10px rgba(255,255,255,0.03); }
.phone.c { box-shadow: 0 40px 120px -20px rgba(0,245,255,0.40), 0 0 0 10px rgba(255,255,255,0.03); }
.phone.g { box-shadow: 0 40px 120px -20px rgba(57,255,20,0.32), 0 0 0 10px rgba(255,255,255,0.03); }
.phone .screen { border-radius: 54px; overflow: hidden; background: #07050c; }
.phone .screen img { display: block; width: 100%; object-fit: cover; height: 100%; }
.cap { position: absolute; font-family: 'Urbanist'; font-weight: 800; font-size: 26px; letter-spacing: 0.14em; text-transform: uppercase; color: #cfc6ea; text-align: center; }
.sticker { position: absolute; z-index: 4; font-family: 'Urbanist'; font-weight: 900; color: #07050c; background: ${GREEN};
  border-radius: 28px; padding: 22px 34px; line-height: 1; box-shadow: 0 0 0 4px #07050c, 0 0 46px rgba(57,255,20,0.65); transform: rotate(-5deg); }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 104px; display: flex; align-items: center; justify-content: space-between; padding: 0 64px; z-index: 5;
  background: linear-gradient(0deg, rgba(7,5,12,0.97), rgba(7,5,12,0.8)); border-top: 1px solid rgba(243,238,251,0.12); font-size: 26px; color: #cfc6ea; }
.foot b { color: ${GREEN}; font-weight: 700; }
.dots { display: flex; gap: 10px; }
.dots i { width: 14px; height: 14px; border-radius: 50%; background: rgba(243,238,251,0.25); }
.dots i.on { background: ${CYAN}; box-shadow: 0 0 14px ${CYAN}; }
.note { font-size: 28px; color: #a79fc4; }
`;

const SLIDES = [];
const slide = (id, tag, body, { foot = true } = {}) => SLIDES.push({ id, tag, body, foot });
function frame(s, idx, count) {
  const dots = Array.from({ length: count }, (_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="top"><div class="brand"><img src="../brand-mark.svg" alt=""><span>Rave<span class="g">FAM</span></span></div>${s.tag ? `<div class="tag">${s.tag}</div>` : ''}</div>
${s.body}
${s.foot ? `<div class="foot"><span>Free at <b>myravefam.com</b></span><span class="dots">${dots}</span></div>` : ''}
</body></html>`;
}
// Phone frame: shot is cropped to h px of screen height, starting at object-position pos.
const phone = (shot, { left, top, w = 520, h = 900, pos = 'top', cls = '' }) =>
  `<div class="phone ${cls}" style="left:${left}px;top:${top}px;width:${w}px"><div class="screen" style="height:${h}px"><img src="../shots/${shot}" style="object-position:${pos}"></div></div>`;

// 1. Hook over the real Tapesgiving Lineup Explorer page
slide('slide1', 'NOV 27–28 · CLEARWATER', `
  <div class="copy" style="top:190px;align-items:center;text-align:center">
    <h1 style="font-size:132px;line-height:0.92">Who’s your<br>Tapesgiving<br>crew?</h1></div>
  ${phone('explorer-hero.png', { left: 250, top: 630, w: 580, h: 560, pos: 'top', cls: '' })}`);

// 2. Lineup Explorer: the real lineup, logged out
slide('slide2', 'LINEUP EXPLORER', `<div class="copy">
  <div class="eyebrow">Tape B · both nights</div>
  <h1 style="font-size:92px">The full lineup,<br>one tap away.</h1>
  <div class="sub">G Jones, Moody Good, Space Wizard, <b>EAZYBAKED b2b Distinct Motive</b>, Claybrook, Dr. Ushuu.</div></div>
  ${phone('explorer-lineup.png', { left: 330, top: 620, w: 520, h: 580, pos: 'top', cls: 'c' })}
  <div class="sticker" style="left:64px;top:900px;font-size:52px">Free.<br>No login.</div>`);

// 3. Crew page + roster
slide('slide3', 'CREWS', `<div class="copy">
  <div class="eyebrow">Squad up</div>
  <h1 style="font-size:92px">Whole crew.<br>One page.</h1></div>
  ${phone('crew.png', { left: 64, top: 470, w: 460, h: 660, pos: 'center 6%' })}
  <div class="cap" style="left:64px;width:460px;top:1170px">Who’s going</div>
  ${phone('crew-manifest.png', { left: 556, top: 470, w: 460, h: 660, pos: 'center 72%', cls: 'c' })}
  <div class="cap" style="left:556px;width:460px;top:1170px">The roster</div>`);

// 4. Meetup poll
slide('slide4', 'GAME PLAN', `<div class="copy">
  <div class="eyebrow">Settle it in the group</div>
  <h1 style="font-size:100px">“Where we<br>meeting?”</h1>
  <div class="sub">Drop a poll. The crew votes. Done.</div></div>
  ${phone('poll.png', { left: 280, top: 640, w: 520, h: 560, pos: 'center 64%', cls: 'g' })}`);

// 5. CTA
slide('slide5', null, `
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:44px;padding:0 80px">
    <img src="../brand-mark.svg" style="width:170px;height:170px;filter:drop-shadow(0 0 30px rgba(57,255,20,0.45))" alt="">
    <h1 style="font-size:110px">Your crew.<br>One plan.</h1>
    <div class="sub">Lineups, crews, polls and rides. Free for the FAM.</div>
    <img src="../appstore-badge.svg" style="height:120px;margin-top:10px" alt="Download on the App Store">
    <div style="font-family:Urbanist;font-weight:900;font-size:96px;color:${GREEN};text-shadow:0 0 14px ${GREEN},0 0 46px rgba(57,255,20,0.6)">Link in bio</div>
    <div class="note">or myravefam.com</div>
  </div>`, { foot: false });

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const [i, s] of SLIDES.entries()) {
  const file = path.join(HERE, 'html', s.id + '.html');
  writeFileSync(file, frame(s, i, SLIDES.length));
  await page.goto('file://' + file, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check('900 40px Urbanist'));
  if (!ok) console.warn('WARN: Urbanist 900 did not load for', s.id);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, s.id + '.png') });
}
await browser.close();
rmSync(path.join(HERE, 'html'), { recursive: true, force: true });
console.log(`Rendered ${SLIDES.length} slides to ${OUT}`);
