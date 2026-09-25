// Rave share links: /rave/:slug is a lightweight public page (api/rave.js)
// that hands signed-in visitors to /app?rave=<slug>. The app stashes the slug
// (pendingRaveSlug), opens that rave once data loads, and — for brand-new
// ravers — waits until onboarding finishes. The share card's QR and share
// text point at the same public link.
const { test, expect } = require('@playwright/test');
const { installSupabaseStub, makeSession, seedData, collectPageErrors } = require('./helpers');

const SESSION_OVER = { user_metadata: { guidance_dismissed: true, onboarded: true } };
const AUTH_KEY = 'sb-tvpgopciioqbqmjjjigh-auth-token';

function seedWithSlugs() {
  const data = seedData();
  data.festivals = data.festivals.map(f => ({
    ...f, slug: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-2099',
  }));
  return data;
}

// Render an api/ handler in Node against a mocked get_public_rave RPC.
async function renderRavePage(slug, rave, file = '../api/rave.js', query = {}) {
  const handler = require(file);
  const prevFetch = global.fetch;
  const prevKey = process.env.SUPABASE_ANON_KEY;
  const calls = [];
  process.env.SUPABASE_ANON_KEY = 'test-anon';
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => rave };
  };
  try {
    const out = {};
    await handler({ query: { slug, ...query } }, {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(body) { out.status = this.statusCode; out.headers = this.headers; out.body = body; },
    });
    return { ...out, calls };
  } finally {
    global.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prevKey;
  }
}

const ETERNAL = {
  slug: 'eternal-nye-2026', name: 'Eternal NYE', date: '2026-12-30', days: 2,
  location: 'Orlando, Florida, United States', color: '#00F5FF', map_url: null,
  venue: null, is_past: false, is_archived: false, going_count: 4,
  lineup: [
    { name: 'Subtronics', headliner: true, night: null },
    { name: 'Evil <script>', headliner: false, night: null },
  ],
};

test.describe('rave share links — in the app', () => {
  test('a cold start with ?rave=<slug> opens that rave and strips the param', async ({ page }) => {
    const errors = collectPageErrors(page);
    await installSupabaseStub(page, { session: makeSession(SESSION_OVER), data: seedWithSlugs() });
    await page.goto('/app.html?rave=awakenings-2099');
    await page.locator('#main-app').waitFor({ state: 'visible' });

    await expect(page.locator('#rave-focus-overlay')).toHaveClass(/open/, { timeout: 4000 });
    expect(await page.evaluate(() => activeFestId)).toBe('f2');
    expect(await page.evaluate(() => location.search)).not.toContain('rave=');
    expect(await page.evaluate(() => localStorage.getItem('pendingRaveSlug'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('an unknown slug toasts instead of opening anything', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(SESSION_OVER), data: seedWithSlugs() });
    await page.goto('/app.html?rave=gone-rave-2099');
    await page.locator('#main-app').waitFor({ state: 'visible' });

    await expect(page.locator('#toast')).toContainText('no longer active', { timeout: 4000 });
    await expect(page.locator('#rave-focus-overlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => localStorage.getItem('pendingRaveSlug'))).toBeNull();
  });

  test('a malformed slug is ignored', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(SESSION_OVER), data: seedWithSlugs() });
    await page.goto('/app.html?rave=' + encodeURIComponent('<img src=x>'));
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.waitForTimeout(800);

    expect(await page.evaluate(() => localStorage.getItem('pendingRaveSlug'))).toBeNull();
    await expect(page.locator('#rave-focus-overlay')).not.toHaveClass(/open/);
  });

  test('a brand-new raver finishes onboarding before the rave opens', async ({ page }) => {
    const data = seedWithSlugs();
    data.ravers = []; data.crews = []; data.crew_members = [];
    data.raver_festivals = []; data.raver_festival_interest = [];
    await installSupabaseStub(page, { session: makeSession({ user_metadata: { onboarded: false } }), data });
    await page.goto('/app.html?rave=tomorrowland-2099');
    await page.locator('#main-app').waitFor({ state: 'visible' });

    await expect(page.locator('#onboarding-screen')).toHaveClass(/show/, { timeout: 4000 });
    await expect(page.locator('#rave-focus-overlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => localStorage.getItem('pendingRaveSlug'))).toBe('tomorrowland-2099');

    await page.evaluate(() => completeOnboarding());
    await expect(page.locator('#rave-focus-overlay')).toHaveClass(/open/, { timeout: 4000 });
    expect(await page.evaluate(() => activeFestId)).toBe('f1');
  });

  test('logout clears a pending rave link', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(SESSION_OVER), data: seedWithSlugs() });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.evaluate(() => localStorage.setItem('pendingRaveSlug', 'tomorrowland-2099'));
    await page.evaluate(() => doLogout());
    expect(await page.evaluate(() => localStorage.getItem('pendingRaveSlug'))).toBeNull();
  });

  test('share text and QR target are the public rave link', async ({ page }) => {
    await installSupabaseStub(page, { session: makeSession(SESSION_OVER), data: seedWithSlugs() });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });

    const out = await page.evaluate(() => ({
      text: buildRaveShareText(getFestival('f1')),
      url: raveShareUrl(getFestival('f1')),
      fallback: raveShareUrl({ name: 'No slug yet' }),
    }));
    expect(out.url).toBe('https://myravefam.com/rave/tomorrowland-2099');
    expect(out.text).toBe('Tomorrowland\nhttps://myravefam.com/rave/tomorrowland-2099');
    expect(out.fallback).toBe('https://myravefam.com');
  });
});

