// ===== HOME SCREEN COUNTDOWN (/countdown/:token) =====
// "Days until" page for a crew's next rave (crew token) or every crew a raver
// is in (personal token). Made to live on a home screen: Safari "Add to Home
// Screen", Android shortcuts, Scriptable, and the native iOS widget's refresh.
//   /countdown/<token>          full page (Big Number look)
//   /countdown/<token>?w=1      compact tile, fills the viewport
//   /countdown/<token>?json=1   raw get_countdown payload (widget / Scriptable)
// Data comes only from the get_countdown RPC (safe fields, anon role).
// Day maths runs in the viewer's own timezone (countdownState, shipped to the
// browser as-is), so the number rolls over at their midnight, not the server's.
// Env: SUPABASE_ANON_KEY (same public anon key app.html uses).
'use strict';

const { SUPABASE_URL } = require('./_public-rave');
const SITE = 'https://myravefam.com';
const TOKEN_RE = /^[A-Za-z0-9_-]{16,40}$/;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#FF2D78');

// get_countdown payload, { ok:false, reason } for dead tokens, null on failure.
async function fetchCountdown(token) {
  if (!TOKEN_RE.test(token || '')) return { ok: false, reason: 'not_found' };
  if (!process.env.SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_countdown', {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && typeof data.ok === 'boolean' ? data : null;
  } catch (e) {
    console.error('get_countdown failed', e);
    return null;
  }
}

// Where a crew stands against its next rave, by the viewer's local calendar
// date. Self-contained on purpose: the page ships it to the browser via
// toString(), and CountdownWidget/CountdownModel.swift mirrors it.
//   { state: 'countdown'|'tomorrow'|'today'|'live'|'empty', fest, days, day, of }
function countdownState(crew, now) {
  const DAY = 86400000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fests = (crew && crew.fests) || [];
  for (const f of fests) {
    const p = String(f.date || '').split('-').map(Number);
    if (p.length !== 3 || !p[0]) continue;
    const start = new Date(p[0], p[1] - 1, p[2]);
    const len = Math.max(1, f.days || 1);
    const diff = Math.round((start - today) / DAY);
    if (diff > 1) return { state: 'countdown', fest: f, days: diff };
    if (diff === 1) return { state: 'tomorrow', fest: f, days: 1 };
    if (diff === 0) return { state: 'today', fest: f, days: 0, day: 1, of: len };
    if (-diff < len) return { state: 'live', fest: f, days: 0, day: 1 - diff, of: len };
    // ended in the viewer's timezone: try the next one
  }
  return { state: 'empty', fest: null, days: null };
}

// Soonest-first, crews with nothing booked last.
function sortCrews(crews, now) {
  const rank = (c) => {
    const s = countdownState(c, now);
    return s.state === 'empty' ? Infinity : s.days;
  };
  return [...(crews || [])].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
}

// Personal links carry `raves`: one row per rave you RSVP'd to (see
// get_countdown). Turn each into the crew shape countdownState/clientRender
// already use, with the subline built in. Self-contained: shipped to the
// browser via toString().
//   you + crewmates -> "You + 3 · AKPsi, Florida FAM +1"
//   just you        -> "Just you so far"
function raveCrews(raves) {
  return (raves || []).filter((r) => r.me !== false).map((r) => {
    const crews = r.crews || [];
    const lead = crews[0] || {};
    const names = crews.slice(0, 2).map((c) => c.name).join(', ') + (crews.length > 2 ? ` +${crews.length - 2}` : '');
    const others = r.others || 0;
    const sub = others ? `You + ${others}${names ? ' · ' + names : ''}` : 'Just you so far';
    return {
      id: lead.id || '',
      name: others ? names : 'Your next rave',
      color: lead.color,
      sub,
      fests: [{ name: r.name, date: r.date, days: r.days, location: r.location, going: others + 1 }],
    };
  });
}

