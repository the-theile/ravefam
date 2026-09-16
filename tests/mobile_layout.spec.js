// Phone-width layout guards. Runs only in the mobile projects (see
// playwright.config.js) — at desktop width the rules under test don't apply.
//
// These cover the things that actually break on a real handset and that no
// other spec looks at: content escaping the viewport sideways, the fixed bottom
// nav colliding with the iOS home indicator, and tap targets too small to hit.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, installSupabaseStub } = require('./helpers');

/**
 * Find a CSS rule's text by selector, optionally only inside a media query.
 * env(safe-area-inset-*) resolves to 0 in a headless browser with no notch, so
 * a computed-style assertion can't tell "handled" from "forgotten" — the
 * declaration itself is the thing worth guarding.
 */
async function ruleTextFor(page, selector, mediaSubstring) {
  return page.evaluate(({ sel, media }) => {
    const hits = [];
    const walk = (rules, inMedia) => {
      for (const rule of rules) {
        if (rule.media) {
          walk(rule.cssRules || [], (rule.media.mediaText || ''));
        } else if (rule.selectorText) {
          const selectors = rule.selectorText.split(',').map(s => s.trim());
          if (selectors.includes(sel) && (!media || (inMedia || '').includes(media))) {
            hits.push(rule.style.cssText);
          }
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // cross-origin
      if (rules) walk(rules, null);
    }
    return hits;
  }, { sel: selector, media: mediaSubstring });
}

test.describe('mobile layout · viewport', () => {
  test('no horizontal page scroll at phone width', async ({ page }) => {
    const errors = await bootAuthedApp(page);

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    // 1px of tolerance for sub-pixel rounding at DPR 3.
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
    expect(errors).toEqual([]);
  });

  test('no element overflows the viewport horizontally', async ({ page }) => {
    await bootAuthedApp(page);

    const overflowing = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (parseFloat(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // Overflow means an element that STARTS on screen and runs off the
        // right edge. Panels parked entirely off-screen (the notification
        // drawer, the huddle drawer — slid out via transform/right offset
        // until opened) begin past the edge and are not overflow.
        if (r.left >= vw) continue;
        // ...and only if nothing clips it. Decorative bleed (the blurred
        // background blobs) is deliberately oversized inside an
        // overflow:hidden parent, so it never reaches the scroll box.
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const ov = getComputedStyle(a);
          if (['hidden', 'clip', 'auto', 'scroll'].includes(ov.overflowX)) { clipped = true; break; }
        }
        if (clipped) continue;
        if (r.right > vw + 1) {
          out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), right: Math.round(r.right) });
        }
      }
      return out.slice(0, 10);
    });

    expect(overflowing).toEqual([]);
  });
});

test.describe('mobile layout · bottom nav vs iOS home indicator', () => {
  test('the fixed bottom nav reserves the safe-area inset', async ({ page }) => {
    await bootAuthedApp(page);

    const navRules = await ruleTextFor(page, 'nav', 'max-width: 640px');
    expect(navRules.length).toBeGreaterThan(0);
    // The nav is position:fixed;bottom:0 on phones, so without this the tab row
    // sits inside the strip iOS reserves for the home indicator.
    expect(navRules.join(' ')).toContain('safe-area-inset-bottom');
  });

  test('main reserves room for the nav plus the safe-area inset', async ({ page }) => {
    await bootAuthedApp(page);

    const mainRules = await ruleTextFor(page, 'main', 'max-width: 640px');
    expect(mainRules.length).toBeGreaterThan(0);
    expect(mainRules.join(' ')).toContain('safe-area-inset-bottom');
  });

  test('the nav is actually pinned to the bottom and spans the width', async ({ page }) => {
    await bootAuthedApp(page);

    const box = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      const cs = getComputedStyle(nav);
      const r = nav.getBoundingClientRect();
      return { position: cs.position, left: r.left, right: r.right, vw: window.innerWidth,
               bottom: r.bottom, vh: window.innerHeight };
    });
    expect(box.position).toBe('fixed');
    expect(box.left).toBeLessThanOrEqual(1);
    expect(box.right).toBeGreaterThanOrEqual(box.vw - 1);
    expect(box.bottom).toBeGreaterThanOrEqual(box.vh - 1);
  });

  test('content is not hidden behind the fixed nav', async ({ page }) => {
    await bootAuthedApp(page);

    const clears = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      const navH = nav.getBoundingClientRect().height;
      const pad = parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom);
      return { navH, pad };
    });
    expect(clears.pad).toBeGreaterThanOrEqual(clears.navH);
  });
});

test.describe('mobile layout · tap targets', () => {
  test('every bottom-nav tab is at least 44px tall', async ({ page }) => {
    await bootAuthedApp(page);

    const small = await page.evaluate(() => {
      const out = [];
      for (const t of document.querySelectorAll('nav .nav-tab')) {
        const r = t.getBoundingClientRect();
        if (!r.height) continue;
        if (r.height < 44) out.push({ label: t.textContent.trim().slice(0, 20), h: Math.round(r.height) });
      }
      return out;
    });
    expect(small).toEqual([]);
  });
});

test.describe('mobile layout · signed-out entry points', () => {
  test('the auth screen fits the viewport with no sideways scroll', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
    expect(errors).toEqual([]);
  });

  test('the scanner overlay fits the viewport when opened from signed-out', async ({ page }) => {
    await installSupabaseStub(page, { session: null });
    await page.goto('/app.html');
    await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);

    // Open on the code tab — the camera tab would ask for a camera permission
    // the headless browser has no device for.
    await page.evaluate(() => { openScanner(); switchScannerTab('code'); });
    await expect(page.locator('#scanner-overlay')).toHaveClass(/open/);

    const fits = await page.evaluate(() => {
      const r = document.getElementById('scanner-overlay').getBoundingClientRect();
      return { left: r.left, right: r.right, vw: window.innerWidth };
    });
    expect(fits.left).toBeGreaterThanOrEqual(-1);
    expect(fits.right).toBeLessThanOrEqual(fits.vw + 1);

    // All six OTP boxes must be reachable within the viewport.
    const boxes = await page.evaluate(() => {
      const vw = window.innerWidth;
      return [...document.querySelectorAll('.otp-box')].map(b => {
        const r = b.getBoundingClientRect();
        return { inView: r.left >= -1 && r.right <= vw + 1, w: Math.round(r.width) };
      });
    });
    expect(boxes.length).toBe(6);
    expect(boxes.every(b => b.inView)).toBe(true);
  });
});
