// ===== PUBLIC RAVE PAGE (/rave/:slug) =====
// Lightweight standalone page for logged-out visitors + link-preview crawlers.
// Logged-in visitors are bounced into the app at /app?rave=<slug>.
// Data comes only from the get_public_rave RPC (safe fields, anon role).
// Env: SUPABASE_ANON_KEY (same public anon key app.html uses).
'use strict';

const { SUPABASE_URL, fetchPublicRave, ogVersion } = require('./_public-rave');
const SITE = 'https://myravefam.com';
const DEFAULT_OG_IMAGE = SITE + '/og-image.png';
const AUTH_KEY = 'sb-tvpgopciioqbqmjjjigh-auth-token'; // supabase-js v2 default storage key
const MAP_PREFIX = SUPABASE_URL + '/storage/v1/object/public/festival-maps/';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#00F5FF');

function dateRange(dateStr, days) {
  const start = new Date(dateStr + 'T00:00:00Z');
  const n = Math.max(1, days || 1);
  const end = new Date(start.getTime() + (n - 1) * 86400000);
  const f = (d, o) => d.toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
  if (n === 1) return f(start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (start.getUTCFullYear() !== end.getUTCFullYear())
    return f(start, { month: 'short', day: 'numeric', year: 'numeric' }) + ' – ' + f(end, { month: 'short', day: 'numeric', year: 'numeric' });
  if (start.getUTCMonth() !== end.getUTCMonth())
    return f(start, { month: 'short', day: 'numeric' }) + ' – ' + f(end, { month: 'short', day: 'numeric' }) + ', ' + end.getUTCFullYear();
  return f(start, { month: 'short', day: 'numeric' }) + '–' + end.getUTCDate() + ', ' + end.getUTCFullYear();
}

function goingLine(count, past) {
  if (!count) return past ? '' : 'Be the first of your crew to plan this one.';
  const who = count === 1 ? '1 raver' : count + ' ravers';
  return past ? who + ' went' : who + ' going';
}

function lineupHtml(lineup) {
  if (!lineup || !lineup.length) return '';
  const hasNights = lineup.some((a) => a.night);
  const groups = {};
  lineup.forEach((a) => { const k = hasNights ? (a.night || 'More artists') : ''; (groups[k] = groups[k] || []).push(a); });
  return Object.keys(groups).map((k) => {
    const list = groups[k];
    const heads = list.filter((a) => a.headliner);
    const rest = list.filter((a) => !a.headliner);
    return '<div class="night">' +
      (k ? '<h3>' + esc(k) + '</h3>' : '') +
      (heads.length ? '<p class="heads">' + heads.map((a) => '<span>' + esc(a.name) + '</span>').join(' ') + '</p>' : '') +
      (rest.length ? '<p class="rest">' + rest.map((a) => '<span>' + esc(a.name) + '</span>').join(' ') + '</p>' : '') +
      '</div>';
  }).join('');
}

function page({ title, desc, url, image, body, color, slug, status }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RaveFAM">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#050509">
${status === 200 ? `<script>
try { if (localStorage.getItem(${JSON.stringify(AUTH_KEY)})) location.replace('/app?rave=' + encodeURIComponent(${JSON.stringify(slug)})); } catch (e) {}
</script>` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;600;900&display=swap" rel="stylesheet">
<style>
:root{--bg:#050509;--ink:#F4F6FF;--dim:#9AA0B8;--pink:#FF2D78;--cyan:#00F5FF;--green:#39FF14;--rave:${color};
  box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
*,*::before,*::after{box-sizing:inherit}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Urbanist,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:720px;margin:0 auto;padding:20px 22px 56px}
.brand{font-weight:900;letter-spacing:-.01em;text-decoration:none;font-size:1.05rem}
.brand b{color:var(--pink)}
.hero{position:relative;padding:72px 0 36px;overflow:hidden}
.rings{position:absolute;right:-120px;top:-40px;width:420px;height:420px;pointer-events:none;opacity:.55}
.rings circle{fill:none;stroke:var(--rave);stroke-width:1.5}
.rings circle:nth-child(2){opacity:.6}.rings circle:nth-child(3){opacity:.35}.rings circle:nth-child(4){opacity:.18}
@media (prefers-reduced-motion:no-preference){.rings circle{transform-origin:center;animation:pulse 4.8s ease-in-out infinite}
  .rings circle:nth-child(2){animation-delay:.3s}.rings circle:nth-child(3){animation-delay:.6s}.rings circle:nth-child(4){animation-delay:.9s}
  @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}}
h1{position:relative;font-weight:900;font-size:clamp(2.6rem,11vw,4.75rem);line-height:.95;letter-spacing:-.03em;margin:0 0 20px;text-shadow:0 0 28px color-mix(in srgb,var(--rave) 45%,transparent)}
.when{position:relative;font-size:1.2rem;font-weight:600;margin:0}
.where{position:relative;color:var(--dim);margin:2px 0 0}
.going{position:relative;display:inline-flex;align-items:center;gap:8px;margin-top:22px;font-weight:600}
.going::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green)}
.going.empty::before{display:none}
.recap{border-left:3px solid var(--rave);padding:10px 14px;margin:0 0 28px;color:var(--dim)}
.cta{display:block;text-align:center;background:var(--pink);color:#050509;font-weight:900;font-size:1.1rem;text-decoration:none;padding:16px 20px;border-radius:14px;box-shadow:0 0 24px rgba(255,45,120,.45)}
.cta:focus-visible,.brand:focus-visible,.alt:focus-visible{outline:3px solid var(--cyan);outline-offset:3px}
.cta-note{color:var(--dim);text-align:center;font-size:.92rem;margin:10px 0 0}
section{margin-top:48px}
h2{font-weight:900;font-size:1.5rem;letter-spacing:-.01em;margin:0 0 16px}
.night+.night{margin-top:24px}
h3{font-size:1rem;font-weight:600;color:var(--cyan);margin:0 0 6px}
.heads{font-weight:900;font-size:clamp(1.4rem,5.5vw,2rem);line-height:1.15;margin:0 0 10px}
.heads span+span::before,.rest span+span::before{content:"/";color:var(--rave);margin:0 .4em;font-weight:400}
.rest{color:var(--dim);font-size:1.02rem;margin:0}
.map img{max-width:100%;height:auto;border-radius:12px;display:block}
.alt{display:inline-block;margin-top:40px;color:var(--cyan);font-weight:600}
</style>
</head>
<body>
<div class="wrap">
<a class="brand" href="/">Rave<b>FAM</b></a>
${body}
</div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || '').toLowerCase().slice(0, 80);
  const url = SITE + '/rave/' + encodeURIComponent(slug);
  const rave = await fetchPublicRave(slug);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!rave || !rave.name) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.end(page({
      title: 'Rave not found · RaveFAM', desc: 'This rave link is broken or the rave was removed.',
      url, image: DEFAULT_OG_IMAGE, color: '#00F5FF', slug, status: 404,
      body: `<div class="hero"><h1>This rave isn't here.</h1>
<p class="where">The link may have a typo, or the rave was removed.</p></div>
<a class="cta" href="/">Browse raves on RaveFAM</a>`,
    }));
  }

  const past = !!rave.is_past;
  const color = safeColor(rave.color);
  const when = dateRange(rave.date, rave.days);
  const place = rave.venue && rave.venue.name
    ? rave.venue.name + (rave.venue.location || rave.location ? ', ' + (rave.venue.location || rave.location) : '')
    : (rave.location || '');
  const going = goingLine(rave.going_count, past);
  const lineup = rave.lineup || [];
  const top = lineup.slice(0, 3).map((a) => a.name);
  const more = lineup.length - top.length;
  const mapUrl = typeof rave.map_url === 'string' && rave.map_url.startsWith(MAP_PREFIX) ? rave.map_url : '';
  const joinHref = '/app?rave=' + encodeURIComponent(rave.slug) + '&tab=signup';

  const desc = [
    when + (place ? ' in ' + place : '') + '.',
    rave.going_count ? goingLine(rave.going_count, past) + '.' : '',
    top.length ? 'Lineup: ' + top.join(', ') + (more > 0 ? ' and ' + more + ' more.' : '.') : '',
  ].filter(Boolean).join(' ');

  const body = `
<div class="hero">
  <svg class="rings" viewBox="0 0 420 420" aria-hidden="true">
    <circle cx="210" cy="210" r="70"/><circle cx="210" cy="210" r="115"/><circle cx="210" cy="210" r="160"/><circle cx="210" cy="210" r="205"/>
  </svg>
  <h1>${esc(rave.name)}</h1>
  <p class="when">${esc(when)}</p>
  ${place ? `<p class="where">${esc(place)}</p>` : ''}
  ${going ? `<p class="going${rave.going_count ? '' : ' empty'}">${esc(going)}</p>` : ''}
</div>
${past ? `<p class="recap">This rave already happened. Here's who played.</p>` : ''}
<a class="cta" href="${esc(joinHref)}">${past ? 'Join RaveFAM' : 'Join RaveFAM to plan this with your crew'}</a>
<p class="cta-note">${past ? 'Keep your crew together for the next one.' : 'RSVP, see who in your crew is going, and build your game plan.'}</p>
${lineup.length ? `<section><h2>Lineup</h2>${lineupHtml(lineup)}</section>` : ''}
${mapUrl ? `<section class="map"><h2>Festival map</h2><img src="${esc(mapUrl)}" alt="Festival map for ${esc(rave.name)}" loading="lazy"></section>` : ''}
<a class="alt" href="/">Explore more lineups on RaveFAM</a>`;

  res.statusCode = 200;
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
  return res.end(page({
    title: rave.name + ' · RaveFAM', desc, url,
    image: SITE + '/api/rave-og?slug=' + encodeURIComponent(rave.slug) + '&v=' + ogVersion(rave), color, slug: rave.slug, status: 200, body,
  }));
};