const STYLE = `
:root{--bg:#050509;--surface:#0E0E16;--text:#F0EEFF;--muted:#8585A5;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:'DM Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
#cd{min-height:100%;display:flex;flex-direction:column}#cd>*{flex:1 0 auto}
.fp{min-height:100%;display:flex;flex-direction:column;text-align:center;padding:calc(env(safe-area-inset-top) + 40px) 22px calc(env(safe-area-inset-bottom) + 24px);
  background:radial-gradient(100% 60% at 50% 100%,rgba(var(--c-rgb),.35),transparent 70%),radial-gradient(80% 50% at 50% 0%,rgba(191,0,255,.18),transparent 70%),var(--bg)}
.crew{font:700 .75rem 'Outfit',sans-serif;letter-spacing:2px;color:var(--c);text-transform:uppercase}
.fest{font:900 clamp(1.6rem,7vw,2.4rem)/1.05 'Urbanist',sans-serif;margin:8px 0 4px}
.when{color:var(--muted);font-size:.85rem}
.big{font:900 clamp(6rem,38vw,11rem)/1 'Urbanist',sans-serif;letter-spacing:-.04em;margin-top:auto;color:#fff;text-shadow:0 0 34px rgba(var(--c-rgb),.8)}
.big.word{font-size:clamp(3.2rem,18vw,6rem);letter-spacing:-.01em;animation:pulse 1.6s ease-in-out infinite}
.big.quiet{font-size:clamp(1.6rem,8vw,2.4rem);color:var(--muted);text-shadow:none;letter-spacing:0;line-height:1.25}
@keyframes pulse{50%{text-shadow:0 0 44px rgba(var(--c-rgb),1)}}
.unit{font:800 .95rem 'Outfit',sans-serif;letter-spacing:4px;color:var(--c);text-transform:uppercase;margin-top:6px}
.hms{font:700 1.1rem ui-monospace,Menlo,monospace;margin-top:14px;letter-spacing:1px}
.going{margin:auto auto 0;padding-top:28px;font-size:.82rem;color:var(--muted)}
.open{display:block;margin-top:14px;font:700 .85rem 'Outfit',sans-serif;padding:13px;border-radius:14px;border:1px solid rgba(var(--c-rgb),.5);color:var(--c)}
.foot{margin-top:12px;font-size:.72rem;color:var(--muted)}
.foot a{text-decoration:underline}
.stack{min-height:100%;padding:calc(env(safe-area-inset-top) + 32px) 18px calc(env(safe-area-inset-bottom) + 24px);display:flex;flex-direction:column;gap:10px}
.stack h1{font:900 1.6rem 'Urbanist',sans-serif;margin:0 0 6px}
.srow{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:16px;background:var(--surface);border:1px solid rgba(var(--c-rgb),.3)}
.srow .n{font:900 2.2rem/1 'Urbanist',sans-serif;color:#fff;text-shadow:0 0 14px rgba(var(--c-rgb),.7);min-width:64px;text-align:right}
.srow .n small{display:block;font:700 .55rem ui-monospace,monospace;color:var(--c);letter-spacing:1px;text-shadow:none;margin-top:3px}
.srow .t{min-width:0;text-align:left}
.srow .t b{display:block;font:700 .95rem 'Outfit',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.srow .t span{font-size:.75rem;color:var(--c)}
.srow.none{opacity:.6}
.tile{display:flex;flex-direction:column;padding:8vmin 9vmin;background:radial-gradient(90% 70% at 50% 110%,rgba(var(--c-rgb),.28),transparent 70%),#07070c}
.tile .crew{font-size:6vmin;display:flex;align-items:center;gap:2vmin;text-align:left}
.tile .crew i{width:3.5vmin;height:3.5vmin;border-radius:50%;background:var(--c);box-shadow:0 0 3vmin var(--c)}
.tile .big{font-size:36vmin;margin-top:auto;text-align:left}
.tile .big.word{font-size:18vmin}.tile .big.quiet{font-size:10vmin}
.tile .unit{font-size:6vmin;text-align:left;margin-top:0}
.tile .fest{font:700 7.5vmin 'Outfit',sans-serif;margin:3vmin 0 0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dead{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;gap:10px}
.dead h1{font:900 1.6rem 'Urbanist',sans-serif;margin:0}
.dead p{color:var(--muted);margin:0;max-width:320px;line-height:1.5}
.dead a{margin-top:10px;font:700 .85rem 'Outfit',sans-serif;padding:12px 18px;border-radius:14px;background:linear-gradient(90deg,#FF2D78,#BF00FF);color:#fff}
`;

