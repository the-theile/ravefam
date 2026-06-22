// Test helpers: make app.html load fully offline by stubbing the Supabase CDN
// script (and other non-essential CDNs) before any app code runs.
//
// The stub installs a fake `window.supabase.createClient` whose client returns
// per-table seeded data and drives `onAuthStateChange` with a configurable
// initial session. This lets the app reach either the auth screen (no session)
// or the fully-booted main app (with a session + seed data) without a backend.

const SUPABASE_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

const TEST_UID = 'test-user-id';

/**
 * Build a fake Supabase session for an authenticated user.
 * `user_metadata.onboarded` is set so the app skips the onboarding wizard.
 */
function makeSession(over = {}) {
  return {
    access_token: 'test-token',
    user: {
      id: TEST_UID,
      email: over.email || 'tester@ravefam.test',
      user_metadata: { onboarded: true, ...(over.user_metadata || {}) },
      ...over.user,
    },
  };
}

/**
 * Realistic seed dataset keyed by Supabase table name. Shapes mirror what
 * loadAllData() reads (including the nested join arrays). Everything is owned
 * by TEST_UID so the app's "my data" filters include it.
 */
function seedData() {
  const added = '2024-01-01T00:00:00Z';
  return {
    festivals: [
      { id: 'f1', name: 'Tomorrowland', date: '2099-07-18', location: 'Boom, BE', color: '#FF2D78', days: null },
      { id: 'f2', name: 'Awakenings', date: '2099-10-12', location: 'Amsterdam, NL', color: '#00F5FF', days: null },
    ],
    ravers: [
      {
        id: 'r-you', name: 'Theile', handle: 'theile',
        is_you: true, created_by: TEST_UID, claimed_by: TEST_UID, status: 'claimed',
        base: 'Berlin, DE', gradient: 'linear-gradient(135deg,#FF2D78,#BF00FF)',
        avatar_url: null, blocked_tags: [], genres: ['Techno', 'House'], fav_artists: ['Charlotte de Witte'],
        raver_festivals: [{ festival_id: 'f1' }], raver_festival_interest: [{ festival_id: 'f2' }],
        instagram: '@theile', radiate: '', phone: '', phone_visible: false,
        met_story: '', notes: '', qr_token: 'qr-you',
        vibe_tags: ['warehouse'], custom_vibe_tags: [],
      },
      {
        id: 'r-sam', name: 'Sam P.', handle: 'samraves',
        is_you: false, created_by: TEST_UID, claimed_by: null, status: 'unclaimed',
        base: 'London, UK', gradient: 'linear-gradient(135deg,#00F5FF,#39FF14)',
        avatar_url: null, blocked_tags: [], genres: ['DnB'], fav_artists: [],
        raver_festivals: [{ festival_id: 'f1' }], raver_festival_interest: [],
        instagram: '', radiate: '', phone: '', phone_visible: false,
        met_story: '', notes: '', qr_token: 'qr-sam',
        vibe_tags: [], custom_vibe_tags: [],
      },
    ],
    crews: [
      {
        id: 'c1', name: 'Bass Syndicate', color: '#FF2D78',
        gradient: 'linear-gradient(90deg,#FF2D78,#BF00FF)', status: 'recruiting',
        leader_id: TEST_UID, totem_photo_url: null, invite_token: 'inv-c1',
        created_at: added,
        crew_members: [{ raver_id: 'r-you', added_at: added }, { raver_id: 'r-sam', added_at: added }],
      },
    ],
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ session?: object|null, data?: object, eruda?: string }} [opts]
 *   session=null → signed out (auth screen). data → per-table rows.
 *   eruda → JS injected as the eruda CDN body (default: empty/no-op).
 */
