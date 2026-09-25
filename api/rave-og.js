// ===== RAVE PREVIEW IMAGE (/api/rave-og?slug=&v=) =====
// 1200x630 link-preview card for /rave/:slug, drawn with @vercel/og. Same
// look as the in-app rave share poster (renderRaveShareCard): the rave's
// accent fading to near-black, Fraunces uppercase headline, Outfit labels,
// dashed ticket stub with the date and a barcode. Laid out landscape.
// `v` is ogVersion() from the page — it only busts chat-app preview caches.
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchPublicRave, headliners, placeLabel } = require('./_public-rave');

const W = 1200, H = 630;
const INSET = 24;          // dark margin around the ticket
const STUB_W = 300;        // right-hand stub
const NOTCH = 26;          // perforation notch radius
const FALLBACK_IMAGE = 'https://myravefam.com/og-image.png';

// Same bar pattern as raveShareBarcodeHTML() in app.html.
const BARS = [2,1,3,1,2,4,1,2,1,3,2,1,4,1,2,3,1,1,2,4,1,3,2,1,2,1,4,1,3,2,1,2,1,3,1,4,2,1,2,3];
const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DOW = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

let _fonts = null;
function fonts() {
  if (_fonts) return _fonts;
  const f = (file) => fs.readFileSync(path.join(process.cwd(), 'fonts', file));
  _fonts = [
    { name: 'Fraunces', data: f('fraunces-latin-800-normal.woff'), weight: 800, style: 'normal' },
    { name: 'Fraunces', data: f('fraunces-latin-900-normal.woff'), weight: 900, style: 'normal' },
    { name: 'Outfit', data: f('outfit-latin-600-normal.woff'), weight: 600, style: 'normal' },
    { name: 'Outfit', data: f('outfit-latin-700-normal.woff'), weight: 700, style: 'normal' },
  ];
  return _fonts;
}

// Tiny element helper — @vercel/og takes React-shaped objects, no JSX needed.
const h = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });

const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#FF2D78');

function headlineSize(name) {
  const n = name.length;
  if (n <= 12) return 112;
  if (n <= 20) return 92;
  if (n <= 32) return 74;
  if (n <= 48) return 60;
  return 50;
}

function stubDate(rave) {
  const d = new Date(rave.date + 'T00:00:00Z');
  const days = Math.max(1, rave.days || 1);
  const end = new Date(d.getTime() + (days - 1) * 86400000);
  const sameMonth = end.getUTCMonth() === d.getUTCMonth();
  return {
    mon: MON[d.getUTCMonth()],
    num: String(d.getUTCDate()),
    sub: days === 1 ? DOW[d.getUTCDay()]
      : sameMonth ? `THRU ${end.getUTCDate()}` : `THRU ${MON[end.getUTCMonth()]} ${end.getUTCDate()}`,
    year: end.getUTCFullYear() > d.getUTCFullYear()
      ? `${d.getUTCFullYear()}–${String(end.getUTCFullYear()).slice(-2)}`
      : String(d.getUTCFullYear()),
  };
}

