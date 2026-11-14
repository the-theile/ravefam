// Second live instance of the escHtml-as-JS-escaper bug, missed in the first
// pass. A custom vibe tag's "id" IS the user's own text, and crewmates can tag
// each other, so it reached other people's browsers inside a JS string in an
// onclick — escaped for apostrophes only. A double quote broke out of the
// attribute. Tag data travels as data attributes now.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

const ATTR_BREAKOUT = '" onmouseover="window.__vibeXss=1" data-x="';

function seedWithCustomTag(tag) {
  const data = seedData();
  const sam = data.ravers.find(r => r.id === 'r-sam');
  sam.custom_vibe_tags = [tag];
  return data;
}

test.describe('vibe tag chips · handler injection', () => {
  test('a quote in a custom tag cannot open a new attribute', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithCustomTag(ATTR_BREAKOUT) });
    await page.evaluate(() => openProfile('r-sam'));
    await expect(page.locator('#page-profile')).toHaveClass(/active/);

    await page.evaluate(() => {
      document.querySelectorAll('#page-profile *').forEach(el =>
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    });

    expect(await page.evaluate(() => window.__vibeXss)).toBeUndefined();
    expect(await page.evaluate(() =>
      document.querySelectorAll('#page-profile [onmouseover]').length)).toBe(0);
    // Rendered as text, intact.
    await expect(page.locator('#page-profile')).toContainText(ATTR_BREAKOUT);
  });

  // Only the report control actually renders — every vibeTagHTML call site
  // passes null for removableRaverId, so the remove branch is unreachable.
  test('a tag full of quotes round-trips through the report control intact', async ({ page }) => {
    const tag = `weird " tag ' with \` quotes`;
    await bootAuthedApp(page, { data: seedWithCustomTag(tag) });
    await page.evaluate(() => openProfile('r-sam'));

    const carried = await page.evaluate(() => {
      const btn = document.querySelector('#page-profile [data-act="vibe-report"]');
      return btn ? btn.dataset.tag : null;
    });
    // The value survives the attribute exactly, rather than being mangled by
    // hand-rolled escaping or truncated at the first quote.
    expect(carried).toBe(tag);

    // And activating it reaches the report flow with that exact value.
    const reported = await page.evaluate(() => {
      window.__reportArgs = null;
      const orig = window.showReportModal;
      window.showReportModal = (type, id, opts) => { window.__reportArgs = { type, id, opts }; };
      document.querySelector('#page-profile [data-act="vibe-report"]').click();
      window.showReportModal = orig;
      return window.__reportArgs;
    });
    expect(reported.type).toBe('vibe_tag');
    expect(reported.id).toBe('r-sam');
    expect(reported.opts.metadata.tag).toBe(tag);
    expect(reported.opts.metadata.is_custom).toBe(true);
  });

  test('the chip controls are buttons with accessible names', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithCustomTag('Poncho Queen') });
    await page.evaluate(() => openProfile('r-sam'));

    const info = await page.evaluate(() => {
      const btn = document.querySelector("#page-profile .vibe-chip-remove");
      if (!btn) return null;
      return { tag: btn.tagName, label: btn.getAttribute('aria-label') };
    });
    expect(info).not.toBeNull();
    expect(info.tag).toBe('BUTTON');
    expect(info.label).toContain('Poncho Queen');
  });
});