async function installSupabaseStub(page, opts = {}) {
  const session = opts.session ?? null;
  const data = opts.data ?? {};

  await page.route(SUPABASE_URL, async route => {
    const body = `
      (function () {
        const SESSION = ${JSON.stringify(session)};
        const DATA = ${JSON.stringify(data)};

        // Chainable, awaitable query builder bound to a table's seeded rows.
        function makeQuery(rows) {
          rows = rows || [];
          const list = { data: rows, error: null };
          const single = { data: rows[0] ?? null, error: null };
          const p = Promise.resolve(list);
          const proxy = new Proxy(function () {}, {
            get(_t, prop) {
              if (prop === 'then') return p.then.bind(p);
              if (prop === 'catch') return p.catch.bind(p);
              if (prop === 'finally') return p.finally.bind(p);
              if (prop === 'single' || prop === 'maybeSingle')
                return () => Promise.resolve(single);
              return () => proxy;
            },
            apply() { return proxy; },
          });
          return proxy;
        }

        const channel = {
          on() { return channel; },
          subscribe() { return channel; },
          unsubscribe() { return Promise.resolve('ok'); },
        };

        function createClient() {
          let authCb = null;
          const auth = {
            onAuthStateChange(cb) {
              authCb = cb;
              setTimeout(() => cb('INITIAL_SESSION', SESSION), 0);
              return { data: { subscription: { unsubscribe() {} } } };
            },
            getUser() { return Promise.resolve({ data: { user: SESSION?.user ?? null }, error: null }); },
            getSession() { return Promise.resolve({ data: { session: SESSION }, error: null }); },
            signInWithPassword() { return Promise.resolve({ data: { session: SESSION }, error: null }); },
            signInWithOtp() { return Promise.resolve({ data: {}, error: null }); },
            signUp() { return Promise.resolve({ data: { session: SESSION }, error: null }); },
            signOut() { if (authCb) setTimeout(() => authCb('SIGNED_OUT', null), 0); return Promise.resolve({ error: null }); },
            updateUser() { return Promise.resolve({ data: { user: SESSION?.user ?? null }, error: null }); },
            resetPasswordForEmail() { return Promise.resolve({ data: {}, error: null }); },
          };
          const storage = {
            from() {
              return {
                upload() { return Promise.resolve({ data: { path: '' }, error: null }); },
                remove() { return Promise.resolve({ data: [], error: null }); },
                getPublicUrl() { return { data: { publicUrl: '' } }; },
              };
            },
          };
          return {
            auth, storage,
            from(table) { return makeQuery(DATA[table]); },
            rpc() { return makeQuery([]); },
            channel() { return channel; },
            removeChannel() { return Promise.resolve('ok'); },
          };
        }

        window.supabase = { createClient };
      })();
    `;
    await route.fulfill({ contentType: 'text/javascript', body });
  });

  // Non-essential third-party CDNs.
  const erudaBody = opts.eruda ?? '';
  await page.route('**/cdn.jsdelivr.net/npm/eruda*', r => r.fulfill({ contentType: 'text/javascript', body: erudaBody }));
  await page.route('**/html2canvas*', r => r.fulfill({ contentType: 'text/javascript', body: 'window.html2canvas=function(){return Promise.resolve(document.createElement("canvas"));};' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/fonts.gstatic.com/**', r => r.abort());
}

/**
 * Boot the app as an authenticated user with seed data and wait for the main
 * shell. Dismisses the welcome popup / any open modal so flows are interactable.
 */
async function bootAuthedApp(page, opts = {}) {
  const errors = collectPageErrors(page);
  await installSupabaseStub(page, {
    session: opts.session ?? makeSession(opts.sessionOver),
    data: opts.data ?? seedData(),
    eruda: opts.eruda,
  });
  await page.goto('/app.html');
  await page.locator('#main-app').waitFor({ state: 'visible' });
  // Let bootApp's deferred wizard/welcome timers settle, then clear overlays.
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    if (typeof closeWelcomePopup === 'function') { try { closeWelcomePopup(); } catch (e) {} }
    document.querySelectorAll('.modal-overlay.open').forEach(o => o.classList.remove('open'));
  });
  return errors;
}

/** Collect uncaught page errors for assertions. */
function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

module.exports = {
  installSupabaseStub, collectPageErrors, bootAuthedApp,
  makeSession, seedData, SUPABASE_URL, TEST_UID,
};