function card(rave) {
  const accent = safeColor(rave.color);
  const place = placeLabel(rave);
  const heads = headliners(rave);
  const date = stubDate(rave);
  const days = Math.max(1, rave.days || 1);
  const ticketW = W - INSET * 2;
  const perfX = ticketW - STUB_W; // x of the perforation inside the ticket

  const main = h({ flexDirection: 'column', flex: 1, padding: '44px 52px 40px' }, [
    h({ alignItems: 'center', gap: 16 }, [
      h({ fontFamily: 'Outfit', fontWeight: 700, fontSize: 20, letterSpacing: 6, color: 'rgba(255,255,255,0.6)' }, 'RAVEFAM PRESENTS'),
      days > 1 ? h({ padding: '4px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.16)', fontFamily: 'Outfit', fontWeight: 700, fontSize: 18, letterSpacing: 2, color: '#fff' }, `${days}-DAY`) : null,
    ].filter(Boolean)),
    h({
      marginTop: 22, fontFamily: 'Fraunces', fontWeight: 800, fontSize: headlineSize(rave.name),
      lineHeight: 1.02, textTransform: 'uppercase', color: '#fff', maxWidth: perfX - 104,
      lineClamp: 3, textShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }, rave.name),
    h({ flex: 1 }, []),
    place ? h({ fontFamily: 'Outfit', fontWeight: 600, fontSize: 30, color: 'rgba(255,255,255,0.82)', maxWidth: perfX - 104 }, place) : null,
    heads.length ? h({ marginTop: 20, paddingTop: 20, borderTop: '2px dashed rgba(255,255,255,0.3)', flexWrap: 'wrap', maxWidth: perfX - 104, fontFamily: 'Outfit', fontWeight: 700, fontSize: 30, color: '#fff' },
      heads.flatMap((name, i) => [
        i ? h({ color: accent, margin: '0 14px', fontWeight: 600 }, '/') : null,
        h({}, name),
      ]).filter(Boolean)) : null,
  ].filter(Boolean));

  const stub = h({ width: STUB_W, flexDirection: 'column', alignItems: 'center', padding: '44px 28px 34px', borderLeft: '3px dashed rgba(255,255,255,0.35)' }, [
    h({ fontFamily: 'Outfit', fontWeight: 700, fontSize: 32, letterSpacing: 4, color: 'rgba(255,255,255,0.92)' }, date.mon),
    h({ fontFamily: 'Fraunces', fontWeight: 900, fontSize: 150, lineHeight: 0.95, color: '#fff' }, date.num),
    h({ fontFamily: 'Outfit', fontWeight: 600, fontSize: 24, letterSpacing: 3, color: 'rgba(255,255,255,0.6)', marginTop: 6 }, date.sub),
    h({ fontFamily: 'Outfit', fontWeight: 600, fontSize: 22, letterSpacing: 3, color: 'rgba(255,255,255,0.45)', marginTop: 4 }, date.year),
    h({ flex: 1 }, []),
    h({ height: 56, gap: 3, alignItems: 'stretch', overflow: 'hidden', width: STUB_W - 56 },
      BARS.map((w) => h({ width: w * 2, background: 'rgba(255,255,255,0.55)' }, []))),
    h({ marginTop: 12, fontFamily: 'Outfit', fontWeight: 600, fontSize: 16, letterSpacing: 3, color: 'rgba(255,255,255,0.5)' }, 'MYRAVEFAM.COM'),
  ]);

  const notch = (top) => h({
    position: 'absolute', left: perfX - NOTCH + 1, top, width: NOTCH * 2, height: NOTCH * 2,
    borderRadius: NOTCH, background: '#05050b',
  }, []);

  return h({ width: W, height: H, background: '#05050b', padding: INSET }, [
    h({
      position: 'relative', flex: 1, borderRadius: 28, overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.12)',
      backgroundImage: `linear-gradient(160deg, ${accent} 0%, #1a0a2e 55%, #05050b 100%)`,
    }, [main, stub, notch(-NOTCH), notch(H - INSET * 2 - NOTCH)]),
  ]);
}

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || '').toLowerCase().slice(0, 80);
  const rave = await fetchPublicRave(slug);

  if (!rave) {
    res.statusCode = 302;
    res.setHeader('Location', FALLBACK_IMAGE);
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.end();
  }

  try {
    const { ImageResponse } = await import('@vercel/og');
    const img = new ImageResponse(card(rave), { width: W, height: H, fonts: fonts() });
    const png = Buffer.from(await img.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    // Versioned URLs (?v=) never change content, so cache them hard.
    res.setHeader('Cache-Control', req.query && req.query.v
      ? 'public, max-age=86400, s-maxage=31536000, immutable'
      : 'public, max-age=3600, s-maxage=86400');
    return res.end(png);
  } catch (e) {
    console.error('rave-og render failed', e);
    res.statusCode = 302;
    res.setHeader('Location', FALLBACK_IMAGE);
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }
};

module.exports._card = card; // exposed for tests
