// Test helpers: make app.html load fully offline by stubbing the Supabase CDN
// script (and other non-essential CDNs) before any app code runs.
//
// The stub installs a fake `window.supabase.createClient` backed by a STATEFUL
// in-memory store: insert/update/delete/upsert mutate the store, select reads
// it back (with filters + synthetic PostgREST-style joins), and the auth layer
// drives `onAuthStateChange` with a configurable session. This lets tests drive
// real write flows (RSVP, create crew, add/remove member, edit profile) and
// assert the data round-trips via a fresh loadAllData(), all with no backend.

const SUPABASE_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

const TEST_UID = 'test-user-id';

/** Build a fake authenticated session (onboarded → no wizard). */
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
 * Realistic, NORMALISED seed dataset keyed by table. Join children live in
 * their own tables (crew_members, raver_festivals, …) so relational writes are
 * reflected when the app re-reads via select('*, child(cols)').
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
        instagram: '@theile', radiate: '', phone: '', phone_visible: false,
        met_story: '', notes: '', qr_token: 'qr-you',
        vibe_tags: ['warehouse'], custom_vibe_tags: [],
      },
      {
        id: 'r-sam', name: 'Sam P.', handle: 'samraves',
        is_you: false, created_by: TEST_UID, claimed_by: null, status: 'unclaimed',
        base: 'London, UK', gradient: 'linear-gradient(135deg,#00F5FF,#39FF14)',
        avatar_url: null, blocked_tags: [], genres: ['DnB'], fav_artists: [],
        instagram: '', radiate: '', phone: '', phone_visible: false,
        met_story: '', notes: '', qr_token: 'qr-sam',
        vibe_tags: [], custom_vibe_tags: [],
      },
      {
        // A CLAIMED crew member with their own account — has an inbox, so adding
        // them to a festival should notify them.
        id: 'r-kai', name: 'Kai M.', handle: 'kaibeats',
        is_you: false, created_by: TEST_UID, claimed_by: 'kai-uid', status: 'claimed',
        base: 'Lisbon, PT', gradient: 'linear-gradient(135deg,#BF00FF,#FF2D78)',
        avatar_url: null, blocked_tags: [], genres: ['Techno'], fav_artists: [],
        instagram: '', radiate: '', phone: '', phone_visible: false,
        met_story: '', notes: '', qr_token: 'qr-kai',
        vibe_tags: [], custom_vibe_tags: [],
      },
    ],
    crews: [
      {
        id: 'c1', name: 'Bass Syndicate', color: '#FF2D78',
        gradient: 'linear-gradient(90deg,#FF2D78,#BF00FF)', status: 'recruiting',
        leader_id: TEST_UID, totem_photo_url: null, invite_token: 'inv-c1', created_at: added,
      },
    ],
    crew_members: [
      { crew_id: 'c1', raver_id: 'r-you', added_at: added, added_by: TEST_UID },
      { crew_id: 'c1', raver_id: 'r-sam', added_at: added, added_by: TEST_UID },
      { crew_id: 'c1', raver_id: 'r-kai', added_at: added, added_by: TEST_UID },
    ],
    raver_festivals: [
      { raver_id: 'r-you', festival_id: 'f1' },
      { raver_id: 'r-sam', festival_id: 'f1' },
    ],
    raver_festival_interest: [
      { raver_id: 'r-you', festival_id: 'f2' },
    ],
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ session?: object|null, data?: object, eruda?: string }} [opts]
 */
