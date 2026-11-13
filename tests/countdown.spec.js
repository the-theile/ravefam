// api/countdown.js: /countdown/:token is the home-screen countdown page.
// countdownState() is the day maths shared by the page (shipped to the
// browser as source) and mirrored by the native widget, so it gets fixed-date
// tests; the handler gets stubbed-RPC tests for each response shape.
const { test, expect } = require('@playwright/test');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

async function render(query, rpcResult, { ok = true } = {}) {
  const handler = require('../api/countdown.js');
  const prevFetch = global.fetch;
  const prevKey = process.env.SUPABASE_ANON_KEY;
  const calls = [];
  process.env.SUPABASE_ANON_KEY = 'test-anon';
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok, json: async () => rpcResult };
  };
  try {
    const out = { headers: {} };
    await handler({ query }, {
      setHeader(k, v) { out.headers[k] = v; },
      set statusCode(c) { out.status = c; },
      end(body) { out.body = body; },
    });
    return { ...out, calls };
  } finally {
    global.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prevKey;
  }
}

const crew = (fests, extra = {}) => ({ id: 'c1', name: 'Bass Fam', color: '#ff2d78', fests, ...extra });

test.describe('countdown day maths (countdownState)', () => {
  const { _countdownState: state, _sortCrews: sortCrews } = require('../api/countdown.js');
  const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h);

  test('counts whole calendar days, whatever the time of day', () => {
    const c = crew([{ name: 'Hulaween', date: '2026-10-29', days: 4 }]);
    expect(state(c, at(2026, 10, 6, 0))).toMatchObject({ state: 'countdown', days: 23 });
    expect(state(c, at(2026, 10, 6, 23))).toMatchObject({ state: 'countdown', days: 23 });
    expect(state(c, at(2026, 10, 28))).toMatchObject({ state: 'tomorrow', days: 1 });
  });

  test('day-of, multi-day in progress, then ended', () => {
    const c = crew([{ name: 'Hulaween', date: '2026-10-29', days: 4 }]);
    expect(state(c, at(2026, 10, 29))).toMatchObject({ state: 'today', day: 1, of: 4 });
    expect(state(c, at(2026, 10, 30))).toMatchObject({ state: 'live', day: 2, of: 4 });
    expect(state(c, at(2026, 11, 1))).toMatchObject({ state: 'live', day: 4, of: 4 });
    expect(state(c, at(2026, 11, 2))).toMatchObject({ state: 'empty' });
  });

  test('skips a rave that just ended locally and moves to the next one', () => {
    const c = crew([{ name: 'Old', date: '2026-11-12', days: 1 }, { name: 'Next', date: '2026-11-20', days: 1 }]);
    const s = state(c, at(2026, 11, 13));
    expect(s.state).toBe('countdown');
    expect(s.fest.name).toBe('Next');
    expect(s.days).toBe(7);
  });

  test('crosses a DST change without an off-by-one', () => {
    const c = crew([{ name: 'After DST', date: '2026-11-10', days: 1 }]);
    expect(state(c, at(2026, 10, 31))).toMatchObject({ days: 10 });
  });

  test('no raves, or junk dates, is the empty state', () => {
    expect(state(crew([]), at(2026, 11, 13)).state).toBe('empty');
    expect(state(crew([{ name: 'x', date: null }]), at(2026, 11, 13)).state).toBe('empty');
  });

  test('all-crews list sorts soonest first, nothing-booked last', () => {
    const now = at(2026, 11, 13);
    const sorted = sortCrews([
      crew([], { name: 'Empty' }),
      crew([{ name: 'B', date: '2026-12-31', days: 1 }], { name: 'Later' }),
      crew([{ name: 'A', date: '2026-11-14', days: 3 }], { name: 'Soon' }),
    ], now);
    expect(sorted.map((c) => c.name)).toEqual(['Soon', 'Later', 'Empty']);
  });
});

