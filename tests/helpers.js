// Test helpers: make app.html load fully offline by stubbing the Supabase CDN
// script (and other non-essential CDNs) before any app code runs.
//
// The stub installs a fake `window.supabase.createClient` whose client returns
// empty data for every query and drives `onAuthStateChange` with a configurable
// initial session. This lets the app reach either the auth screen (no session)
// or the booted main app (with a session) without a real backend.

const SUPABASE_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ session?: object|null }} [opts]  session=null → signed out (auth screen)
 */
async function installSupabaseStub(page, opts = {}) {
  const session = opts.session ?? null;

  // Fulfil the Supabase CDN script with our fake implementation.
  await page.route(SUPABASE_URL, async route => {
    const body = `
      (function () {
        const SESSION = ${JSON.stringify(session)};

        // A chainable, awaitable query builder. Every method returns the same
        // proxy; awaiting it (or calling .then/.single) resolves to empty data.
        function makeQuery() {
          const result = { data: [], error: null };
          const single = { data: null, error: null };
          const p = Promise.resolve(result);
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
              // Fire asynchronously like the real SDK does on init.
              setTimeout(() => {
                cb(SESSION ? 'INITIAL_SESSION' : 'INITIAL_SESSION', SESSION);
              }, 0);
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
            auth,
            storage,
            from() { return makeQuery(); },
            rpc() { return makeQuery(); },
            channel() { return channel; },
            removeChannel() { return Promise.resolve('ok'); },
          };
        }

        window.supabase = { createClient };
      })();
    `;
    await route.fulfill({ contentType: 'text/javascript', body });
  });

  // Non-essential third-party CDNs: stub to empty so they never hit the network.
  await page.route('**/html2canvas*', r => r.fulfill({ contentType: 'text/javascript', body: 'window.html2canvas=function(){return Promise.resolve(document.createElement("canvas"));};' }));
  await page.route('**/eruda*', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/fonts.gstatic.com/**', r => r.abort());
}

/** Collect uncaught page errors for assertions. */
function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

module.exports = { installSupabaseStub, collectPageErrors, SUPABASE_URL };
