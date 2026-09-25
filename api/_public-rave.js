// Shared by api/rave.js (public page) and api/rave-og.js (preview image).
// The underscore prefix keeps Vercel from deploying this as its own function.
'use strict';

const crypto = require('crypto');

const SUPABASE_URL = 'https://tvpgopciioqbqmjjjigh.supabase.co';
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

// Returns the get_public_rave payload, or null for bad slugs / missing raves.
async function fetchPublicRave(slug) {
  if (!SLUG_RE.test(slug || '') || !process.env.SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_public_rave', {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!r.ok) return null;
    const rave = await r.json();
    return rave && rave.name ? rave : null;
  } catch (e) {
    console.error('get_public_rave failed', e);
    return null;
  }
}

function headliners(rave, max = 4) {
  return (rave.lineup || []).filter((a) => a.headliner).slice(0, max).map((a) => a.name);
}

function placeLabel(rave) {
  if (rave.venue && rave.venue.name) return rave.venue.name;
  return rave.location || '';
}

// Changes whenever anything drawn on the preview image changes, so chat apps
// that cache previews by URL pick up a fresh image.
function ogVersion(rave) {
  const key = [rave.name, rave.date, rave.days, rave.color, placeLabel(rave), headliners(rave).join('|')].join('~');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
}

module.exports = { SUPABASE_URL, SLUG_RE, fetchPublicRave, headliners, placeLabel, ogVersion };
