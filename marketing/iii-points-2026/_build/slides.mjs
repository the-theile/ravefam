// Builds the III Points 2026 carousel (5 slides, 1080×1350) as HTML, then
// renders them to ../slide-N.png with Playwright. Screens come from ./shots
// (captured with demo data by capture.spec.js).
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
mkdirSync(path.join(HERE, 'html'), { recursive: true });

const PINK = '#FF2D78', CYAN = '#00F5FF', GREEN = '#39FF14', BG = '#06050B';
// Inline the brand mark with its idle animation frozen at full glow.
const MARK = readFileSync(path.join(HERE, 'brand-mark.svg'), 'utf8')
  .replace(/<style>[\s\S]*?<\/style>/, '').replace(/class="freq-nav-core"/g, 'class="freq-nav-core" style="filter:drop-shadow(0 0 6px #39FF14)"');

const CSS = `
* { box-sizing: border-box; margin: 0; }
html, body { width: 1080px; height: 1350px; }
body { position: relative; overflow: hidden; background: ${BG}; color: #F4F2FA; font-family: 'Outfit', sans-serif; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(760px 620px at 0% 0%, rgba(255,45,120,0.22), transparent 62%),
  radial-gradient(760px 640px at 100% 100%, rgba(0,245,255,0.16), transparent 62%), ${BG}; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
  background-size: 54px 54px; -webkit-mask-image: radial-gradient(120% 80% at 50% 0%, #000 25%, transparent 75%); }
.top { position: absolute; top: 56px; left: 64px; right: 64px; display: flex; justify-content: space-between; align-items: center; z-index: 5; }
.brand { display: flex; align-items: center; gap: 14px; font-family: 'Urbanist'; font-weight: 900; font-size: 34px; }
.brand svg { width: 52px; height: 52px; }
.g { color: ${GREEN}; }
.tag { font-family: 'Urbanist'; font-weight: 800; font-size: 22px; letter-spacing: 0.16em; padding: 12px 22px; border-radius: 999px;
  border: 1.5px solid rgba(0,245,255,0.55); color: ${CYAN}; background: rgba(6,5,11,0.6); text-transform: uppercase; }
.eyebrow { font-family: 'Urbanist'; font-weight: 800; font-size: 26px; letter-spacing: 0.28em; text-transform: uppercase; color: ${CYAN}; }
h1 { font-family: 'Urbanist'; font-weight: 900; line-height: 0.92; letter-spacing: -0.02em; text-transform: uppercase; color: #fff; }
.pk { color: ${PINK}; text-shadow: 0 0 28px rgba(255,45,120,0.65); }
.cy { color: ${CYAN}; text-shadow: 0 0 28px rgba(0,245,255,0.55); }
.sub { font-size: 34px; line-height: 1.34; color: #C9C4DB; }
.sub b { color: #fff; font-weight: 700; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; display: flex; align-items: center; justify-content: space-between; padding: 0 64px;
  background: linear-gradient(0deg, rgba(6,5,11,0.97), rgba(6,5,11,0.8)); border-top: 1px solid rgba(255,255,255,0.1); font-size: 25px; color: #C9C4DB; z-index: 5; }
.foot b { color: #fff; font-weight: 700; }
.dots { display: flex; gap: 10px; }
.dots i { width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.22); }
.dots i.on { background: ${PINK}; box-shadow: 0 0 14px ${PINK}; }

/* checklist slides */
.list { position: absolute; top: 160px; left: 64px; right: 64px; display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; align-items: center; gap: 22px; padding: 18px 26px; border-radius: 24px; background: rgba(20,17,32,0.82); border: 1.5px solid rgba(255,255,255,0.1);
  font-family: 'Urbanist'; font-weight: 800; font-size: 34px; color: rgba(244,242,250,0.45); }
.row .ck { flex: none; width: 52px; height: 52px; border-radius: 50%; border: 3px dashed rgba(255,255,255,0.28); display: grid; place-items: center; }
.row.done { color: #fff; }
.row.done .ck { border: none; background: ${GREEN}; box-shadow: 0 0 22px rgba(57,255,20,0.75), 0 0 4px ${GREEN}; }
.row.now { border-color: ${GREEN}; background: rgba(57,255,20,0.07); box-shadow: 0 0 0 1px rgba(57,255,20,0.25), 0 0 40px -6px rgba(57,255,20,0.45); }
.row .n { margin-left: auto; font-size: 24px; letter-spacing: 0.12em; color: rgba(244,242,250,0.4); }
.row.done.now .n { color: ${GREEN}; }
.hl { position: absolute; left: 64px; right: 64px; display: flex; flex-direction: column; gap: 16px; }
.shot { position: absolute; left: 50%; transform: translateX(-50%); border-radius: 40px; overflow: hidden; background: #0c0a16;
  box-shadow: 0 30px 110px -16px var(--glow, rgba(255,45,120,0.55)), 0 0 0 2px rgba(255,255,255,0.12); }
.shot img { display: block; width: 100%; }
.shot.r { left: auto; right: 64px; transform: none; }
.shot.fade { -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 110px), transparent); }

/* hero */
.hero { position: absolute; top: 165px; left: 64px; right: 64px; z-index: 3; }
.hero h1 { font-size: 196px; }
.sky { position: absolute; left: 0; width: 100%; bottom: 96px; height: 580px; z-index: 1; }
.cta { display: inline-flex; align-items: center; gap: 18px; font-family: 'Urbanist'; font-weight: 900; font-size: 44px; color: ${BG}; background: ${PINK};
  padding: 28px 52px; border-radius: 999px; box-shadow: 0 0 0 3px rgba(255,45,120,0.35), 0 0 70px rgba(255,45,120,0.7); text-transform: uppercase; letter-spacing: 0.02em; }
`;

