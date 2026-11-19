// 💬 Contact us sheet (openSupportSheet / submitSupportMessage): replaces the
// Telegram bug-report link. A message that never landed must not show the
// "Got it" screen — sb.rpc resolves with { error } instead of throwing, and
// submit_support_message refuses with { ok: false } (rate limit, empty text).
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

async function stubRpc(page, name, result) {
  await page.evaluate(([fn, res]) => {
    const real = sb.rpc.bind(sb);
    window.__rpcArgs = {};
    sb.rpc = (n, args) => {
      window.__rpcArgs[n] = args;
      if (n === fn) return Promise.resolve(res);
      return real(n, args);
    };
  }, [name, result]);
}

async function fillAndSend(page, kind, text) {
  return page.evaluate(async ([k, t]) => {
    openSupportSheet(k);
    document.getElementById('support-message').value = t;
    await submitSupportMessage();
    return {
      open: document.getElementById('support-overlay').classList.contains('open'),
      done: document.getElementById('support-done').style.display !== 'none',
      formShown: document.getElementById('support-form').style.display !== 'none',
    };
  }, [kind, text]);
}

test.describe('Contact us sheet', () => {
  test('is reachable from Settings and Guide & Help, with no Telegram link left', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    const info = await page.evaluate(() => ({
      settingsRow: !!document.querySelector('#privacy-settings-overlay [onclick*="openSupportSheet"]'),
      guideBtn: !!document.querySelector('#app-guide-overlay [onclick*="openSupportSheet"]'),
      telegram: document.body.innerHTML.includes('t.me/'),
    }));
    expect(info.settingsRow).toBe(true);
    expect(info.guideBtn).toBe(true);
    expect(info.telegram).toBe(false);
  });

  test('a successful send shows the thanks screen and passes context', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await stubRpc(page, 'submit_support_message', { data: { ok: true, id: 'x' }, error: null });
    const r = await fillAndSend(page, 'idea', 'dark mode for the lineup');
    expect(r.done).toBe(true);
    expect(r.formShown).toBe(false);
    const args = await page.evaluate(() => window.__rpcArgs.submit_support_message);
    expect(args.p_kind).toBe('idea');
    expect(args.p_message).toBe('dark mode for the lineup');
    expect(args.p_app_version).toBe(await page.evaluate(() => APP_VERSION));
    expect(['web', 'ios']).toContain(args.p_platform);
    expect(args.p_screenshot_path).toBeNull();
  });

  test('a PostgREST error keeps the form and the draft', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await stubRpc(page, 'submit_support_message', { data: null, error: { message: 'permission denied' } });
    const r = await fillAndSend(page, 'bug', 'the map froze');
    expect(r.done).toBe(false);
    expect(r.formShown).toBe(true);
    expect(await page.evaluate(() => document.getElementById('support-message').value)).toBe('the map froze');
  });

  test('an { ok: false } refusal is not reported as sent', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await stubRpc(page, 'submit_support_message', { data: { ok: false, error: 'Too many messages' }, error: null });
    const r = await fillAndSend(page, 'help', 'how do I add a ride');
    expect(r.done).toBe(false);
  });

  test('an empty message is not sent', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await stubRpc(page, 'submit_support_message', { data: { ok: true }, error: null });
    await fillAndSend(page, 'bug', '   ');
    expect(await page.evaluate(() => window.__rpcArgs.submit_support_message)).toBeUndefined();
  });
});
