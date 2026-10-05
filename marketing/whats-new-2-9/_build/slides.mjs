import { writeFileSync } from 'node:fs';
import { chromium } from '/home/user/ravefam/node_modules/@playwright/test/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = `
@import url('../fonts/local.css');
.crop { position:absolute; left:50%; transform:translateX(-50%); overflow:hidden; border-radius:36px; box-shadow: 0 30px 100px -18px rgba(177,92,255,0.6), 0 0 0 2px rgba(243,238,251,0.14); background:#07050f; }
.crop img { display:block; }
.crop.fade { -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 80px), transparent); }
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

// crop(shot, cssWidth, y0, y1, top, w): shows source CSS-px rows y0..y1 of a 3x screenshot at width w.
const crop = (shot, srcW, y0, y1, top, w, x0 = 0) => {
  const k = w / (srcW - x0);
  return `<div class="crop" style="top:${top}px;width:${w}px;height:${Math.round((y1 - y0) * k)}px"><img src="../shots/${shot}" style="width:${Math.round(srcW * k)}px;max-width:none;margin-top:${-Math.round(y0 * k)}px;margin-left:${-Math.round(x0 * k)}px"></div>`;
};
const SLIDES = [];
const slide = (id, badge, idx, body) => SLIDES.push({ id, badge, idx, body });
const frame = s => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="top"><div class="brand"><img src="../brand-mark.svg" alt=""><span>Rave<span class="g">FAM</span></span></div><div class="day">${s.badge}</div></div>
${s.body}
<div class="foot"><span>Free for your whole crew · <b>myravefam.com</b></span><span class="dots">${[1,2,3].map(i => `<i class="${i === s.idx ? 'on' : ''}"></i>`).join('')}</span></div>
</body></html>`;

slide('post1-profiles', 'NEW · 2.9', 1, `<div class="copy"><div class="eyebrow">Raver profiles, rebuilt</div>
  <h1 style="font-size:92px">Your fam,<br>at a glance.</h1>
  <div class="sub">Raves, Vibe, Crews and Us, one tap apart. <b>See every rave you're both going to.</b></div></div>
  ${crop('shot-profile-raves.png', 390, 597, 900, 590, 800)}`);
slide('post2-inbox', 'NEW · 2.8', 2, `<div class="copy"><div class="eyebrow">Notifications, sorted</div>
  <h1 style="font-size:92px">Less noise.<br>More vibes.</h1>
  <div class="sub">What <b>needs you</b> stays pinned up top. The rest is grouped by day and folded together.</div></div>
  ${crop('shot-notifs.png', 390, 72, 420, 575, 720, 11)}`);
slide('post3-settings', 'NEW · 2.7', 3, `<div class="copy"><div class="eyebrow">Settings hub</div>
  <h1 style="font-size:92px">Your rules.<br>One place.</h1>
  <div class="sub">Notifications, privacy, safety and login, <b>each with a quick summary.</b></div></div>
  ${crop('shot-settings.png', 390, 80, 408, 590, 700)}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
for (const s of SLIDES) {
  const file = path.join(HERE, 'html', s.id + '.html');
  writeFileSync(file, frame(s));
  await page.goto('file://' + file);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(HERE, s.id + '.png') });
}
await browser.close();
console.log('done');