// ----- Miami skyline (seeded so every render matches) -----
function skyline() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const W = 1080, H = 640, WATER = 470; // waterline y
  let blds = '', wins = '', x = -10;
  // Hand-placed landmarks: the stacked, color-lit tower (Miami Tower) and a tall spire (Panorama).
  const marks = { 300: { w: 92, h: 330, kind: 'stack' }, 620: { w: 78, h: 390, kind: 'spire' }, 820: { w: 70, h: 300, kind: 'slant' } };
  while (x < W + 10) {
    const mk = Object.entries(marks).find(([mx]) => Math.abs(+mx - x) < 40);
    let w, h, kind = 'box';
    if (mk) { ({ w, h, kind } = mk[1]); delete marks[mk[0]]; }
    else { w = 34 + rnd() * 52; const mid = 1 - Math.abs(x - W * 0.55) / (W * 0.75); h = 70 + rnd() * 160 + mid * 120; }
    const y = WATER - h;
    const stroke = rnd() > 0.5 ? PINK : CYAN;
    if (kind === 'spire') blds += `<path d="M${x} ${WATER}V${y + 30}L${x + w / 2} ${y - 50}L${x + w} ${y + 30}V${WATER}Z" fill="#0d0b17" stroke="${CYAN}" stroke-width="2.5"/>`;
    else if (kind === 'slant') blds += `<path d="M${x} ${WATER}V${y + 40}L${x + w} ${y}V${WATER}Z" fill="#0d0b17" stroke="${PINK}" stroke-width="2.5"/>`;
    else if (kind === 'stack') {
      blds += `<path d="M${x} ${WATER}V${y + 60}H${x + 8}V${y + 26}H${x + 18}V${y}H${x + w - 18}V${y + 26}H${x + w - 8}V${y + 60}H${x + w}V${WATER}Z" fill="#0d0b17" stroke="${PINK}" stroke-width="2.5"/>`;
      [[y + 8, PINK], [y + 34, CYAN], [y + 68, GREEN]].forEach(([yy, c]) => { blds += `<rect x="${x + 20}" y="${yy}" width="${w - 40}" height="10" rx="3" fill="${c}"/>`; });
    } else blds += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#0d0b17" stroke="${stroke}" stroke-opacity="0.85" stroke-width="2"/>`;
    for (let wy = y + (kind === 'stack' ? 90 : 18); wy < WATER - 14; wy += 18)
      for (let wx = x + 8; wx < x + w - 8; wx += 13)
        if (rnd() > 0.72) wins += `<rect x="${wx.toFixed(1)}" y="${wy}" width="5" height="7" fill="${rnd() > 0.5 ? '#FFE9F1' : '#D6FEFF'}" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
    x += w + 4 + rnd() * 10;
  }
  const palm = (px, s, flip) => `<g transform="translate(${px} ${WATER}) scale(${flip ? -s : s} ${s})" fill="none" stroke="#06050B" stroke-width="7" stroke-linecap="round">
    <path d="M0 0 C6 -60 4 -120 18 -170"/>
    <g stroke="${GREEN}" stroke-width="4" opacity="0.9" filter="url(#glow)"><path d="M18 -170 C-10 -186 -40 -178 -60 -150"/><path d="M18 -170 C0 -205 -30 -214 -52 -206"/>
    <path d="M18 -170 C40 -206 74 -206 92 -186"/><path d="M18 -170 C52 -180 80 -160 92 -130"/><path d="M18 -170 C20 -210 36 -232 54 -238"/></g></g>`;
  return `<svg class="sky" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="sun" cx="50%" cy="100%" r="60%"><stop offset="0" stop-color="${PINK}" stop-opacity="0.75"/><stop offset="0.45" stop-color="${PINK}" stop-opacity="0.22"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></radialGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1a2a"/><stop offset="1" stop-color="${BG}"/></linearGradient>
    <linearGradient id="refl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="rm"><rect x="0" y="${WATER}" width="${W}" height="${H - WATER}" fill="url(#refl)"/></mask>
  </defs>
  <ellipse cx="${W * 0.55}" cy="${WATER}" rx="700" ry="380" fill="url(#sun)"/>
  <circle cx="${W * 0.55}" cy="${WATER - 40}" r="150" fill="${PINK}" opacity="0.18"/>
  <g filter="url(#glow)">${blds}</g>${wins}
  <rect x="0" y="${WATER}" width="${W}" height="${H - WATER}" fill="url(#water)"/>
  <g mask="url(#rm)" transform="translate(0 ${WATER * 2}) scale(1 -1)" opacity="0.7">${blds}</g>
  ${Array.from({ length: 9 }, (_, i) => `<rect x="${80 + rnd() * 900}" y="${WATER + 18 + i * 17}" width="${60 + rnd() * 160}" height="2" fill="${i % 2 ? CYAN : PINK}" opacity="${0.5 - i * 0.045}"/>`).join('')}
  <line x1="0" y1="${WATER}" x2="${W}" y2="${WATER}" stroke="${CYAN}" stroke-width="2" opacity="0.7" filter="url(#glow)"/>
  ${palm(70, 1.25, false)}${palm(150, 0.95, true)}${palm(1000, 1.2, true)}
</svg>`;
}

const check = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${BG}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const ITEMS = ['RSVP to III Points', 'Build the Game Plan', 'Pick your sets'];
const list = (step) => `<div class="list">${ITEMS.map((t, i) => {
  const done = i < step, now = i === step - 1;
  return `<div class="row${done ? ' done' : ''}${now ? ' now' : ''}"><span class="ck">${done ? check : ''}</span>${t}<span class="n">0${i + 1}</span></div>`;
}).join('')}</div>`;

const SLIDES = [];
const slide = (body, tag = 'Oct 16–17 · Miami', opts = {}) => SLIDES.push({ body, tag, ...opts });
function frame(s, i) {
  const dots = SLIDES.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@800;900&family=Outfit:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="top"><div class="brand">${s.bare ? '' : `${MARK}<span>Rave<span class="g">FAM</span></span>`}</div>${s.tag ? `<div class="tag">${s.tag}</div>` : ''}</div>
${s.body}
<div class="foot"><span>${s.foot || 'Link in bio · <b>myravefam.com</b>'}</span><span class="dots">${dots}</span></div>
</body></html>`;
}
const shot = (file, top, w, h, { glow, offset = 0 } = {}) =>
  `<div class="shot fade r" style="top:${top}px;width:${w}px;height:${h}px;${glow ? `--glow:${glow}` : ''}"><img src="../shots/${file}" style="margin-top:${-offset}px"></div>`;

// 1 — hero
slide(`<div class="hero"><div class="eyebrow">Mana Wynwood · Oct 16–17</div>
  <h1 style="margin-top:22px">III Points<br><span class="pk">is</span> <span class="cy">here</span></h1>
  <div class="sub" style="margin-top:30px;max-width:820px">Swipe for the <b>3-step squad checklist</b> before doors open. →</div></div>
  ${skyline()}`, '');

// 2–4 — checklist cards
slide(`${list(1)}
  <div class="hl" style="top:530px"><h1 style="font-size:84px">Lock in<br>your <span class="pk">RSVP</span></h1>
  <div class="sub" style="max-width:520px">Tap <b>Going</b> and your crew sees it instantly.</div></div>
  ${shot('app-rave.png', 510, 430, 650, { offset: 44, glow: 'rgba(57,255,20,0.45)' })}`);
slide(`${list(2)}
  <div class="hl" style="top:530px"><h1 style="font-size:84px">Split the<br><span class="cy">Game Plan</span></h1>
  <div class="sub" style="max-width:500px">Wristbands, the Airbnb, the meetup spot. <b>Every task has a name on it.</b></div></div>
  ${shot('app-gameplan.png', 510, 430, 650, { glow: 'rgba(0,245,255,0.45)' })}`);
slide(`${list(3)}
  <div class="hl" style="top:530px"><h1 style="font-size:84px">Pick sets in<br>the <span class="pk">Lineup</span><br><span class="pk">Explorer</span></h1>
  <div class="sub" style="max-width:470px">Four Tet, Underworld, Flying Lotus… see <b>who in your crew</b> is catching what.</div></div>
  ${shot('explorer-picks.png', 510, 430, 650, { offset: 0 })}`);

// 5 — CTA
slide(`<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:40px;padding:0 64px 60px">
  <div style="width:220px;height:220px;filter:drop-shadow(0 0 40px rgba(57,255,20,0.5))">${MARK.replace('width="72" height="72"', 'width="220" height="220"')}</div>
  <div style="font-family:Urbanist;font-weight:900;font-size:64px;letter-spacing:-0.01em">Rave<span class="g">FAM</span></div>
  <h1 style="font-size:132px">Plan it<br>with your<br><span class="pk">squad</span></h1>
  <div class="cta">Link in bio →</div>
  <div class="sub">RSVP · Game Plan · Lineup Explorer · <b>free</b></div></div>`, '', { bare: true, foot: 'See you on the dance floor, Miami 🌴' });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const [i, s] of SLIDES.entries()) {
  const file = path.join(HERE, 'html', `slide-${i + 1}.html`);
  writeFileSync(file, frame(s, i));
  await page.goto('file://' + file, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `slide-${i + 1}.png`) });
}
await browser.close();
console.log(`Rendered ${SLIDES.length} slides to ${OUT}`);
