// Finding 02, security half. 733 inline handlers; 251 interpolate. Most pass a
// numeric or UUID id and are inert, but a handful carry free text a user typed —
// and those are the exact shape of the two XSS holes already closed: escHtml is
// an HTML-*text* escaper, and an attribute is HTML-decoded before its JS is
// parsed, so &#39; is a quote again by the time the string is read.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

/** Render markup into a live DOM and report whether it injected anything. */
async function probeMarkup(page, markup) {
  return page.evaluate((html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const el = host.firstElementChild;
    const out = {
      injectedAttrs: host.querySelectorAll('[onmouseover],[onerror],[onfocus]').length,
      handler: el ? (el.getAttribute('onclick') || el.getAttribute('onmousedown') || '') : '',
    };
    host.remove();
    return out;
  }, markup);
}

test.describe('genre autocomplete · handler injection', () => {
  // removeDraftGenre next door already takes an index for exactly this reason,
  // and says so in a comment. modGenrePick a few lines above still interpolated
  // the genre text — and with no escaping at all, not even the wrong one.
  test('a quote in a known genre cannot break out of the pick handler', async ({ page }) => {
    const payload = `techno','x');window.__genreXss=1;//`;
    const data = seedData();
    data.artists = [
      { id: 1, name: 'Charlotte de Witte', genres: [payload] },
      { id: 2, name: 'Needs Tagging', genres: [] },
    ];
    await bootAuthedApp(page, { data });

    await page.evaluate(() => {
      modMissingGenreArtists = [{ id: 2, name: 'Needs Tagging', genres: [] }];
      const host = document.createElement('div');
      host.id = '__mod-probe';
      host.innerHTML = renderMissingGenresHTML();
      document.body.appendChild(host);
    });
    await page.evaluate(() => modGenreSearchInput(2, 'tech'));
    await page.waitForTimeout(150);

    const row = await page.evaluate(() => {
      const el = document.querySelector('#mod-genre-results-2 .fest-search-item');
      return el && { md: el.getAttribute('onmousedown'), genre: el.dataset.genre, text: el.textContent.trim() };
    });
    expect(row, 'no suggestion rendered').not.toBeNull();

    // Whatever mechanism carries the value, clicking must not execute it.
    await page.evaluate(() => document.querySelector('#mod-genre-results-2 .fest-search-item')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__genreXss)).toBeUndefined();

    // And the value must survive intact as data, not be mangled or truncated.
    const picked = await page.evaluate(() => (modGenreDrafts[2] || [])[0]);
    expect(picked).toBe(payload.toLowerCase());
  });
});

test.describe('vendor discount code · handler injection', () => {
  test('a quote in a discount code cannot break out of the copy handler', async ({ page }) => {
    const payload = `RAVE10','x');window.__codeXss=1;//`;
    await bootAuthedApp(page, { data: seedData() });

    await page.evaluate(async (code) => {
      await dbAddVendor({
        name: 'Hostile Merch', category: 'merch', description: '',
        websiteUrl: '', instagram: '', discountCode: code, discountDescription: '10% off',
      });
      await loadVendorVillageData();
    }, payload);

    const vid = await page.evaluate(() => (window.__store.vendors || []).find(v => v.name === 'Hostile Merch')?.id);
    expect(vid, 'vendor not stored').toBeTruthy();

    await page.evaluate((id) => {
      const vendor = vendors.find(v => String(v.id) === String(id));
      const host = document.createElement('div');
      host.id = '__vendor-probe';
      host.innerHTML = vendorDetailModalHTML(vendor);
      document.body.appendChild(host);
    }, vid);
    await page.waitForTimeout(150);

    const btn = await page.evaluate(() => {
      const el = document.querySelector('#__vendor-probe .vv-discount-code');
      return el && { onclick: el.getAttribute('onclick'), code: el.dataset.code, text: el.textContent.trim() };
    });
    expect(btn, 'discount block not rendered').not.toBeNull();

    let copied = null;
    await page.exposeFunction('__recordCopy', (t) => { copied = t; });
    await page.evaluate(() => {
      navigator.clipboard.writeText = (t) => { window.__recordCopy(t); return Promise.resolve(); };
      document.querySelector('#__vendor-probe .vv-discount-code').click();
    });
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__codeXss)).toBeUndefined();
    // The code has to reach the clipboard whole — escaping that corrupts the
    // value is not a fix, it's a different bug.
    expect(copied).toBe(payload);
  });
});

test.describe('no handler interpolates free text unescaped', () => {
  // A source-level backstop for the class, not for these two sites. Every
  // interpolation inside an on*= attribute must go through a JS-string escaper
  // (escJsAttr / _tagEscAttr), be a bare id/index, or be a literal from a const.
  test('the audited free-text sites all use a JS-string escaper', async () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.html'), 'utf8');
    const offenders = [];
    for (const [label, re] of [
      ['modGenrePick', /modGenrePick\([^)]*?,\s*'\$\{(?!escJsAttr)/],
      ['copyDiscountCode', /copyDiscountCode\('\$\{(?!escJsAttr)/],
      ['toggleJamFilter tag', /toggleJamFilter\([^)]*'tag'[^)]*,\s*'\$\{(?!escJsAttr)/],
      ['toggleVendorCategoryFilter', /toggleVendorCategoryFilter\('\$\{(?!escJsAttr)/],
      ['selectVendorSubmitCategory', /selectVendorSubmitCategory\('\$\{(?!escJsAttr)/],
      ['selectVendorEditCategory', /selectVendorEditCategory\('\$\{(?!escJsAttr)/],
      ['pickGamePlanRole', /pickGamePlanRole\('\$\{(?!escJsAttr)/],
      ['openPhotoLightbox', /openPhotoLightbox\('\$\{(?!escJsAttr)/],
      ['copyClaimLink', /copyClaimLink\('\$\{(?!escJsAttr)/],
    ]) {
      if (re.test(src)) offenders.push(label);
    }
    expect(offenders).toEqual([]);
  });
});