// Client renderer. Shipped as source with countdownState / sortCrews, so the
// first paint from the server and every later tick use identical maths.
function clientRender(data, mode) {
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#FF2D78');
  const rgb = (c) => {
    let h = col(c).slice(1); if (h.length < 6) h = h.split('').map((x) => x + x).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
  };
  const vars = (c) => `--c:${col(c)};--c-rgb:${rgb(c)}`;
  const d0 = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const whenLine = (f) => {
    const a = d0(f.date); const n = Math.max(1, f.days || 1);
    const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + n - 1);
    let s = `${DOW[a.getDay()]} ${MON[a.getMonth()]} ${a.getDate()}`;
    if (n > 1) s += ` – ${a.getMonth() === b.getMonth() ? '' : MON[b.getMonth()] + ' '}${b.getDate()}`;
    return s + (f.location ? ' · ' + f.location : '');
  };
  const going = (f) => (f && f.going ? `${f.going} of the fam going` : '');
  const bigFor = (s) => {
    if (s.state === 'countdown' || s.state === 'tomorrow') return { big: String(s.days), cls: '', unit: s.days === 1 ? 'day · pack tonight' : 'days' };
    if (s.state === 'today') return { big: "IT'S<br>TODAY", cls: 'word', unit: '' };
    if (s.state === 'live') return { big: `DAY ${s.day}`, cls: 'word', unit: `of ${s.of} · live now` };
    return { big: 'No rave locked in yet', cls: 'quiet', unit: '' };
  };
  const now = new Date();
  const appHref = (c) => (c.id ? `/app?crew=${encodeURIComponent(c.id)}` : '/app');
  // Personal links: one row per rave; drop any that just ended locally.
  const crews = data.raves
    ? raveCrews(data.raves).filter((c) => countdownState(c, now).state !== 'empty')
    : data.crews || [];

  if (mode === 'tile' || (data.kind === 'crew' && mode !== 'stack')) {
    const crew = data.kind === 'crew' ? crews[0] : sortCrews(crews, now)[0];
    if (!crew) return '<div class="dead"><h1>No crews yet</h1><p>Join a crew in RaveFAM to start a countdown.</p></div>';
    const s = countdownState(crew, now); const b = bigFor(s);
    if (mode === 'tile') {
      return `<a class="tile" style="${vars(crew.color)}" href="${appHref(crew)}" target="_top">
        <div class="crew"><i></i>${e(crew.name)}</div>
        <div class="big ${b.cls}">${b.big}</div>${b.unit ? `<div class="unit">${e(b.unit)}</div>` : ''}
        <div class="fest">${s.fest ? e(s.fest.name) : 'Tap → Dream Board'}</div></a>`;
    }
    let hms = '';
    if (s.state === 'tomorrow') {
      const ms = Math.max(0, d0(s.fest.date) - now);
      const p = (x) => String(x).padStart(2, '0');
      hms = `<div class="hms" data-tick>${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}</div>`;
    }
    return `<div class="fp" style="${vars(crew.color)}">
      <div class="crew">${e(crew.name)}${s.fest ? ' · next up' : ''}</div>
      ${s.fest ? `<div class="fest">${e(s.fest.name)}</div><div class="when">${e(whenLine(s.fest))}</div>` : ''}
      <div class="big ${b.cls}">${b.big}</div>${b.unit ? `<div class="unit">${e(b.unit)}</div>` : ''}${hms}
      <div class="going">${e(going(s.fest))}</div>
      <a class="open" href="${appHref(crew)}">${s.fest ? 'Open the crew in RaveFAM →' : 'Pick the next rave on the Dream Board →'}</a>
      <div class="foot"><a href="/countdown-guide">Put this on your home screen</a></div>
    </div>`;
  }

  const rows = sortCrews(crews, now).map((c) => {
    const s = countdownState(c, now);
    const n = s.state === 'countdown' || s.state === 'tomorrow' ? `${s.days}<small>${s.days === 1 ? 'DAY' : 'DAYS'}</small>`
      : s.state === 'today' ? 'NOW<small>TODAY</small>'
      : s.state === 'live' ? `D${s.day}<small>OF ${s.of}</small>` : '—';
    const sub = c.sub != null ? e(c.sub)
      : s.fest ? `${e(c.name)}${s.fest.going ? ' · ' + s.fest.going + ' going' : ''}` : e(c.name);
    return `<a class="srow${s.fest ? '' : ' none'}" style="${vars(c.color)}" href="${appHref(c)}">
      <div class="n">${n}</div><div class="t"><b>${s.fest ? e(s.fest.name) : 'Nothing locked in'}</b><span>${sub}</span></div></a>`;
  }).join('');
  return `<div class="stack"><h1>Next up 🔊</h1>${rows || '<p class="when">Join a crew in RaveFAM to start a countdown.</p>'}
    <div class="foot" style="text-align:center;margin-top:auto"><a href="/countdown-guide">Put this on your home screen</a></div></div>`;
}

