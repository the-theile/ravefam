const { test, expect } = require('@playwright/test');
const { bootAuthedApp, installSupabaseStub, seedData, TEST_UID } = require('./helpers');

// The Capacitor iOS app: App Store fixes (no Ko-fi donations, no BETA label)
// and native push through @capacitor/push-notifications instead of web push.
// The native bridge is stubbed: window.Capacitor with PushNotifications, Share
// and App plugins whose calls are recorded on window.__native.

async function installCapacitorStub(page, { permission = 'prompt', grantOnRequest = true } = {}) {
  await page.addInitScript(({ permission, grantOnRequest }) => {
    const listeners = {};
    const native = window.__native = { calls: [], permission };
    const rec = (name, arg) => native.calls.push({ name, arg });
    native.fire = (event, payload) => (listeners[event] || []).forEach(fn => fn(payload));
    const addListener = (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); return Promise.resolve({ remove() {} }); };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { addListener, getLaunchUrl: async () => undefined },
        Share: { share: async (opts) => rec('share', opts) },
        Badge: { set: async ({ count }) => rec('badge', count), clear: async () => rec('badge', 0) },
        PushNotifications: {
          addListener,
          checkPermissions: async () => { rec('checkPermissions'); return { receive: native.permission }; },
          requestPermissions: async () => {
            rec('requestPermissions');
            native.permission = grantOnRequest ? 'granted' : 'denied';
            return { receive: native.permission };
          },
          register: async () => {
            rec('register');
            setTimeout(() => native.fire('registration', { value: 'ab'.repeat(32) }), 50);
          },
        },
      },
    };
  }, { permission, grantOnRequest });
}

const SESSION_OVER = { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } };

function seedWithPrefs() {
  const data = seedData();
  data.email_preferences = [{ user_id: TEST_UID, beacon_push_opt_in: false, mention_push_opt_in: false }];
  data.__rpc = { register_device_push_token: { ok: true } };
  return data;
}

const calls = (page, name) => page.evaluate((n) => window.__native.calls.filter(c => c.name === n), name);

test.describe('iOS app · App Store fixes', () => {
  test('signed out: the BETA banner is hidden in the app and shown on the web', async ({ page, browser }) => {
    await installCapacitorStub(page);
    await installSupabaseStub(page, { session: null, data: seedData() });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);
    await expect(page.locator('html')).toHaveClass(/is-native-app/);
    await expect(page.locator('.landing-beta')).toBeHidden();

    const web = await browser.newPage();
    await installSupabaseStub(web, { session: null, data: seedData() });
    await web.goto('/app.html');
    await expect(web.locator('#auth-screen')).not.toHaveClass(/hidden/);
    await expect(web.locator('.landing-beta')).toBeVisible();
    await web.close();
  });

  test('Ko-fi links become Share RaveFAM, which opens the native share sheet', async ({ page }) => {
    await installCapacitorStub(page, { permission: 'denied' });
    await bootAuthedApp(page, { data: seedWithPrefs(), sessionOver: SESSION_OVER });
    const kofi = page.locator('a[href*="ko-fi.com"]');
    for (let i = 0; i < await kofi.count(); i++) await expect(kofi.nth(i)).toBeHidden();
    await expect(page.locator('#guide-support-widget')).toBeHidden();
    // The Share button sits where the Ko-fi link did; call it the way it does.
    expect(await page.locator('button.native-only', { hasText: 'Share RaveFAM' }).count()).toBeGreaterThan(0);
    await page.evaluate(() => shareRaveFam());
    const shares = await calls(page, 'share');
    expect(shares).toHaveLength(1);
    expect(shares[0].arg.url).toBe('https://myravefam.com');
  });

  test('on the web the Ko-fi link stays and Share RaveFAM is hidden', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithPrefs(), sessionOver: SESSION_OVER });
    expect(await page.evaluate(() => document.documentElement.classList.contains('is-native-app'))).toBe(false);
    for (const b of await page.locator('button.native-only').all()) await expect(b).toBeHidden();
  });
});

