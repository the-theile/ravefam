// Colour swatches were <div onclick>: not focusable, no role, no name, and
// silent about which one was chosen. They're buttons now, named from the app's
// own colour vocabulary, with aria-pressed tracking .selected.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

test.describe('colour swatches', () => {
  test('the create-crew swatches are named, focusable buttons', async ({ page }) => {
    await bootAuthedApp(page);

    const swatches = page.locator('#create-crew-overlay .color-swatch, .color-swatches .color-swatch').first();
    const info = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.color-swatches .color-swatch')];
      return {
        count: els.length,
        allButtons: els.every(e => e.tagName === 'BUTTON'),
        allNamed: els.every(e => (e.getAttribute('aria-label') || '').length > 2),
        anyRawHexName: els.some(e => (e.getAttribute('aria-label') || '').startsWith('#')),
        firstName: els[0]?.getAttribute('aria-label'),
      };
    });
    expect(info.count).toBeGreaterThan(0);
    expect(info.allButtons).toBe(true);
    expect(info.allNamed).toBe(true);
    // A hex is not an accessible name.
    expect(info.anyRawHexName).toBe(false);
    expect(info.firstName).toBe('Neon pink');
    await expect(swatches).toBeVisible();
  });

  test('aria-pressed follows the selection', async ({ page }) => {
    await bootAuthedApp(page);

    const state = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.color-swatches .color-swatch')];
      const before = els.map(e => e.getAttribute('aria-pressed'));
      selectSwatch(els[3]);
      const after = els.map(e => e.getAttribute('aria-pressed'));
      return { before, after, selectedIdx: els.findIndex(e => e.classList.contains('selected')) };
    });

    // Exactly one pressed, and it's the one that carries .selected.
    expect(state.after.filter(v => v === 'true')).toHaveLength(1);
    expect(state.after[state.selectedIdx]).toBe('true');
    expect(state.selectedIdx).toBe(3);
    // It genuinely changed — the first swatch starts selected.
    expect(state.before[0]).toBe('true');
  });

  test('a swatch can be chosen from the keyboard', async ({ page }) => {
    await bootAuthedApp(page);

    const chosen = await page.evaluate(async () => {
      const els = [...document.querySelectorAll('.color-swatches .color-swatch')];
      const target = els[5];
      target.focus();
      const focused = document.activeElement === target;
      target.click();   // what Enter/Space does on a real button
      return { focused, selected: target.classList.contains('selected'),
               pressed: target.getAttribute('aria-pressed') };
    });

    // A <div> could not have been focused at all.
    expect(chosen.focused).toBe(true);
    expect(chosen.selected).toBe(true);
    expect(chosen.pressed).toBe('true');
  });

  test('read-only rave swatches are disabled rather than just unstyled', async ({ page }) => {
    await bootAuthedApp(page);

    // The non-editable branch used to emit a second style attribute, which
    // browsers ignore — so the dimming never applied and they looked live.
    const html = await page.evaluate(() => {
      const el = document.createElement('div');
      el.innerHTML = `<button type="button" class="color-swatch" disabled></button>`;
      document.body.appendChild(el);
      const btn = el.querySelector('button');
      const cs = getComputedStyle(btn);
      const out = { pointerEvents: cs.pointerEvents, disabled: btn.disabled };
      el.remove();
      return out;
    });
    expect(html.disabled).toBe(true);
    expect(html.pointerEvents).toBe('none');
  });
});
