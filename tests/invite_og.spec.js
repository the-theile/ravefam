// api/invite-og.js: ?join= / ?claim= links unfurl with the crew's name (and
// the invitee's first name for a claim) when the token is live, and fall back
// to the generic invite card when it isn't or the lookup fails.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

async function render(query, rpcResult, { ok = true, throws = false } = {}) {
  const handler = require('../api/invite-og.js');
  const prevFetch = global.fetch;
  const prevKey = process.env.SUPABASE_ANON_KEY;
  const calls = [];
  process.env.SUPABASE_ANON_KEY = 'test-anon';
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (throws) throw new Error('network');
    return { ok, json: async () => rpcResult };
  };
  try {
    const out = { headers: {} };
    await handler({ url: `/app?${query}`, headers: { host: 'myravefam.com' } }, {
      setHeader(k, v) { out.headers[k] = v; },
      status(code) { out.status = code; return this; },
      send(body) { out.body = body; },
    });
    return { ...out, calls };
  } finally {
    global.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prevKey;
  }
}

const ogTitle = body => /<meta property="og:title" content="([^"]*)">/.exec(body)[1];
const ogDesc = body => /<meta property="og:description" content="([^"]*)">/.exec(body)[1];

test.describe('invite link previews (api/invite-og.js)', () => {
  test('the default OG block still matches app.html (or nothing gets swapped)', () => {
    const { _DEFAULT_OG_BLOCK } = require('../api/invite-og.js');
    const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
    expect(html.includes(_DEFAULT_OG_BLOCK)).toBe(true);
  });

  test('a live crew link names the crew and its size', async () => {
    const r = await render('join=inv-c1-token', { id: 'c1', name: 'Bass Syndicate', member_count: 4 });
    expect(r.calls[0].url).toContain('/rpc/get_crew_by_invite_token');
    expect(r.calls[0].body).toEqual({ p_token: 'inv-c1-token' });
    expect(ogTitle(r.body)).toBe('Join Bass Syndicate on RaveFAM 🎪');
    expect(ogDesc(r.body)).toContain('4 ravers already in');
    expect(r.body).toContain('og-invite-crew.png');
  });

  test('a live claim link greets the invitee by first name', async () => {
    const r = await render('claim=tok-abcdef12', { raver: { name: 'Sam Rivera' }, crew: { name: 'Bass Syndicate' } });
    expect(r.calls[0].url).toContain('/rpc/get_claim_preview');
    expect(ogTitle(r.body)).toBe('Sam, your spot in Bass Syndicate is saved 🎪');
    expect(r.body).toContain('og-invite-claim.png');
  });

  test('crew names are escaped in the meta tags', async () => {
    const r = await render('join=inv-c1-token', { name: 'Bass "><script>x</script>', member_count: 1 });
    expect(r.body).not.toContain('<script>x</script>');
    expect(ogTitle(r.body)).toContain('&quot;&gt;&lt;script&gt;');
  });

  test('a dead link or failed lookup falls back to the generic card', async () => {
    for (const [result, opts] of [[{ error: 'not_recruiting', crew_name: 'Secret Crew' }, {}], [null, { ok: false }], [null, { throws: true }]]) {
      const r = await render('join=inv-c1-token', result, opts);
      expect(ogTitle(r.body)).toBe("You're invited to a crew on RaveFAM 🎪");
      expect(r.body).not.toContain('Secret Crew');
    }
  });

  test('a malformed token never reaches the database', async () => {
    const r = await render('claim=%3Cbad%3E', {});
    expect(r.calls).toHaveLength(0);
    expect(ogTitle(r.body)).toBe('Claim your spot on RaveFAM');
  });
});