function titleFor(data) {
  const now = new Date();
  const crews = data.raves ? raveCrews(data.raves) : (data.crews || []);
  const crew = data.kind === 'crew' ? crews[0] : sortCrews(crews, now)[0];
  if (!crew) return { title: 'RaveFAM countdown', short: 'Countdown', desc: 'Days until the next rave with your crew.' };
  const s = countdownState(crew, now);
  const short = data.kind === 'crew' ? crew.name : 'Next up';
  if (!s.fest) return { title: `${crew.name} · RaveFAM countdown`, short, desc: 'No rave locked in yet.' };
  const lead = s.state === 'countdown' ? `${s.days} days to ${s.fest.name}`
    : s.state === 'tomorrow' ? `1 day to ${s.fest.name}`
    : s.state === 'today' ? `${s.fest.name} is today` : `${s.fest.name} is live`;
  return { title: `${lead} · ${crew.name}`, short, desc: `${crew.name}'s countdown on RaveFAM.` };
}

function page({ title, short, desc, body, color, script }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RaveFAM">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="theme-color" content="#050509">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${esc(short)}">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@900&family=Outfit:wght@700;800&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLE}body{--c:${color}}</style>
</head>
<body>
<div id="cd">${body}</div>
${script || ''}
</body>
</html>`;
}

function deadPage(reason) {
  const revoked = reason === 'revoked';
  return page({
    title: 'RaveFAM countdown', short: 'Countdown',
    desc: 'Days until the next rave with your crew.', color: '#8585A5',
    body: `<div class="dead"><h1>${revoked ? 'Link turned off' : 'Countdown not found'}</h1>
      <p>${revoked ? 'Someone in the crew turned this countdown off. Grab a fresh link from the crew page in RaveFAM.' : 'This countdown link doesn’t exist. Check you copied the whole thing.'}</p>
      <a href="/app">Open RaveFAM</a></div>`,
  });
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const token = String(q.t || '').slice(0, 40);
  const data = await fetchCountdown(token);

  if (q.json) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', data ? 's-maxage=60, stale-while-revalidate=300' : 'no-store');
    res.statusCode = data ? 200 : 502;
    return res.end(JSON.stringify(data || { ok: false, reason: 'unavailable' }));
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!data) {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(page({
      title: 'RaveFAM countdown', short: 'Countdown', desc: '', color: '#8585A5',
      body: '<div class="dead"><h1>Can’t reach the dance floor</h1><p>Couldn’t load the countdown just now. Pull to refresh in a minute.</p></div>',
    }));
  }
  if (!data.ok) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.end(deadPage(data.reason));
  }

  const mode = q.w ? 'tile' : '';
  const meta = titleFor(data);
  const first = (data.kind === 'crew' ? data.crews[0] : sortCrews(data.raves ? raveCrews(data.raves) : data.crews, new Date())[0]) || {};
  // Re-render each second (only "tomorrow" shows seconds; cheap either way),
  // refetch every 30 min while open: a home-screen icon can sit for days.
  const script = `<script>
${countdownState.toString()}
${sortCrews.toString()}
${raveCrews.toString()}
${clientRender.toString()}
(function () {
  var data = ${JSON.stringify(data).replace(/</g, '\\u003c')};
  var mode = ${JSON.stringify(mode)};
  var root = document.getElementById('cd');
  function draw() { root.innerHTML = clientRender(data, mode); }
  draw();
  setInterval(draw, 1000);
  setInterval(function () {
    if (document.hidden) return;
    fetch(location.pathname + '?json=1', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) data = d; }).catch(function () {});
  }, 1800000);
})();
</script>`;

  res.statusCode = 200;
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res.end(page({
    title: meta.title, short: meta.short, desc: meta.desc,
    color: safeColor(first.color),
    body: clientRender(data, mode),
    script,
  }));
};

module.exports._countdownState = countdownState;
module.exports._sortCrews = sortCrews;
module.exports._raveCrews = raveCrews;
module.exports._clientRender = clientRender;
