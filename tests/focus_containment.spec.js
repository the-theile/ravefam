// Focus used to walk out of an open overlay into the page behind it, which was
// still fully tabbable and still in the accessibility tree. Every overlay is a
// sibling of #main-app, so the shell goes inert while one is open.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

test.describe('overlay focus containment', () => {
  test('the app shell goes inert while an overlay is open, and back after', async ({ page }) => {
    await bootAuthedApp(page);

    expect(await page.evaluate(() => document.getElementById('main-app').inert)).toBe(false);

    await page.evaluate(() => showCrewEditModal('c1'));
    await expect(page.locator('#crew-edit-overlay')).toHaveClass(/open/);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.getElementById('main-app').inert)).toBe(true);

    await page.evaluate(() => closeCrewEditModal());
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.getElementById('main-app').inert)).toBe(false);
  });

  test('the overlay itself is not inert — its controls stay usable', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => showCrewEditModal('c1'));
    await page.waitForTimeout(150);

    // The overlay is a sibling of the shell, so it must be unaffected.
    const overlayInert = await page.evaluate(() => {
      const el = document.getElementById('crew-edit-overlay');
      return el.inert || el.closest('[inert]') !== null;
    });
    expect(overlayInert).toBe(false);

    const input = page.locator('#crew-edit-overlay input').first();
    await input.focus();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
  });

  test('background controls are not reachable while an overlay is open', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => showCrewEditModal('c1'));
    await page.waitForTimeout(150);

    // Focusing something in the shell must not take — that is what inert means.
    const took = await page.evaluate(() => {
      const btn = document.querySelector('#main-app button');
      if (!btn) return null;
      btn.focus();
      return document.activeElement === btn;
    });
    expect(took).toBe(false);
  });

  test('an overlay that focuses its own field keeps that focus', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-sam'));

    // startInlineEdit focuses its input synchronously; the inert sync runs
    // afterwards as a mutation callback and must not steal it back.
    await page.evaluate(() => startInlineEdit('r-sam', 'base'));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('ief-input-r-sam-base');
  });

  test('focus returns to where it was when the last overlay closes', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(() => {
      const btn = document.querySelector('#main-app button');
      btn.id = 'focus-origin-probe';
      btn.focus();
    });
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('focus-origin-probe');

    await page.evaluate(() => showCrewEditModal('c1'));
    await page.waitForTimeout(150);
    await page.evaluate(() => closeCrewEditModal());
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => document.activeElement?.id)).toBe('focus-origin-probe');
  });
});
