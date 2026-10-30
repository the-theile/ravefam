// Builds the EDC Orlando 2026 campaign slides (1080×1350) as HTML, then renders
// them to ../postN-M.png with Playwright. Screens come from ./shots (captured
// with real set times + demo crew data by capture.spec.js).
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
mkdirSync(path.join(HERE, 'html'), { recursive: true });

const PINK = '#FF2D78', CYAN = '#00F5FF', GREEN = '#39FF14';
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Urbanist:wght@600;700;800;900&family=Space+Grotesk:wght@500;700&display=block');
* { box-sizing: border-box; margin: 0; }
html, body { width: 1080px; height: 1350px; }
body { position: relative; overflow: hidden; background: #050509; color: #f3f1fa; font-family: 'Urbanist', sans-serif; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(900px 700px at 0% 0%, rgba(255,45,120,0.34), transparent 60%),
  radial-gradient(800px 700px at 100% 100%, rgba(0,245,255,0.22), transparent 60%),
  radial-gradient(600px 500px at 100% 0%, rgba(57,255,20,0.10), transparent 60%), #050509; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(0,245,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,245,255,0.06) 1px, transparent 1px);
  background-size: 54px 54px; -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 80%); }
.top { position: absolute; top: 56px; left: 64px; right: 64px; display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; font-weight: 800; font-size: 34px; }
.brand img { width: 52px; height: 52px; }
.brand .g { color: ${GREEN}; }
.tag { font-family: 'Space Grotesk'; font-weight: 700; font-size: 22px; letter-spacing: 0.16em; padding: 12px 20px; border-radius: 999px;
  border: 1.5px solid rgba(0,245,255,0.5); color: ${CYAN}; background: rgba(5,5,9,0.6); }
