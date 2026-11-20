// 📡 Connect: two ravers link 1:1 by scanning a code, no crew needed.
// connect_by_code() and friends are canned through data.__rpc; the connected
// raver (r-nova) is in no crew, so they only show up via get_my_connections().
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function connectData({ connected = false } = {}) {
  const data = seedData();
  data.festivals.push({ id: 'f-live', name: 'Okeechobee', date: localToday(), location: 'FL', color: '#39FF14', days: 3, deleted_at: null });
  data.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f-live' });
  data.ravers.push({
    id: 'r-nova', name: 'Nova Lee', handle: 'nova',
    is_you: true, created_by: 'nova-uid', claimed_by: 'nova-uid', status: 'claimed',
    base: 'Miami, FL', gradient: 'linear-gradient(135deg,#39FF14,#00F5FF)',
    avatar_url: null, blocked_tags: [], genres: ['House'],
    instagram: '', radiate: '', phone: '', phone_visible: false,
    met_story: '', notes: '', qr_token: null,
    vibe_tags: [], custom_vibe_tags: [], deleted_at: null,
    privacy_base_visible: true, privacy_show_rsvps: true,
  });
  const conn = { raver_id: 'r-nova', user_id: 'nova-uid', met_at_fest_id: 'f-live', created_at: new Date().toISOString() };
  data.__rpc = {
    get_my_connect_code: 'A1B2C3',
    get_my_connections: connected ? [conn] : [],
    connect_by_code: { status: 'connected', raver_id: 'r-nova', user_id: 'nova-uid', met_at_fest_id: 'f-live' },
    get_kandi_count: 4,
    remove_connection: true,
    set_connection_met_at: true,
  };
  return data;
}

const rpcCalls = (page, fn) => page.evaluate(f => (window.__store.__rpcCalls || []).filter(c => c.fn === f).map(c => c.args), fn);

test.describe('📡 Connect', () => {
  test('the green button opens the scanner on 🧿 My Code; Join a Crew still opens in claim mode', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: connectData() });
    await page.evaluate(() => switchTab('members'));
    await page.getByRole('button', { name: '📡 Connect' }).click();

    await expect(page.locator('#scanner-overlay')).toHaveClass(/open/);
    await expect(page.locator('#scanner-title')).toHaveText('📡 Connect');
    await expect(page.locator('#stab-mycode')).toBeVisible();
    await expect(page.locator('#scanner-pane-mycode')).toBeVisible();
    await expect(page.locator('#connect-code-text')).toHaveText('A1B2C3');

    await page.evaluate(() => closeScanner());
    await page.evaluate(() => openScanner());
    await expect(page.locator('#scanner-title')).toHaveText('📲 Join a Crew');
    await expect(page.locator('#stab-mycode')).toBeHidden();
    await expect(page.locator('#code-submit-btn')).toHaveText('Look up code →');
    await page.evaluate(() => closeScanner());
    expect(errors).toEqual([]);
  });

  test('typing a code connects instantly, guesses the live rave, and shows the kandi moment', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: connectData() });
    await page.evaluate(() => switchTab('members'));
    await page.evaluate(() => openConnect());
    await page.locator('#stab-code').click();
    await expect(page.locator('#code-submit-btn')).toHaveText('Connect 🧿');
    // Server now returns the new connection on the reload that follows.
    await page.evaluate(() => {
      window.__store.__rpc.get_my_connections = [{ raver_id: 'r-nova', user_id: 'nova-uid', met_at_fest_id: 'f-live', created_at: new Date().toISOString() }];
    });
    await page.locator('.otp-box[data-idx="0"]').click();
    await page.keyboard.type('a1b2c3', { delay: 30 }); // boxes auto-advance
    await page.locator('#code-submit-btn').click();

    await expect(page.locator('#connect-overlay')).toHaveClass(/open/);
    await expect(page.locator('#connect-modal')).toContainText('Kandi traded with Nova');
    await expect(page.locator('#connect-modal')).toContainText('Met at Okeechobee');
    await expect(page.locator('#scanner-overlay')).not.toHaveClass(/open/);
    expect(await rpcCalls(page, 'connect_by_code')).toEqual([{ p_code: 'A1B2C3', p_fest_id: 'f-live' }]);

    await page.locator('#connect-modal').getByRole('button', { name: 'Done' }).click();
    const card = page.locator('#members-grid .member-card', { hasText: 'Nova Lee' });
    await expect(card).toBeVisible();
    await expect(card.locator('.member-met-tag')).toHaveText('🤝 Met at Okeechobee');
    expect(errors).toEqual([]);
  });

  test('a scanned 🧿 My Code QR connects from either scanner mode', async ({ page }) => {
    await bootAuthedApp(page, { data: connectData() });
    await page.evaluate(() => { openScanner(); _scanHandled = false; handleRawScan('https://myravefam.com/app.html?connect=a1b2c3'); });
    await expect(page.locator('#connect-overlay')).toHaveClass(/open/);
    expect((await rpcCalls(page, 'connect_by_code'))[0].p_code).toBe('A1B2C3');
  });

  test('a bad code says so in place and keeps the scanner open', async ({ page }) => {
    const data = connectData();
    data.__rpc.connect_by_code = { error: 'invalid_code' };
    await bootAuthedApp(page, { data });
    await page.evaluate(() => openConnect());
    await page.locator('#stab-code').click();
    await page.locator('.otp-box[data-idx="0"]').click();
    await page.keyboard.type('FFFFFF', { delay: 30 });
    await page.locator('#code-submit-btn').click();
    await expect(page.locator('#code-error')).toContainText('Code not found');
    await expect(page.locator('#scanner-overlay')).toHaveClass(/open/);
    await expect(page.locator('#connect-overlay')).not.toHaveClass(/open/);
  });

  test('a connection\'s profile shows met-at + kandi, lets you fix met-at, and removes silently', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: connectData({ connected: true }) });
    await page.evaluate(() => openProfile('r-nova', false, 'members'));
    await expect(page.locator('#page-profile .profile-connection-line')).toContainText('Met at Okeechobee');
    await expect(page.locator('#profile-kandi-count')).toHaveText('🧿 4 kandi traded');

    await page.locator('#page-profile .connect-met-chip').click();
    await expect(page.locator('#connect-overlay')).toHaveClass(/open/);
    await page.getByRole('button', { name: '✨ Not at a rave' }).click();
    expect(await rpcCalls(page, 'set_connection_met_at')).toEqual([{ p_user_id: 'nova-uid', p_fest_id: null }]);
    await expect(page.locator('#page-profile .profile-connection-line')).toContainText('Connected');

    await page.evaluate(() => { window.__store.__rpc.get_my_connections = []; });
    await page.evaluate(() => confirmRemoveConnection('r-nova'));
    await expect(page.locator('#confirm-body')).toContainText("won't be told");
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#page-members')).toHaveClass(/active/);
    expect(await rpcCalls(page, 'remove_connection')).toEqual([{ p_user_id: 'nova-uid' }]);
    await expect(page.locator('#members-grid .member-card', { hasText: 'Nova Lee' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
