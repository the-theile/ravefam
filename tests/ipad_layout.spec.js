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
const { bootAuthedApp } = require('./helpers');

const TABS = ['crews', 'raves', 'ravers', 'stats', 'village'];

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
  expect(found).toBe(1);
}

// Visible, tappable controls under Apple's 44pt minimum.
function smallControls() {
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], [onclick], [role=button], [role=tab], select, input')) {
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