.eyebrow { font-family: 'Space Grotesk'; font-weight: 700; font-size: 25px; letter-spacing: 0.26em; text-transform: uppercase; color: ${CYAN}; }
h1 { font-weight: 900; line-height: 0.95; letter-spacing: -0.01em; text-transform: uppercase;
  background: linear-gradient(100deg, ${PINK} 0%, #ff6fa8 40%, ${CYAN} 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 28px rgba(255,45,120,0.35)); }
.sub { font-size: 36px; font-weight: 600; line-height: 1.3; color: #c9c4dc; }
.sub b { color: #fff; font-weight: 800; }
.copy { position: absolute; left: 64px; right: 64px; top: 170px; display: flex; flex-direction: column; gap: 22px; }
.phone { position: absolute; left: 50%; transform: translateX(-50%); width: 560px; border-radius: 72px; padding: 16px; background: #0b0a14;
  border: 2px solid rgba(243,241,250,0.18); box-shadow: 0 40px 120px -20px rgba(255,45,120,0.5), 0 0 0 10px rgba(255,255,255,0.03); }
.phone .screen { border-radius: 58px; overflow: hidden; background: #050509; }
.phone .screen img { display: block; width: 100%; }
.card { position: absolute; left: 50%; transform: translateX(-50%); border-radius: 36px; overflow: hidden;
  box-shadow: 0 30px 100px -18px rgba(0,245,255,0.45), 0 0 0 2px rgba(243,241,250,0.14); }
.card img { display: block; width: 100%; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 104px; display: flex; align-items: center; justify-content: space-between; padding: 0 64px;
  background: linear-gradient(0deg, rgba(5,5,9,0.97), rgba(5,5,9,0.78)); border-top: 1px solid rgba(243,241,250,0.12);
  font-size: 27px; font-weight: 600; color: #c9c4dc; }
.foot b { color: #fff; font-weight: 800; }
.dots { display: flex; gap: 10px; }
.dots i { width: 14px; height: 14px; border-radius: 50%; background: rgba(243,241,250,0.25); }
.dots i.on { background: ${GREEN}; box-shadow: 0 0 14px ${GREEN}; }
.closers { display: flex; flex-direction: column; gap: 22px; margin-top: 10px; }
.night { border-radius: 30px; padding: 26px 32px; background: rgba(14,12,26,0.85); border: 1.5px solid rgba(243,241,250,0.14); }
.night .d { font-family: 'Space Grotesk'; font-weight: 700; font-size: 24px; letter-spacing: 0.2em; color: var(--c); margin-bottom: 14px; }
.row { display: flex; justify-content: space-between; align-items: baseline; font-size: 34px; padding: 6px 0; }
.row .n { font-weight: 800; color: #fff; }
.row .t { font-family: 'Space Grotesk'; font-weight: 700; color: var(--c); font-size: 30px; }
.row .s { font-weight: 600; color: #9d97b8; font-size: 26px; margin-left: 12px; }
.steps { display: flex; flex-direction: column; gap: 26px; margin-top: 16px; }
.step { display: flex; gap: 28px; align-items: center; padding: 30px 34px; border-radius: 30px; background: rgba(14,12,26,0.85); border: 1.5px solid rgba(243,241,250,0.14); }
.step .n { flex: none; width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; font-weight: 900; font-size: 40px; color: #050509;
  background: linear-gradient(135deg, ${PINK}, ${CYAN}); }
.step .t { font-size: 32px; font-weight: 600; line-height: 1.3; color: #c9c4dc; }
.step .t b { display: block; color: #fff; font-size: 40px; font-weight: 800; margin-bottom: 4px; }
.notif { position: absolute; left: 64px; right: 64px; border-radius: 40px; padding: 30px 34px; display: flex; gap: 24px; align-items: flex-start;
  background: rgba(36,32,54,0.88); border: 1.5px solid rgba(255,255,255,0.14); box-shadow: 0 24px 80px -20px rgba(0,0,0,0.8); }
.notif img { width: 84px; height: 84px; border-radius: 22px; background: #050509; padding: 8px; flex: none; }
.notif .app { font-size: 24px; font-weight: 700; color: #b3acd0; display: flex; justify-content: space-between; width: 100%; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.06em; }
.notif .ti { font-size: 34px; font-weight: 800; color: #fff; line-height: 1.25; }
.notif .bo { font-size: 30px; font-weight: 600; color: #d6d0ec; margin-top: 6px; line-height: 1.3; }
.notif .body { flex: 1; }
.lock { position: absolute; left: 0; right: 0; text-align: center; }
.lock .tm { font-family: 'Space Grotesk'; font-size: 190px; font-weight: 500; letter-spacing: -0.03em; color: #fff; line-height: 1; }
.lock .dt { font-size: 34px; font-weight: 600; color: #c9c4dc; margin-top: 8px; }
.vs { display: flex; align-items: center; justify-content: center; gap: 30px; margin-top: 8px; }
.vs .who { flex: 1; border-radius: 30px; padding: 28px; text-align: center; background: rgba(14,12,26,0.85); border: 2px solid var(--c); box-shadow: 0 0 40px -10px var(--c); }
.vs .who .n { font-size: 46px; font-weight: 900; color: #fff; line-height: 1.05; }
.vs .who .m { font-family: 'Space Grotesk'; font-size: 28px; font-weight: 700; color: var(--c); margin-top: 10px; }
.vs .x { font-size: 44px; font-weight: 900; color: ${GREEN}; }
`;

const SLIDES = [];
function slide(id, post, idx, count, body) { SLIDES.push({ id, post, idx, count, body }); }
function frame(s) {
  const dots = Array.from({ length: s.count }, (_, i) => `<i class="${i === s.idx - 1 ? 'on' : ''}"></i>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="top"><div class="brand"><img src="../brand-mark.svg" alt=""><span>Rave<span class="g">FAM</span></span></div><div class="tag">EDC ORLANDO · NOV 6–8</div></div>
${s.body}
<div class="foot"><span>Free · no signup · <b>myravefam.com/lineup-explorer</b></span><span class="dots">${dots}</span></div>
</body></html>`;
}
const phone = (shot, top, h = 1400, pos = 'top') => `<div class="phone" style="top:${top}px"><div class="screen" style="height:${h}px"><img src="../shots/${shot}" style="object-fit:cover;object-position:${pos};height:100%"></div></div>`;
// Cards stop 36px above the footer; anything taller fades out there.
const card = (shot, top, w = 880) => `<div class="card" style="top:${top}px;width:${w}px;max-height:${1350 - 104 - 36 - top}px;-webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 60px),transparent)"><img src="../shots/${shot}"></div>`;
const night = (d, c, rows) => `<div class="night" style="--c:${c}"><div class="d">${d}</div>${rows.map(([n, t, s]) =>
  `<div class="row"><span><span class="n">${n}</span><span class="s">${s}</span></span><span class="t">${t}</span></div>`).join('')}</div>`;

// ----- Post 1: set times just dropped -----
slide('post1-1', 1, 1, 3, `<div class="copy"><div class="eyebrow">⏰ Just dropped</div>
  <h1 style="font-size:116px">EDCO set<br>times are in.</h1>
  <div class="sub">Every artist, every stage, every time, <b>on one lineup you can actually plan with.</b></div></div>
  ${phone('explorer-lineup.png', 700, 900)}`);
slide('post1-2', 1, 2, 3, `<div class="copy"><div class="eyebrow">🌙 How each night ends</div>
  <h1 style="font-size:84px">Pick your<br>closer.</h1>
  <div class="closers">
    ${night('FRIDAY · NOV 6', PINK, [['David Guetta', '10:31 PM', 'Kinetic'], ['Wooli', '10:45 PM', 'Circuit']])}
    ${night('SATURDAY · NOV 7', CYAN, [['Kaskade', '10:31 PM', 'Kinetic'], ['Alison Wonderland', '10:45 PM', 'Circuit']])}
    ${night('SUNDAY · NOV 8', GREEN, [['Martin Garrix', '10:28 PM', 'Kinetic'], ['TroyBoi', '10:50 PM', 'Stereobloom']])}
  </div></div>`);
slide('post1-3', 1, 3, 3, `<div class="copy"><div class="eyebrow">📋 Build your weekend</div>
  <h1 style="font-size:96px">3 taps.<br>Zero spreadsheets.</h1>
  <div class="steps">
    <div class="step"><div class="n">1</div><div class="t"><b>Tap 📋 on your sets</b>Times and stages are right on every card.</div></div>
    <div class="step"><div class="n">2</div><div class="t"><b>Open My schedule</b>Your picks, day by day, clashes flagged.</div></div>
    <div class="step"><div class="n">3</div><div class="t"><b>Share one link</b>Your crew sees your picks next to theirs.</div></div>
  </div>
  <div class="sub" style="margin-top:12px"><b>Every set, all 5 stages,</b> on the Lineup Explorer.</div></div>`);

// ----- Post 2: clash control + crew -----
slide('post2-1', 2, 1, 3, `<div class="copy"><div class="eyebrow">⚡ Saturday clash alert</div>
  <h1 style="font-size:100px">The hardest<br>choice at EDCO.</h1>
  <div class="vs">
    <div class="who" style="--c:${CYAN}"><div class="n">Kaskade</div><div class="m">10:31 · Kinetic Field</div></div>
    <div class="x">VS</div>
    <div class="who" style="--c:${PINK}"><div class="n">Alison<br>Wonderland</div><div class="m">10:45 · Circuit Grounds</div></div>
  </div>
  <div class="sub" style="margin-top:20px">Team Kaskade or Team Alison? <b>Tell us below 👇</b></div></div>
  <div class="card" style="top:860px;width:760px;height:340px"><img src="../shots/explorer-schedule.png" style="margin-top:-290px"></div>`);
slide('post2-2', 2, 2, 3, `<div class="copy"><div class="eyebrow">🗓️ My schedule</div>
  <h1 style="font-size:92px">Split it.<br>Or pick a side.</h1>
  <div class="sub">My schedule <b>flags every overlap</b> before you're stuck choosing in the crowd. Your choice sticks, and your reminders follow it.</div></div>
  ${card('explorer-schedule.png', 640, 760)}`);
slide('post2-3', 2, 3, 3, `<div class="copy"><div class="eyebrow">👥 Bring the crew</div>
  <h1 style="font-size:92px">Who's your<br>crew catching?</h1>
  <div class="sub">See who's going, what they picked, and where your picks overlap. <b>Can't agree? Start a crew vote.</b></div></div>
  ${card('explorer-crew.png', 700, 920)}`);

// ----- Post 3: festival mode -----
slide('post3-1', 3, 1, 3, `<div class="copy"><div class="eyebrow">🎧 Festival mode</div>
  <h1 style="font-size:120px">On deck.</h1>
  <div class="sub">What's playing <b>now</b>, what's <b>up next</b>, and how long you've got to cross Tinker Field.</div></div>
  ${card('explorer-ondeck.png', 600, 800)}`);
slide('post3-2', 3, 2, 3, `<div class="lock" style="top:200px"><div class="tm">10:13</div><div class="dt">Sunday, November 8</div></div>
  <div class="notif" style="top:550px"><img src="../brand-mark.svg" alt=""><div class="body"><div class="app"><span>RaveFAM</span><span>now</span></div>
    <div class="ti">🎧 On deck: Martin Garrix in 15 min</div><div class="bo">Kinetic Field · 10:28 PM · 📋 your pick</div></div></div>
  <div class="notif" style="top:820px;opacity:.82;transform:scale(.96)"><img src="../brand-mark.svg" alt=""><div class="body"><div class="app"><span>RaveFAM</span><span>48m ago</span></div>
    <div class="ti">🎧 On deck: ATLiens in 15 min</div><div class="bo">Circuit Grounds · 9:40 PM · ⭐ Fam Fave</div></div></div>
  <div class="copy" style="top:1060px"><div class="sub" style="text-align:center"><b>Set reminders:</b> a ping 15 min before every pick.</div></div>`);
slide('post3-3', 3, 3, 3, `<div class="copy"><div class="eyebrow">Get the RaveFAM app</div>
  <h1 style="font-size:96px">Your crew's<br>home base.</h1>
  <div class="steps">
    <div class="step"><div class="n">👥</div><div class="t"><b>Crews + Huddle</b>Your squad, your chat, one meet-up spot.</div></div>
    <div class="step"><div class="n">🗺️</div><div class="t"><b>Game Plans</b>RSVPs, rides, totems and who's bringing what.</div></div>
    <div class="step"><div class="n">🔔</div><div class="t"><b>Alerts</b>Set reminders, plus a ping when a ♡ artist lands on a lineup.</div></div>
  </div>
  <div class="sub" style="margin-top:8px">Free. Built for the fam. 💗</div></div>`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const s of SLIDES) {
  const file = path.join(HERE, 'html', s.id + '.html');
  writeFileSync(file, frame(s));
  await page.goto('file://' + file);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, s.id + '.png') });
}
await browser.close();
console.log(`Rendered ${SLIDES.length} slides to ${OUT}`);
