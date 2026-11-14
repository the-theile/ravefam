// iOS Safari zooms the viewport when a focused text control renders below
// 16px and, with no maximum-scale in the viewport meta, never zooms back out.
// A global touch-device floor in app.html's stylesheet keeps every text-entry
// control at >=16px; this guards it against regressing back to the per-field
// inline patches it replaced.
const { test, expect, devices } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

// Every text-entry input type the app actually uses, plus textarea/select.
const TEXT_ENTRY = [
  'input:not([type])', 'input[type="text"]', 'input[type="search"]',
  'input[type="email"]', 'input[type="url"]', 'input[type="tel"]',
  'input[type="number"]', 'input[type="password"]', 'input[type="date"]',
  'input[type="datetime-local"]', 'textarea', 'select',
].join(',');

// Borrow the iPhone viewport but not its defaultBrowserType — the CSS floor is
// gated on (hover: none) and (pointer: coarse), which isMobile/hasTouch drive
// on the chromium this suite already runs everywhere else.
test.use({
  viewport: devices['iPhone 13'].viewport,
  deviceScaleFactor: devices['iPhone 13'].deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
});

test.describe('iOS input zoom', () => {
  test('the touch media query the floor depends on actually matches', async ({ page }) => {
    await bootAuthedApp(page);
    const coarse = await page.evaluate(
      () => matchMedia('(hover: none) and (pointer: coarse)').matches);
    expect(coarse).toBe(true);
  });

  test('every visible text control renders at >= 16px on touch', async ({ page }) => {
    await bootAuthedApp(page);

    const undersized = await page.evaluate((sel) => {
      const out = [];
      for (const el of document.querySelectorAll(sel)) {
        // Only fields a user can actually tap into can trigger the zoom.
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (el.disabled || el.readOnly) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 16) {
          out.push({
            id: el.id || null,
            cls: el.className || null,
            tag: el.tagName.toLowerCase(),
            px,
          });
        }
      }
      return out;
    }, TEXT_ENTRY);

    expect(undersized).toEqual([]);
  });

  test('the shared .form-input class clears the floor', async ({ page }) => {
    await bootAuthedApp(page);

    // .form-input is the app's main input class (~100 usages). Mount one
    // detached from any screen state so the assertion holds regardless of
    // which page the app happens to boot into.
    const px = await page.evaluate(() => {
      const el = document.createElement('input');
      el.className = 'form-input';
      document.body.appendChild(el);
      const size = parseFloat(getComputedStyle(el).fontSize);
      el.remove();
      return size;
    });

    expect(px).toBeGreaterThanOrEqual(16);
  });
});
