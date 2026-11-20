// Builds the Rave Check launch carousel (1080×1350) as HTML, then renders it
// to ../slideN.png with Playwright. Screens in ./shots are real app.html
// renders with a made-up crew (capture.spec.js); the lock-screen slide is a
// mock of the iOS long-press reply, which is marked Coming soon.
// Run from the repo root: node marketing/rave-check-2026/_build/slides.mjs
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

.soon { display: inline-flex; align-items: center; gap: 12px; align-self: flex-start; font-family: 'Orbitron'; font-weight: 900; font-size: 26px; letter-spacing: 0.2em;
  padding: 14px 26px; border-radius: 999px; color: #0a0512; background: linear-gradient(100deg, #FFE600, #FF6B35); box-shadow: 0 0 40px rgba(255,200,0,0.45); }
.actions { position: absolute; left: 64px; right: 64px; display: flex; flex-direction: column; gap: 14px; }
.actions div { border-radius: 30px; padding: 24px 36px; font-size: 36px; font-weight: 700; background: rgba(38,32,58,0.86); border: 1.5px solid rgba(255,255,255,0.12); }
.actions .in { color: #39FF14; } .actions .maybe { color: #00F5FF; } .actions .no { color: #b9b0d6; }
.shot { position: absolute; left: 50%; transform: translateX(-50%); width: 900px; border-radius: 36px; overflow: hidden;
  box-shadow: 0 30px 100px -18px rgba(177,92,255,0.6), 0 0 0 2px rgba(243,238,251,0.14); }
.shot img { display: block; width: 100%; }
.ring { position: absolute; border-radius: 999px; border: 5px solid #39FF14; box-shadow: 0 0 0 8px rgba(57,255,20,0.18), 0 0 40px rgba(57,255,20,0.7); }
.press { position: absolute; right: 120px; width: 120px; height: 120px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.55); box-shadow: 0 0 0 18px rgba(255,255,255,0.08), 0 0 60px rgba(177,92,255,0.6); }
`;

const SLIDES = [];
function slide(id, day, idx, count, body, foot) { SLIDES.push({ id, day, idx, count, body, foot }); }
function frame(s) {
  const dots = Array.from({ length: s.count }, (_, i) => `<i class="${i === s.idx - 1 ? 'on' : ''}"></i>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="top"><div class="brand"><img src="../brand-mark.svg" alt=""><span>Rave<span class="g">FAM</span></span></div><div class="day">${s.day}</div></div>
${s.body}
<div class="foot"><span>${s.foot}</span><span class="dots">${dots}</span></div>
</body></html>`;
}
const phone = (shot, top, h, pos = 'top') => `<div class="phone" style="top:${top}px"><div class="screen" style="height:${h}px"><img src="../shots/${shot}" style="width:100%;height:100%;object-fit:cover;object-position:${pos}"></div></div>`;

const LIVE = 'Live now · <b>myravefam.com</b>';
const N = 5;
// ticket.png is 1170px wide (390pt @3x); px() maps its pixels onto the slide.
const SHOT_W = 760;
const px = v => Math.round(v * SHOT_W / 1170);

slide('slide1', 'NEW', 1, N, `<div class="copy"><div class="eyebrow">New on RaveFAM</div>
  <h1 style="font-size:150px">Rave<br>Check</h1>
  <div class="sub">Your crew's RSVP ghost<br>just got <b>checked</b> 👀</div></div>
  ${phone('crew.png', 690, 520, 'center 74%')}`, LIVE);

slide('slide2', 'NEW', 2, N, `<div class="copy"><div class="eyebrow">One tap · zero pressure</div>
  <h1 style="font-size:96px">You coming<br>or nah?</h1>
  <div class="sub">They answer <b>I'm in</b>, <b>Maybe</b> or <b>Can't make it</b>. Every answer is welcome.</div></div>
  ${phone('card.png', 600, 500, 'center 44%')}`, LIVE);

slide('slide3', 'NEW', 3, N, `<div class="copy"><div class="eyebrow">From your crew screen</div>
  <h1 style="font-size:92px">Right on the<br>Rave Plan</h1>
  <div class="sub">Open your crew and tap <b>🎧 Rave check</b> on the next rave. Just that crew, no digging.</div></div>
  <div class="shot" style="top:575px;width:${SHOT_W}px"><img src="../shots/ticket.png">
    <div class="ring" style="left:${px(650)}px;top:${px(804)}px;width:${px(316)}px;height:${px(104)}px"></div></div>`, LIVE);

slide('slide4', 'HOW IT WORKS', 4, N, `<div class="copy"><div class="eyebrow">Three taps, done</div>
  <h1 style="font-size:92px">No more<br>"so... are<br>we going??"</h1>
  <div class="steps">
    <div class="step"><div class="n">1</div><div class="t"><b>Tap Rave check</b>On your crew's Rave Plan or a rave's Crew tab. Add a note: Carpool? 🚗</div></div>
    <div class="step"><div class="n">2</div><div class="t"><b>They answer in one tap</b>In the app, with a push if notifications are on.</div></div>
    <div class="step"><div class="n">3</div><div class="t"><b>Watch the crew meter fill</b>See who's in at a glance. No spam: one check per 48h.</div></div>
  </div></div>`, LIVE);

slide('slide5', 'SNEAK PEEK', 5, N, `<div class="copy"><span class="soon">⏳ Coming soon to the iOS app</span>
  <h1 style="font-size:84px">Answer from<br>your lock screen</h1>
  <div class="sub">Long-press the push and tap your answer.</div></div>
  <div class="notif" style="top:640px"><img src="../brand-mark.svg" alt=""><div class="body"><div class="app"><span>RaveFAM</span><span>now</span></div>
    <div class="ti">🎧 Rave check from Alex</div><div class="bo">Eternal NYE: you in? “Carpool?”</div></div></div>
  <div class="actions" style="top:870px"><div class="in">I'm in</div><div class="maybe">Maybe</div><div class="no">Can't make it</div></div>`,
  'In the next RaveFAM iOS update');

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