test.describe('rave share links — public page (api/rave.js)', () => {
  test('renders the rave with escaped content and per-rave preview tags', async () => {
    const r = await renderRavePage('eternal-nye-2026', ETERNAL);
    expect(r.status).toBe(200);
    expect(r.calls[0].body).toEqual({ p_slug: 'eternal-nye-2026' });
    expect(r.body).toContain('<meta property="og:title" content="Eternal NYE · RaveFAM">');
    expect(r.body).toContain('4 ravers going');
    expect(r.body).toContain('Evil &lt;script&gt;');
    expect(r.body).not.toContain('Evil <script>');
    expect(r.body).toContain('href="/app?rave=eternal-nye-2026&amp;tab=signup"');
  });

  test('past raves read as a recap', async () => {
    const r = await renderRavePage('eternal-nye-2026', { ...ETERNAL, is_past: true });
    expect(r.body).toContain('4 ravers went');
    expect(r.body).toContain('This rave already happened');
  });

  test('a missing rave is a 404 and a malformed slug never hits Supabase', async () => {
    const missing = await renderRavePage('nope-2026', null);
    expect(missing.status).toBe(404);
    const bad = await renderRavePage('../etc/passwd', ETERNAL);
    expect(bad.status).toBe(404);
    expect(bad.calls).toHaveLength(0);
  });

  test('a signed-in visitor is handed to the app; a signed-out one stays', async ({ page, baseURL }) => {
    const { body } = await renderRavePage('eternal-nye-2026', ETERNAL);
    await page.route('**/rave/eternal-nye-2026', route => route.fulfill({ status: 200, contentType: 'text/html', body }));
    await page.route('**/app?rave=*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>app</p>' }));
    await page.route('https://fonts.googleapis.com/**', route => route.abort());

    await page.goto(baseURL + '/rave/eternal-nye-2026');
    await expect(page.locator('h1')).toHaveText('Eternal NYE');

    await page.evaluate(k => localStorage.setItem(k, '{}'), AUTH_KEY);
    const handoff = page.waitForURL('**/app?rave=eternal-nye-2026');
    await page.reload();
    await handoff;
  });

  test('og:image points at a versioned per-rave image that changes with its content', async () => {
    const a = await renderRavePage('eternal-nye-2026', ETERNAL);
    const b = await renderRavePage('eternal-nye-2026', { ...ETERNAL, lineup: [{ name: 'Rezz', headliner: true }] });
    const img = (html) => html.match(/og:image" content="([^"]+)"/)[1];
    expect(img(a.body)).toMatch(/^https:\/\/myravefam\.com\/api\/rave-og\?slug=eternal-nye-2026&amp;v=[0-9a-f]{10}$/);
    expect(img(a.body)).not.toBe(img(b.body));
    expect(a.body).toContain('<meta property="og:image:width" content="1200">');
  });
});

test.describe('rave share links — preview image (api/rave-og.js)', () => {
  test('renders a 1200x630 PNG, cached hard when versioned', async () => {
    const r = await renderRavePage('eternal-nye-2026', ETERNAL, '../api/rave-og.js', { v: 'abc' });
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBe('image/png');
    expect(r.headers['Cache-Control']).toContain('immutable');
    expect(r.body.subarray(1, 4).toString()).toBe('PNG');
    expect(r.body.readUInt32BE(16)).toBe(1200);
    expect(r.body.readUInt32BE(20)).toBe(630);
  });

  test('a stub that crosses New Year shows both years', async () => {
    const { _card } = require('../api/rave-og.js');
    const tree = JSON.stringify(_card({ name: 'NYE', date: '2026-12-31', days: 2, lineup: [] }));
    expect(tree).toContain('THRU JAN 1');
    expect(tree).toContain('2026–27');
  });

  test('a missing rave falls back to the generic preview image', async () => {
    const r = await renderRavePage('nope-2026', null, '../api/rave-og.js');
    expect(r.status).toBe(302);
    expect(r.headers.Location).toBe('https://myravefam.com/og-image.png');
  });
});
