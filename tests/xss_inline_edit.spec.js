// Regression cover for the inline profile editor's handler injection.
//
// The edit pencil next to an unclaimed raver's location / Instagram / Radiate /
// phone used to carry that field's value inside its onclick attribute, escaping
// only backticks. Any crew member can write those fields on a stub profile, and
// every other member renders them — so a quote (closing the attribute) or a
// `${...}` (evaluated when the handler fired) ran in a crewmate's session.
//
// The fix reads values from state instead of routing them through the markup.
// These tests assert the payloads stay inert and stay intact.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// Closes the onclick attribute and opens a new event-handler attribute.
const ATTR_BREAKOUT = '" onmouseover="window.__xss=1" data-x="';
// Evaluated as a substitution if the value lands inside a template literal.
const TEMPLATE_SUB = '${window.__xssTpl = 1}';

// r-sam is an unclaimed stub created by the test user, so the profile renders
// the inline-edit controls rather than the read-only line.
function seedWithSamField(field, value) {
  const data = seedData();
  data.ravers.find(r => r.id === 'r-sam')[field] = value;
  return data;
}

async function openSamProfile(page) {
  await page.evaluate(() => openProfile('r-sam'));
  await expect(page.locator('#page-profile')).toHaveClass(/active/);
}

test.describe('inline profile edit · handler injection', () => {
  test('a quote in a stub\'s location cannot open a new attribute', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithSamField('base', ATTR_BREAKOUT) });
    await openSamProfile(page);

    // Fire mouseover across the whole profile — an injected onmouseover would run.
    await page.evaluate(() => {
      document.querySelectorAll('#page-profile *').forEach(el =>
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    });

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // The payload survives as text rather than as markup.
    await expect(page.locator('#page-profile')).toContainText(ATTR_BREAKOUT);
    const injected = await page.evaluate(() =>
      document.querySelectorAll('#page-profile [onmouseover]').length);
    expect(injected).toBe(0);
  });

  test('a ${...} in a stub\'s location is not evaluated when the pencil is clicked', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithSamField('base', TEMPLATE_SUB) });
    await openSamProfile(page);

    await page.evaluate(() => startInlineEdit('r-sam', 'base'));
    expect(await page.evaluate(() => window.__xssTpl)).toBeUndefined();

    // …and the editor is populated with the literal text, not an evaluated result.
    const value = await page.inputValue('#ief-input-r-sam-base');
    expect(value).toBe(TEMPLATE_SUB);
  });

  test('a hostile value round-trips through edit → cancel unchanged', async ({ page }) => {
    await bootAuthedApp(page, { data: seedWithSamField('instagram', ATTR_BREAKOUT) });
    await openSamProfile(page);

    await page.evaluate(() => {
      startInlineEdit('r-sam', 'instagram');
      cancelInlineEdit('r-sam', 'instagram');
    });

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.evaluate(() => getRaver('r-sam').instagram)).toBe(ATTR_BREAKOUT);
    await expect(page.locator('#ief-wrap-r-sam-instagram')).toContainText(ATTR_BREAKOUT);
  });

  test('a hostile nickname cannot break out of its handler', async ({ page }) => {
    await bootAuthedApp(page);
    await openSamProfile(page);

    await page.evaluate((payload) => {
      nicknameCache['r-sam'] = payload;
      openProfile('r-sam');
    }, ATTR_BREAKOUT);

    await page.evaluate(() => {
      document.querySelectorAll('#page-profile *').forEach(el =>
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    });

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // The pencil opens the editor with the payload intact.
    await page.evaluate(() => startNicknameEdit('r-sam'));
    expect(await page.inputValue('#ief-input-r-sam-nickname')).toBe(ATTR_BREAKOUT);
  });

  // The initial profile render always escaped this field; it was the redraw
  // after cancelling or committing an edit that wrote the value in raw. The
  // second argument is what the old signature took — the fixed version ignores
  // it and reads privatePhoneCache, so this exercises the same path either way.
  test('a hostile saved phone number stays text when an edit is cancelled', async ({ page }) => {
    await bootAuthedApp(page);
    await openSamProfile(page);

    await page.evaluate((payload) => {
      privatePhoneCache['r-sam'] = payload;
      openProfile('r-sam');
      cancelPrivatePhoneEdit('r-sam', payload);
    }, '<img src=x onerror="window.__xssImg=1">');

    expect(await page.evaluate(() => window.__xssImg)).toBeUndefined();
    const imgs = await page.evaluate(() =>
      document.querySelectorAll('#ief-wrap-r-sam-private-phone img').length);
    expect(imgs).toBe(0);
  });
});

test.describe('mod dashboard · genre chip', () => {
  test('removing a draft genre works by index, so quotes in the name are inert', async ({ page }) => {
    await bootAuthedApp(page);

    const remaining = await page.evaluate(() => {
      modGenreDrafts['a1'] = ["techno", "hard'  ) ; window.__xssGenre = 1 ; (('", 'house'];
      removeDraftGenre('a1', 1);
      return modGenreDrafts['a1'];
    });

    expect(await page.evaluate(() => window.__xssGenre)).toBeUndefined();
    expect(remaining).toEqual(['techno', 'house']);
  });
});
