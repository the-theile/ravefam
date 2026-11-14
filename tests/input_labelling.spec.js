// Finding 17: inputs identified only by a placeholder. A placeholder is not an
// accessible name in every browser/screen-reader combination, and it vanishes
// the moment someone types — so it fails sighted users revisiting a half-filled
// form too. This checks the rendered DOM, not the source, so generated markup
// counts.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

/** Everything a browser will accept as an accessible name for a field. */
const NAME_PROBE = `(el) => {
  if (el.getAttribute('aria-label')) return 'aria-label';
  const lb = el.getAttribute('aria-labelledby');
  if (lb && lb.split(/\\s+/).some(id => document.getElementById(id))) return 'aria-labelledby';
  if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return 'label[for]';
  if (el.closest('label')) return 'wrapping label';
  if (el.getAttribute('title')) return 'title';
  return null;
}`;

async function unnamedFields(page, scope = 'document') {
  return page.evaluate(([probeSrc, scopeSel]) => {
    const probe = eval(probeSrc);
    const root = scopeSel === 'document' ? document : document.querySelector(scopeSel);
    if (!root) return ['(scope not found)'];
    const SKIP = new Set(['hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset']);
    return [...root.querySelectorAll('input, textarea, select')]
      .filter(el => !SKIP.has((el.getAttribute('type') || '').toLowerCase()))
      .filter(el => !probe(el))
      .map(el => `${el.tagName.toLowerCase()}#${el.id || '(no id)'}.${el.className || ''}`.slice(0, 80));
  }, [NAME_PROBE, scope]);
}

test.describe('every field has an accessible name', () => {
  test('the app shell at rest', async ({ page }) => {
    await bootAuthedApp(page);
    expect(await unnamedFields(page)).toEqual([]);
  });

  test('the profile editor', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { openProfile('r-you'); enterProfileEditMode('r-you'); });
    await page.waitForTimeout(300);
    expect(await unnamedFields(page, '#page-profile')).toEqual([]);
  });

  test('the inline field editor on a stub profile', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-sam'));
    await page.evaluate(() => startInlineEdit('r-sam', 'base'));
    await page.waitForTimeout(200);
    expect(await unnamedFields(page, '#page-profile')).toEqual([]);
  });

  test('the rave editor', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openRaveEditor && openRaveEditor('f1'));
    await page.waitForTimeout(300);
    const overlay = await page.evaluate(() => !!document.querySelector('#rave-edit-overlay'));
    test.skip(!overlay, 'rave editor not reachable in this seed');
    expect(await unnamedFields(page, '#rave-edit-overlay')).toEqual([]);
  });

  test('the auth screen', async ({ page }) => {
    await bootAuthedApp(page);
    // Rendered but hidden behind the app shell; the fields still exist.
    expect(await unnamedFields(page, '#auth-screen')).toEqual([]);
  });

  test('a placeholder alone is not counted as a name', async ({ page }) => {
    await bootAuthedApp(page);
    // Guards the test itself: if the probe ever treated placeholder as a name,
    // every assertion above would pass vacuously.
    const caught = await page.evaluate((probeSrc) => {
      const probe = eval(probeSrc);
      const el = document.createElement('input');
      el.placeholder = 'Just a placeholder';
      document.body.appendChild(el);
      const named = probe(el);
      el.remove();
      return named;
    }, NAME_PROBE);
    expect(caught).toBeNull();
  });
});
