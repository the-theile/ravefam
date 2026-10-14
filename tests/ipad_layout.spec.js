// iPad touch layout. App Review rejected 2.5.0 on an iPad Air 11" under
// guideline 4 ("controls that are difficult to use due to size or placement"):
// the phone rules key on width, so a touch iPad got the mouse layout. The
// "Tablet touch (iPad)" block in app.html fixes that; this guards it.
//
// Headless Chromium drops its hover:none / pointer:coarse emulation after some
// interactions, so instead of trusting the emulated media features the spec
// switches the tablet block on directly through the CSSOM. That is exactly
// what a real iPad touchscreen renders.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, installSupabaseStub, seedData, TEST_UID } = require('./helpers');

const TABS = ['crews', 'raves', 'ravers', 'stats', 'village'];

// Switches on the tablet blocks (the general one and the portrait sign-in one).
async function forceTabletBlock(page) {
  const found = await page.evaluate(() => {
    let n = 0;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.media && /pointer: coarse\) and \(min-width: 641px\)/.test(r.media.mediaText)) {
          r.media.mediaText = 'all';
          n++;
        }
      }
    }
    return n;
  });
  expect(found).toBe(2);
}

// Visible, tappable controls under Apple's 44pt minimum, optionally only
// those inside `root` (a selector).
function smallControls(root) {
  const out = [];
  for (const el of (root ? document.querySelector(root) : document).querySelectorAll('button, a[href], [onclick], [role=button], [role=tab], select, input')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    let hidden = false;
    for (let a = el; a; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (c.display === 'none' || c.visibility === 'hidden' || c.opacity === '0' || c.pointerEvents === 'none') { hidden = true; break; }
    }
    if (hidden) continue;
    // .web-only is hidden in the iOS app, which is what App Review sees.
    if (el.closest('.web-only')) continue;
    if (r.width < 44 || r.height < 44) {
      const label = (el.innerText || el.getAttribute('aria-label') || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return [...new Set(out)];
}

for (const [name, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
  test.describe(`iPad layout · ${name}`, () => {
    test.use({ viewport, hasTouch: true });

    test('every visible control on each tab is at least 44pt', async ({ page }) => {
      const errors = await bootAuthedApp(page);
      await forceTabletBlock(page);
      for (const tab of TABS) {
        await page.locator(`.nav-tab.c-${tab}`).click();
        await page.waitForTimeout(300);
        expect(await page.evaluate(smallControls), `undersized controls on ${tab}`).toEqual([]);
      }
      expect(errors).toEqual([]);
    });

    test('the sign-in screen has no undersized controls or tappable-looking pills', async ({ page }) => {
      await installSupabaseStub(page, { session: null });
      await page.goto('/app.html');
      await expect(page.locator('#login-btn')).toBeVisible();
      await forceTabletBlock(page);
      expect(await page.evaluate(smallControls)).toEqual([]);
      if (name === 'portrait') {
        await expect(page.locator('#auth-screen .landing-features')).toBeHidden();
        const { hero, card } = await page.evaluate(() => {
          const mid = el => { const r = document.querySelector(el).getBoundingClientRect(); return r.left + r.width / 2; };
          return { hero: mid('.landing-hero'), card: mid('.auth-card') };
        });
        expect(Math.abs(hero - card)).toBeLessThanOrEqual(2);
      }
    });

    test('the Huddle header and composer have no undersized controls', async ({ page }) => {
      const data = seedData();
      data.huddle_rooms = [{ id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' }];
      data.huddle_messages = [
        { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'who is driving', reactions: {}, created_at: new Date(Date.now() - 600000).toISOString(), deleted_at: null, mentions: [] },
        { id: 'm2', room_id: 'room-main', crew_id: 'c1', sender_id: TEST_UID, kind: 'text', body: 'riding with you', reactions: {}, created_at: new Date(Date.now() - 300000).toISOString(), deleted_at: null, mentions: [] },
      ];
      const errors = await bootAuthedApp(page, { data, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
      await forceTabletBlock(page);
      await page.evaluate(async () => { await openHuddle('c1'); });
      await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
      await page.waitForTimeout(300);
      expect(await page.evaluate(smallControls, '#huddle-screen')).toEqual([]);
      // The bigger hit areas must not push the header taller than its
      // phone-sized 53px (32px buttons + 10px padding top and bottom + border).
      expect(await page.locator('#hd-head').evaluate(h => h.getBoundingClientRect().height)).toBeLessThanOrEqual(54);
      expect(errors).toEqual([]);
    });

    test('tab bar is centered over the content', async ({ page }) => {
      await bootAuthedApp(page);
      await forceTabletBlock(page);
      const { left, right, vw } = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('.nav-tab')].map(t => t.getBoundingClientRect());
        return { left: tabs[0].left, right: tabs[tabs.length - 1].right, vw: document.documentElement.clientWidth };
      });
      expect(Math.abs(left - (vw - right))).toBeLessThanOrEqual(2);
    });
  });
}
