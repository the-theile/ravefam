// Serves app.html with its default Open Graph / Twitter meta tags swapped
// for invite-flavored ones, so crew-invite (?join=) and profile-claim
// (?claim=) links get a distinct preview card when shared. Only reached via
// the vercel.json rewrites that match those two query params -- every other
// request to /app keeps serving the static file directly with its baseline
// OG tags untouched.
'use strict';

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://myravefam.com';

const META = {
  join: {
    title: "You're invited to the Crew on RaveFAM",
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
<meta property="og:title" content="RaveFAM — Your Crew. Your Raves. Your Tribe.">
<meta property="og:description" content="Build private crews, track festivals & local shows together, QR + 6-digit claim codes, profile claiming, shared memories. One home for your tribe.">
<meta property="og:image" content="https://myravefam.com/og-image.png">

<!-- Twitter / X Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="https://myravefam.com/app">
<meta name="twitter:title" content="RaveFAM — Your Crew. Your Raves. Your Tribe.">
<meta name="twitter:description" content="Build private crews, track festivals & local shows together, QR + 6-digit claim codes, profile claiming, shared memories. One home for your tribe.">
<meta name="twitter:image" content="https://myravefam.com/og-image.png">`;

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

module.exports = (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host || 'myravefam.com'}`);
  const kind = url.searchParams.has('join') ? 'join' : url.searchParams.has('claim') ? 'claim' : null;

  const html = fs.readFileSync(APP_HTML_PATH, 'utf8');

  const patched = kind
    ? html.replace(DEFAULT_OG_BLOCK, buildInviteOgBlock(META[kind], `${SITE_URL}${url.pathname}${url.search}`))
    : html;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400');
  res.status(200).send(patched);
};
