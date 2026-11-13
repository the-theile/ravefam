// Builds the "Huddle pings" push-notification carousel (1080×1350) as HTML, then
// renders it to ../slideN.png with Playwright. Screens in ./shots come from the
// real app via capture.spec.js (demo crew "Bass Syndicate": Sam, Kai, Jess).
// Notification cards on slide 1 use the real push titles from
// supabase/functions/send-mention-push and send-beacon-push.
// Run from the repo root: node marketing/huddle-push-2026/_build/slides.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
mkdirSync(path.join(HERE, 'html'), { recursive: true });

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Urbanist:wght@700;800;900&display=swap');
* { box-sizing: border-box; margin: 0; }
html, body { width: 1080px; height: 1350px; }
body { position: relative; overflow: hidden; background: #050509; color: #f3eefb; font-family: 'Space Grotesk', sans-serif; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(900px 700px at 0% 0%, rgba(255,45,120,0.34), transparent 60%),
  radial-gradient(800px 700px at 100% 100%, rgba(0,245,255,0.24), transparent 60%),
  radial-gradient(600px 500px at 100% 0%, rgba(57,255,20,0.10), transparent 60%), #050509; }
.rings { position: absolute; right: -260px; top: -260px; width: 820px; height: 820px; border-radius: 50%;
  background: repeating-radial-gradient(circle, transparent 0 46px, rgba(0,245,255,0.07) 46px 48px);
  -webkit-mask-image: radial-gradient(circle, #000 30%, transparent 70%); }
.top { position: absolute; top: 56px; left: 64px; right: 64px; display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; font-family: 'Urbanist'; font-weight: 900; font-size: 36px; }
.brand img { width: 54px; height: 54px; }
.brand .g { color: #39FF14; }
.tag { font-family: 'Urbanist'; font-weight: 800; font-size: 22px; letter-spacing: 0.2em; padding: 12px 22px; border-radius: 999px;
  border: 1.5px solid rgba(255,45,120,0.7); color: #fff; background: rgba(255,45,120,0.12); }
.copy { position: absolute; left: 64px; right: 64px; top: 168px; display: flex; flex-direction: column; gap: 20px; }
.eyebrow { font-family: 'Urbanist'; font-weight: 800; font-size: 28px; letter-spacing: 0.24em; text-transform: uppercase; color: #00F5FF; }
h1 { font-family: 'Urbanist'; font-weight: 900; line-height: 0.95; letter-spacing: -0.01em;
  background: linear-gradient(100deg, #FF2D78 0%, #ff7ab0 40%, #00F5FF 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 28px rgba(255,45,120,0.35)); }
.emo { color: #fff; filter: drop-shadow(0 0 24px rgba(255,45,120,0.6)); }
.sub { font-size: 36px; line-height: 1.32; color: #cfc6ea; }
.sub b { color: #fff; }
.phone { position: absolute; left: 50%; transform: translateX(-50%); width: 580px; border-radius: 74px; padding: 16px; background: #0d0a1c;
  border: 2px solid rgba(243,238,251,0.18); box-shadow: 0 40px 120px -20px rgba(255,45,120,0.5), 0 0 0 10px rgba(255,255,255,0.03); }
.phone .screen { border-radius: 60px; overflow: hidden; background: #050509; }
.phone .screen img { display: block; width: 100%; object-fit: cover; height: 100%; }
.card { position: absolute; left: 50%; transform: translateX(-50%) rotate(-1.5deg); border-radius: 34px; overflow: hidden;
  box-shadow: 0 30px 110px -18px rgba(0,245,255,0.45), 0 0 0 2px rgba(243,238,251,0.14); }
.card img { display: block; width: 100%; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 104px; display: flex; align-items: center; justify-content: space-between; padding: 0 64px;
  background: linear-gradient(0deg, rgba(5,5,9,0.97), rgba(5,5,9,0.8)); border-top: 1px solid rgba(243,238,251,0.12); font-size: 26px; color: #cfc6ea; }
.foot b { color: #fff; }
.dots { display: flex; gap: 10px; }
.dots i { width: 14px; height: 14px; border-radius: 50%; background: rgba(243,238,251,0.25); }
.dots i.on { background: #FF2D78; box-shadow: 0 0 14px #FF2D78; }
.lock { position: absolute; left: 0; right: 0; top: 440px; text-align: center; }
.lock .dt { font-size: 32px; color: #cfc6ea; font-weight: 500; }
.lock .tm { font-size: 200px; font-weight: 500; letter-spacing: -0.04em; color: #fff; line-height: 1; }
.notifs { position: absolute; left: 64px; right: 64px; top: 760px; display: flex; flex-direction: column; gap: 18px; }
.notif { border-radius: 38px; padding: 26px 30px; display: flex; gap: 22px; align-items: flex-start;
  background: rgba(40,34,60,0.82); border: 1.5px solid rgba(255,255,255,0.12); box-shadow: 0 24px 70px -24px rgba(0,0,0,0.9); }
.notif.hot { border-color: rgba(255,45,120,0.7); box-shadow: 0 0 0 1px rgba(255,45,120,0.3), 0 20px 70px -20px rgba(255,45,120,0.55); }
.notif img { width: 78px; height: 78px; border-radius: 20px; background: #050509; padding: 8px; flex: none; }
.notif .body { flex: 1; min-width: 0; }
.notif .app { font-size: 22px; color: #b9b0d6; display: flex; justify-content: space-between; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.06em; }
.notif .ti { font-size: 31px; font-weight: 700; color: #fff; line-height: 1.22; }
.notif .bo { font-size: 28px; color: #d8d0f0; margin-top: 4px; line-height: 1.28; }
.notif.ghost { transform: scale(0.94); opacity: 0.55; margin-top: -54px; z-index: -1; height: 70px; }
.bubbles { display: flex; flex-direction: column; gap: 18px; margin-top: 16px; }
.bub { align-self: flex-start; max-width: 860px; font-size: 34px; line-height: 1.3; padding: 20px 30px; border-radius: 28px; background: rgba(20,16,36,0.9);
  border: 1.5px solid rgba(243,238,251,0.12); border-left: 6px solid var(--c, #00F5FF); }
.bub small { display: block; font-family: 'Urbanist'; font-weight: 900; font-size: 24px; letter-spacing: 0.16em; color: var(--c, #00F5FF); margin-bottom: 6px; }
.bub.me { align-self: flex-end; border-left: 1.5px solid rgba(243,238,251,0.12); border-right: 6px solid #FF2D78; background: rgba(60,10,35,0.7); }
.cta { margin-top: 18px; display: inline-flex; align-self: flex-start; gap: 16px; align-items: center; font-family: 'Urbanist'; font-weight: 900; font-size: 40px;
  padding: 24px 38px; border-radius: 999px; color: #050509; background: linear-gradient(100deg, #FF2D78, #00F5FF); box-shadow: 0 0 50px rgba(255,45,120,0.45); }
`;

const SLIDES = [];
const slide = (id, body) => SLIDES.push({ id, body });
function frame(s, idx, count) {
  const dots = Array.from({ length: count }, (_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div><div class="rings"></div>
<div class="top"><div class="brand"><img src="../brand-mark.svg" alt=""><span>Rave<span class="g">FAM</span></span></div><div class="tag">COMING TO iOS</div></div>
${s.body}
<div class="foot"><span>Push notifications · <b>RaveFAM iOS app</b> · link in bio</span><span class="dots">${dots}</span></div>
</body></html>`;
}
const phone = (shot, top, h, pos = 'top') => `<div class="phone" style="top:${top}px"><div class="screen" style="height:${h}px"><img src="../shots/${shot}" style="object-position:${pos}"></div></div>`;
const card = (shot, top, w) => `<div class="card" style="top:${top}px;width:${w}px"><img src="../shots/${shot}"></div>`;
const notif = (ti, bo, when, hot = false) => `<div class="notif${hot ? ' hot' : ''}"><img src="../brand-mark.svg" alt=""><div class="body">
  <div class="app"><span>RaveFAM</span><span>${when}</span></div><div class="ti">${ti}</div><div class="bo">${bo}</div></div></div>`;

// 1 · Hook: lock screen with real push titles (mention + Beacon)
slide('slide1', `<div class="copy"><h1 style="font-size:108px">Huddle pings<br>hit different <span class="emo">💖</span></h1></div>
  <div class="lock"><div class="dt">Tuesday, December 29</div><div class="tm">7:42</div></div>
  <div class="notifs">
    ${notif('📣 Beacon from Bass Syndicate', 'Pre-fest spot locked: taco truck lot across from the entrance 🌮', 'now', true)}
    ${notif('💬 Jess mentioned you in Bass Syndicate', '@Theile you better not be late this time 😤', '1m ago')}
    <div class="notif ghost"></div>
  </div>`);

// 2 · New plan drop
slide('slide2', `<div class="copy"><div class="eyebrow">📋 New plan drop?</div>
  <h1 style="font-size:92px">The plan's up.<br>Rides claimed.</h1></div>
  ${phone('huddle-plan.png', 450, 740)}`);

// 3 · Poll results
slide('slide3', `<div class="copy"><div class="eyebrow">🗳️ Poll results?</div>
  <h1 style="font-size:92px">The crew<br>has spoken.</h1>
  <div class="sub">Night 2 fits: decided. No scrolling back through <b>400 messages</b> to find out.</div></div>
  ${card('poll-card.png', 590, 760)}`);

// 4 · Pre-fest spot
slide('slide4', `<div class="copy"><div class="eyebrow">📍 Someone found the spot?</div>
  <h1 style="font-size:92px">You'll know<br>first.</h1></div>
  ${phone('huddle-spot.png', 450, 740)}`);

// 5 · CTA
slide('slide5', `<div class="copy" style="top:180px"><div class="eyebrow">Push notifications · RaveFAM iOS</div>
  <h1 style="font-size:104px">Nobody gets<br>left behind.</h1>
  <div class="sub">Crew pings straight to your lock screen. <b>Coming to the RaveFAM iOS app.</b></div>
  <div class="bubbles">
    <div class="bub" style="--c:#39FF14"><small>JESS</small>did anyone tell Marcus about the pre-fest spot</div>
    <div class="bub" style="--c:#00F5FF"><small>KAI</small>he never checks the group chat 💀</div>
    <div class="bub me">tagging him rn 👇</div>
  </div>
  <div class="cta">Tag that friend 👇</div></div>`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const [i, s] of SLIDES.entries()) {
  const file = path.join(HERE, 'html', s.id + '.html');
  writeFileSync(file, frame(s, i, SLIDES.length));
  await page.goto('file://' + file, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, s.id + '.png') });
}
await browser.close();
rmSync(path.join(HERE, 'html'), { recursive: true, force: true });
console.log(`Rendered ${SLIDES.length} slides to ${OUT}`);