test.describe('countdown page (api/countdown.js)', () => {
  const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  test('crew token renders the big number, title and app link', async () => {
    const r = await render({ t: TOKEN }, { ok: true, kind: 'crew', crews: [crew([{ name: 'Hulaween 2026', date: iso(23), days: 4, going: 6 }])] });
    expect(r.status).toBe(200);
    expect(r.calls[0].body).toEqual({ p_token: TOKEN });
    expect(r.body).toContain('<title>23 days to Hulaween 2026 · Bass Fam</title>');
    expect(r.body).toContain('class="big ">23</div>');
    expect(r.body).toContain('6 of the fam going');
    expect(r.body).toContain('href="/app?crew=c1"');
    expect(r.body).toContain('name="robots" content="noindex, nofollow"');
    expect(r.body).toContain('name="apple-mobile-web-app-title" content="Bass Fam"');
  });

  test('crew names are escaped everywhere', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const r = await render({ t: TOKEN }, { ok: true, kind: 'crew', crews: [crew([], { name: evil })] });
    expect(r.body).not.toContain(evil);
    expect(r.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // The embedded payload can't close the script tag either.
    expect(r.body).not.toMatch(/var data = [^\n]*<img/);
  });

  test('personal token lists every crew', async () => {
    const r = await render({ t: TOKEN }, { ok: true, kind: 'raver', crews: [
      crew([{ name: 'Eternal NYE', date: iso(48), days: 2, going: 3 }], { id: 'c2', name: 'Day Ones' }),
      crew([{ name: 'EDC Orlando', date: iso(9), days: 3, going: 4 }], { id: 'c3', name: 'Neon Nomads' }),
    ] });
    expect(r.body).toContain('Next up 🔊');
    expect(r.body.indexOf('EDC Orlando')).toBeLessThan(r.body.indexOf('Eternal NYE'));
  });

  test('?w=1 renders the compact tile', async () => {
    const r = await render({ t: TOKEN, w: '1' }, { ok: true, kind: 'crew', crews: [crew([{ name: 'X', date: iso(5), days: 1 }])] });
    expect(r.body).toContain('class="tile"');
  });

  test('?json=1 returns the raw payload for widgets', async () => {
    const payload = { ok: true, kind: 'crew', crews: [crew([])] };
    const r = await render({ t: TOKEN, json: '1' }, payload);
    expect(r.headers['Content-Type']).toContain('application/json');
    expect(JSON.parse(r.body)).toEqual(payload);
  });

  test('revoked and unknown tokens get a 404 page; malformed ones skip the RPC', async () => {
    const revoked = await render({ t: TOKEN }, { ok: false, reason: 'revoked' });
    expect(revoked.status).toBe(404);
    expect(revoked.body).toContain('Link turned off');
    const bad = await render({ t: 'nope' }, null);
    expect(bad.status).toBe(404);
    expect(bad.calls).toHaveLength(0);
    expect(bad.body).toContain('Countdown not found');
  });

  test('a failed lookup is a 503, never cached', async () => {
    const r = await render({ t: TOKEN }, null, { ok: false });
    expect(r.status).toBe(503);
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
});

// ── In the app: the crew page / Settings sheet, and the iOS widget sync ──
const { bootAuthedApp, seedData } = require('./helpers');

const COUNTDOWN_PAYLOAD = { ok: true, kind: 'raver', crews: [{ id: 'c1', name: 'Bass Fam', color: '#ff2d78', fests: [{ name: 'Hulaween', date: '2099-10-29', days: 4, going: 3 }] }] };

function countdownSeed() {
  const data = seedData();
  data.__rpc = { create_countdown_link: TOKEN, get_countdown: COUNTDOWN_PAYLOAD, revoke_countdown_link: true };
  return data;
}
const rpcCalls = (page, fn) => page.evaluate((f) => (window.__store.__rpcCalls || []).filter((c) => c.fn === f), fn);

test.describe('countdown sheet (app.html)', () => {
  test('the crew page button makes a crew link and shows it', async ({ page }) => {
    await bootAuthedApp(page, { data: countdownSeed() });
    await page.evaluate(() => openDetail('c1'));
    await page.getByRole('button', { name: '⏳ Countdown on your home screen' }).click();
    const overlay = page.locator('#countdown-overlay');
    await expect(overlay).toHaveClass(/open/);
    await expect(overlay.locator('input[aria-label="Countdown link"]')).toHaveValue(new RegExp(`/countdown/${TOKEN}$`));
    await expect(overlay.locator('a', { hasText: 'How to put it on your home screen' })).toHaveAttribute('href', `/countdown-guide?t=${TOKEN}`);
    expect((await rpcCalls(page, 'create_countdown_link'))[0].args).toEqual({ p_crew_id: 'c1' });
  });

  test('turning a link off asks first, then revokes it', async ({ page }) => {
    await bootAuthedApp(page, { data: countdownSeed() });
    await page.evaluate(() => openCountdownSheet('c1'));
    await page.locator('#countdown-overlay').getByRole('button', { name: 'Turn off this link' }).click();
    await expect(page.locator('#confirm-overlay')).toHaveClass(/open/);
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#countdown-sheet-body')).toContainText('Link turned off');
    expect((await rpcCalls(page, 'revoke_countdown_link'))[0].args).toEqual({ p_token: TOKEN });
  });

  test('Settings opens the personal all-crews link; Escape closes it', async ({ page }) => {
    await bootAuthedApp(page, { data: countdownSeed() });
    await page.evaluate(() => openMyCountdownSheet());
    await expect(page.locator('#countdown-sheet-title')).toHaveText('📲 Home screen countdown');
    await expect(page.locator('#countdown-sheet-body')).toContainText('Every crew you');
    expect((await rpcCalls(page, 'create_countdown_link'))[0].args).toEqual({});
    await page.keyboard.press('Escape');
    await expect(page.locator('#countdown-overlay')).not.toHaveClass(/open/);
  });
});

test.describe('iOS countdown widget sync (app.html)', () => {
  async function installCapacitorStub(page) {
    await page.addInitScript(() => {
      const native = window.__native = { calls: [] };
      const addListener = () => Promise.resolve({ remove() {} });
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          App: { addListener, getLaunchUrl: async () => undefined },
          PushNotifications: { addListener, checkPermissions: async () => ({ receive: 'denied' }) },
          CountdownWidget: {
            save: async (arg) => { native.calls.push({ name: 'save', arg }); },
            clear: async () => { native.calls.push({ name: 'clear' }); },
          },
        },
      };
    });
  }

  test('boot hands the personal countdown to the widget; sign-out clears it', async ({ page }) => {
    await installCapacitorStub(page);
    await bootAuthedApp(page, { data: countdownSeed() });
    await expect.poll(() => page.evaluate(() => window.__native.calls.filter((c) => c.name === 'save').length)).toBeGreaterThan(0);
    const saved = await page.evaluate(() => JSON.parse(window.__native.calls.find((c) => c.name === 'save').arg.json));
    expect(saved.token).toBe(TOKEN);
    expect(saved.crews).toEqual(COUNTDOWN_PAYLOAD.crews);
    expect((await rpcCalls(page, 'get_countdown'))[0].args).toEqual({ p_token: TOKEN });

    await page.evaluate(() => doLogout());
    await expect.poll(() => page.evaluate(() => window.__native.calls.some((c) => c.name === 'clear'))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('countdownWidgetToken'))).toBeNull();
  });

  test('a turned-off saved token is replaced once, and the retry stops there', async ({ page }) => {
    await installCapacitorStub(page);
    const data = countdownSeed();
    await page.addInitScript((uid) => {
      localStorage.setItem('countdownWidgetToken', JSON.stringify({ uid, token: 'OldTokenOldTokenOldTok' }));
    }, require('./helpers').TEST_UID);
    // get_countdown keeps answering "revoked": the old token is dropped, one
    // new link is made and tried, and then it gives up (no retry loop).
    data.__rpc.get_countdown = { ok: false, reason: 'revoked' };
    await bootAuthedApp(page, { data });
    await expect.poll(() => rpcCalls(page, 'create_countdown_link').then((c) => c.length)).toBe(1);
    const gets = await rpcCalls(page, 'get_countdown');
    expect(gets[0].args.p_token).toBe('OldTokenOldTokenOldTok');
    expect(gets[1].args.p_token).toBe(TOKEN);
  });
});