async function installSupabaseStub(page, opts = {}) {
  const session = opts.session ?? null;
  const data = opts.data ?? {};

  // Session produced by signInWithPassword / signUp (defaults to the initial
  // session). Pass loginSession explicitly to test the login transition from a
  // signed-out start.
  const loginSession = opts.loginSession !== undefined ? opts.loginSession : session;

  await page.route(SUPABASE_URL, async route => {
    const body = `
      (function () {
        const SESSION = ${JSON.stringify(session)};
        const LOGIN = ${JSON.stringify(loginSession)};
        const SEED = ${JSON.stringify(data)};
        const store = JSON.parse(JSON.stringify(SEED));
        let idc = 0;
        // parent table id (always 'id') → child rows matched on this FK column.
        const JOIN_FK = { crew_members: 'crew_id', raver_festivals: 'raver_id', raver_festival_interest: 'raver_id' };
        const clone = x => JSON.parse(JSON.stringify(x));

        // Parse a PostgREST select string into embedded relations.
        function parseRelations(sel) {
          const rels = [];
          if (!sel || sel === '*') return rels;
          let depth = 0, cur = '', parts = [];
          for (const ch of sel) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
          }
          if (cur) parts.push(cur);
          parts.forEach(p => {
            const m = p.trim().match(/^([a-z_]+)\\s*\\((.*)\\)$/);
            if (m) rels.push({ name: m[1], cols: m[2].split(',').map(s => s.trim()) });
          });
          return rels;
        }

        function attach(rows, rels) {
          if (!rels.length) return rows.map(clone);
          return rows.map(row => {
            const out = clone(row);
            rels.forEach(rel => {
              const fk = JOIN_FK[rel.name];
              const kids = (store[rel.name] || []).filter(c => fk && String(c[fk]) === String(row.id));
              out[rel.name] = kids.map(c => {
                if (rel.cols.length === 1 && rel.cols[0] === '*') return clone(c);
                const o = {}; rel.cols.forEach(col => { o[col] = c[col]; }); return o;
              });
            });
            return out;
          });
        }

        function makeBuilder(table) {
          const st = { table, op: 'select', sel: '*', payload: null, upsertOpts: null, filters: [], limit: null };
          const pred = row => st.filters.every(f => f(row));
          function exec() {
            const tbl = store[table] || (store[table] = []);
            if (st.op === 'select') {
              let rows = tbl.filter(pred);
              if (st.limit != null) rows = rows.slice(0, st.limit);
              return { data: attach(rows, parseRelations(st.sel)), error: null };
            }
            if (st.op === 'insert') {
              const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
              const ins = arr.map(r => { const row = clone(r); if (row.id == null) row.id = table + '-' + (++idc); tbl.push(row); return clone(row); });
              return { data: ins, error: null };
            }
            if (st.op === 'update') {
              const hit = tbl.filter(pred);
              hit.forEach(r => Object.assign(r, st.payload));
              return { data: hit.map(clone), error: null };
            }
            if (st.op === 'delete') {
              const hit = tbl.filter(pred);
              store[table] = tbl.filter(r => !pred(r));
              return { data: hit.map(clone), error: null };
            }
            if (st.op === 'upsert') {
              const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
              const keys = (st.upsertOpts && st.upsertOpts.onConflict) ? st.upsertOpts.onConflict.split(',').map(s => s.trim()) : ['id'];
              const ignore = st.upsertOpts && st.upsertOpts.ignoreDuplicates;
              const res = [];
              arr.forEach(r => {
                const ex = tbl.find(x => keys.every(k => String(x[k]) === String(r[k])));
                if (ex) { if (!ignore) Object.assign(ex, r); res.push(clone(ex)); }
                else { const row = clone(r); if (row.id == null && keys.length === 1 && keys[0] === 'id') row.id = table + '-' + (++idc); tbl.push(row); res.push(clone(row)); }
              });
              return { data: res, error: null };
            }
            return { data: [], error: null };
          }
          const b = {
            select(cols) { if (st.op === 'select') st.sel = cols || '*'; return b; },
            insert(p) { st.op = 'insert'; st.payload = p; return b; },
            update(p) { st.op = 'update'; st.payload = p; return b; },
            upsert(p, o) { st.op = 'upsert'; st.payload = p; st.upsertOpts = o || null; return b; },
            delete() { st.op = 'delete'; return b; },
            eq(c, v) { st.filters.push(r => String(r[c]) === String(v)); return b; },
            neq(c, v) { st.filters.push(r => String(r[c]) !== String(v)); return b; },
            in(c, a) { const s = (a || []).map(String); st.filters.push(r => s.includes(String(r[c]))); return b; },
            is(c, v) { st.filters.push(r => r[c] === v); return b; },
            match(o) { Object.entries(o || {}).forEach(([c, v]) => st.filters.push(r => String(r[c]) === String(v))); return b; },
            contains(c, v) { const need = Array.isArray(v) ? v : [v]; st.filters.push(r => Array.isArray(r[c]) && need.every(x => r[c].includes(x))); return b; },
            or(str) {
              const subs = String(str).split(',').map(s => s.trim());
              st.filters.push(r => subs.some(sub => {
                const m = sub.match(/^([a-z_]+)\\.([a-z]+)\\.(.*)$/);
                if (!m) return false;
                const col = m[1], op = m[2], val = m[3];
                if (op === 'eq') return String(r[col]) === String(val);
                if (op === 'neq') return String(r[col]) !== String(val);
                return false;
              }));
              return b;
            },
            order() { return b; }, limit(n) { st.limit = n; return b; }, range() { return b; }, abortSignal() { return b; },
            single() { const r = exec(); return Promise.resolve({ data: (r.data && r.data[0]) ?? null, error: r.error }); },
            maybeSingle() { const r = exec(); return Promise.resolve({ data: (r.data && r.data[0]) ?? null, error: r.error }); },
            then(f, j) { return Promise.resolve(exec()).then(f, j); },
            catch(j) { return Promise.resolve(exec()).catch(j); },
            finally(cb) { return Promise.resolve(exec()).finally(cb); },
          };
          return b;
        }

        const channel = { on() { return channel; }, subscribe() { return channel; }, unsubscribe() { return Promise.resolve('ok'); } };

        function createClient() {
          let authCb = null;
          const auth = {
            onAuthStateChange(cb) { authCb = cb; setTimeout(() => cb('INITIAL_SESSION', SESSION), 0); return { data: { subscription: { unsubscribe() {} } } }; },
            getUser() { return Promise.resolve({ data: { user: SESSION?.user ?? null }, error: null }); },
            getSession() { return Promise.resolve({ data: { session: SESSION }, error: null }); },
            signInWithPassword() { if (authCb) setTimeout(() => authCb('SIGNED_IN', LOGIN), 0); return Promise.resolve({ data: { session: LOGIN }, error: null }); },
            signInWithOtp() { return Promise.resolve({ data: {}, error: null }); },
            signUp() { if (LOGIN && authCb) setTimeout(() => authCb('SIGNED_IN', LOGIN), 0); return Promise.resolve({ data: { session: LOGIN }, error: null }); },
            signOut() { if (authCb) setTimeout(() => authCb('SIGNED_OUT', null), 0); return Promise.resolve({ error: null }); },
            updateUser() { return Promise.resolve({ data: { user: SESSION?.user ?? null }, error: null }); },
            resetPasswordForEmail() { return Promise.resolve({ data: {}, error: null }); },
          };
          const storage = { from() { return {
            upload() { return Promise.resolve({ data: { path: '' }, error: null }); },
            remove() { return Promise.resolve({ data: [], error: null }); },
            getPublicUrl() { return { data: { publicUrl: '' } }; },
          }; } };
          // Expose the store for test introspection.
          window.__store = store;
          return { auth, storage, from(t) { return makeBuilder(t); }, rpc() { return makeBuilder('__rpc'); }, channel() { return channel; }, removeChannel() { return Promise.resolve('ok'); } };
        }

        window.supabase = { createClient };
      })();
    `;
    await route.fulfill({ contentType: 'text/javascript', body });
  });

  const erudaBody = opts.eruda ?? '';
  await page.route('**/cdn.jsdelivr.net/npm/eruda*', r => r.fulfill({ contentType: 'text/javascript', body: erudaBody }));
  await page.route('**/html2canvas*', r => r.fulfill({ contentType: 'text/javascript', body: 'window.html2canvas=function(){return Promise.resolve(document.createElement("canvas"));};' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/fonts.gstatic.com/**', r => r.abort());
}

/**
 * Boot the app as an authenticated user with seed data; wait for the main shell
 * and clear the welcome popup / any open modal so flows are interactable.
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