test.describe('iOS app · native push', () => {
  test('a member with a crew is offered notifications once; accepting registers the phone and turns every type on', async ({ page }) => {
    await installCapacitorStub(page, { permission: 'prompt' });
    await bootAuthedApp(page, { data: seedWithPrefs(), sessionOver: SESSION_OVER });

    await expect(page.locator('#confirm-overlay')).toHaveClass(/open/, { timeout: 8000 });
    await expect(page.locator('#confirm-title')).toContainText('Stay in the loop');
    await page.locator('#confirm-ok-btn').click();

    await expect.poll(() => page.evaluate(() => (window.__store.__rpcCalls || []).filter(c => c.fn === 'register_device_push_token').length)).toBe(1);
    const reg = await page.evaluate(() => window.__store.__rpcCalls.find(c => c.fn === 'register_device_push_token').args);
    expect(reg).toEqual({ p_token: 'ab'.repeat(32), p_platform: 'ios' });
    expect(await calls(page, 'requestPermissions')).toHaveLength(1);

    await expect.poll(() => page.evaluate(() => window.__store.email_preferences[0])).toMatchObject({ beacon_push_opt_in: true, mention_push_opt_in: true });
    const alerts = await page.evaluate(() => (window.__store.alert_preferences || []).map(r => `${r.type}:${r.enabled}`).sort());
    expect(alerts).toEqual(['artist_added:true', 'postfest:true', 'set_times:true']);

    // Offered once per phone.
    expect(await page.evaluate(() => localStorage.getItem('rf_native_push_offered'))).toBe('1');
  });

  test('already allowed: re-registers quietly with no prompt', async ({ page }) => {
    await installCapacitorStub(page, { permission: 'granted' });
    await bootAuthedApp(page, { data: seedWithPrefs(), sessionOver: SESSION_OVER });
    await expect.poll(() => page.evaluate(() => (window.__store.__rpcCalls || []).some(c => c.fn === 'register_device_push_token'))).toBe(true);
    await page.waitForTimeout(4500);
    await expect(page.locator('#confirm-overlay')).not.toHaveClass(/open/);
    expect(await calls(page, 'requestPermissions')).toHaveLength(0);
  });

  test('Settings Beacon toggle uses native push instead of saying the browser is unsupported', async ({ page }) => {
    await installCapacitorStub(page, { permission: 'granted' });
    await bootAuthedApp(page, { data: seedWithPrefs(), sessionOver: SESSION_OVER });
    await page.evaluate(() => openPrivacySettingsModal('r-you', 'notif'));
    const toggle = page.locator('#push-settings-toggle');
    await expect(toggle).not.toHaveClass(/(^|\s)on(\s|$)/);
    await toggle.click();
    await expect(toggle).toHaveClass(/(^|\s)on(\s|$)/);
    await expect(page.locator('#toast')).not.toContainText('not supported');
    expect(await page.evaluate(() => window.__store.email_preferences[0].beacon_push_opt_in)).toBe(true);
  });

  test('tapping a Huddle notification opens that crew chat', async ({ page }) => {
    await installCapacitorStub(page, { permission: 'granted' });
    const data = seedWithPrefs();
    data.huddle_rooms = [{ id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' }];
    data.huddle_messages = [];
    await bootAuthedApp(page, { data, sessionOver: SESSION_OVER });
    await page.evaluate(() => window.__native.fire('pushNotificationActionPerformed', { notification: { data: { crewId: 'c1', roomId: 'room-main' } } }));
    await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
  });

  test('the app icon badge follows unread Huddle messages, skips blocked senders, and clears when read', async ({ page }) => {
    await installCapacitorStub(page, { permission: 'granted' });
    const data = seedWithPrefs();
    const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
    data.huddle_rooms = [{ id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' }];
    data.huddle_messages = [
      { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'one', reactions: {}, created_at: ago(10), deleted_at: null, mentions: [] },
      { id: 'm2', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'two', reactions: {}, created_at: ago(5), deleted_at: null, mentions: [] },
      { id: 'm3', room_id: 'room-main', crew_id: 'c1', sender_id: 'blocked-uid', kind: 'text', body: 'nope', reactions: {}, created_at: ago(4), deleted_at: null, mentions: [] },
    ];
    data.huddle_room_reads = [{ room_id: 'room-main', user_id: TEST_UID, last_read_at: ago(60) }];
    data.user_blocks = [{ blocker_id: TEST_UID, blocked_id: 'blocked-uid', created_at: ago(120) }];
    await bootAuthedApp(page, { data, sessionOver: SESSION_OVER });

    // Two from Kai; the blocked sender's message doesn't count.
    await expect.poll(async () => (await calls(page, 'badge')).map(c => c.arg).pop()).toBe(2);

    await page.evaluate(async () => { await openHuddle('c1'); });
    await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
    await expect.poll(async () => (await calls(page, 'badge')).map(c => c.arg).pop()).toBe(0);
  });
});
