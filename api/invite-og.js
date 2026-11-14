// Serves app.html with its default Open Graph / Twitter meta tags swapped
// for invite-flavored ones, so crew-invite (?join=) and profile-claim
// (?claim=) links get a distinct preview card when shared. Only reached via
// the vercel.json rewrites that match those two query params -- every other
// request to /app keeps serving the static file directly with its baseline
// OG tags untouched.
'use strict';

const fs = require('fs');
const path = require('path');
const { SUPABASE_URL } = require('./_public-rave');

const SITE_URL = 'https://myravefam.com';

const META = {
  join: {
    title: "You're invited to a crew on RaveFAM 🎪",
    description: 'Tap to join — track festivals, share memories, and vibe together with your people.',
    image: `${SITE_URL}/og-invite-crew.png`,
  },
  claim: {
    title: 'Claim your spot on RaveFAM',
    description: 'A friend already added you to the crew. Tap to claim your profile and join them.',
    image: `${SITE_URL}/og-invite-claim.png`,
  },
};

const APP_HTML_PATH = path.join(process.cwd(), 'app.html');

const DEFAULT_OG_BLOCK = `<!-- Open Graph (Facebook, WhatsApp, iMessage) -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://myravefam.com/app">
<meta property="og:title" content="RaveFAM — Your Crew. Your Raves. Your FAM.">
<meta property="og:description" content="Build private crews, track festivals & local shows together, QR + 6-digit claim codes, profile claiming, shared memories. One home for your fam.">
<meta property="og:image" content="https://myravefam.com/og-image.png?v=2">

<!-- Twitter / X Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="https://myravefam.com/app">
<meta name="twitter:title" content="RaveFAM — Your Crew. Your Raves. Your FAM.">
<meta name="twitter:description" content="Build private crews, track festivals & local shows together, QR + 6-digit claim codes, profile claiming, shared memories. One home for your fam.">
<meta name="twitter:image" content="https://myravefam.com/og-image.png?v=2">`;

function escapeHtmlAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildInviteOgBlock({ title, description, image }, canonicalUrl) {
  const t = escapeHtmlAttr(title);
  const d = escapeHtmlAttr(description);
  const u = escapeHtmlAttr(canonicalUrl);
  return `<!-- Open Graph (Facebook, WhatsApp, iMessage) -->
<meta property="og:type" content="website">
<meta property="og:url" content="${u}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${image}">

<!-- Twitter / X Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="${u}">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${image}">`;
}

// Both RPCs are granted to anon (the signed-out splash uses them), so the
// preview shows exactly what the app itself would show the link's opener.
// A slow or failed lookup falls back to the generic card — unfurlers give up
// after a few seconds, and a plain preview beats none.
const LOOKUP_TIMEOUT_MS = 1500;
const TOKEN_RE = /^[A-Za-z0-9-]{8,80}$/;

async function rpc(fn, token) {
  if (!TOKEN_RE.test(token || '') || !process.env.SUPABASE_ANON_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && !data.error ? data : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const clip = (str, n) => (str.length > n ? str.slice(0, n - 1) + '…' : str);

// Crew name (and the invitee's first name, for a claim) when the link is live.
async function personalizedMeta(kind, token) {
  if (kind === 'join') {
    const crew = await rpc('get_crew_by_invite_token', token);
    if (!crew || !crew.name) return null;
    const name = clip(crew.name, 40);
    const n = crew.member_count || 0;
    return {
      ...META.join,
      title: `Join ${name} on RaveFAM 🎪`,
      description: n > 0
        ? `${n} raver${n === 1 ? '' : 's'} already in. Tap to see the crew and hop in — track festivals and find your people in the crowd.`
        : 'Tap to see the crew and hop in — track festivals and find your people in the crowd.',
    };
  }
  const preview = await rpc('get_claim_preview', token);
  const crewName = preview && preview.crew && preview.crew.name;
  if (!crewName) return null;
  const first = String((preview.raver && preview.raver.name) || '').trim().split(/\s+/)[0];
  return {
    ...META.claim,
    title: first
      ? `${clip(first, 20)}, your spot in ${clip(crewName, 40)} is saved 🎪`
      : `Your spot in ${clip(crewName, 40)} is saved 🎪`,
    description: `Your crew already added you on RaveFAM. Tap to claim your profile and join ${clip(crewName, 40)}.`,
  };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host || 'myravefam.com'}`);
  const kind = url.searchParams.has('join') ? 'join' : url.searchParams.has('claim') ? 'claim' : null;

  const html = fs.readFileSync(APP_HTML_PATH, 'utf8');
  const meta = kind && ((await personalizedMeta(kind, url.searchParams.get(kind))) || META[kind]);

  const patched = kind
    ? html.replace(DEFAULT_OG_BLOCK, buildInviteOgBlock(meta, `${SITE_URL}${url.pathname}${url.search}`))
    : html;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400');
  res.status(200).send(patched);
};

module.exports._personalizedMeta = personalizedMeta;
module.exports._DEFAULT_OG_BLOCK = DEFAULT_OG_BLOCK;
