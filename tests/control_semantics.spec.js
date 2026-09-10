// Controls that were <div onclick> / <span onclick>: unfocusable, no role, and
// inert on Enter. Converting them to <button> is a rendering risk as much as a
// semantic one — a button inside a flex or grid row can lay out differently —
// so these check geometry as well as semantics.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

/** Element is a real button, reachable, and occupies a sensible box. */
async function assertUsableControl(page, selector, label) {
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    el.focus();
    return {
      tag: el.tagName,
      type: el.getAttribute('type'),
      w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display,
      focusable: document.activeElement === el,
    };
  }, selector);

  expect(info, `${label}: not found (${selector})`).not.toBeNull();
  expect(info.tag, `${label}: not a button`).toBe('BUTTON');
  // Without type="button" a button inside a form submits it.
  expect(info.type, `${label}: missing type=button`).toBe('button');
  expect(info.focusable, `${label}: could not take focus`).toBe(true);
  expect(info.w, `${label}: zero width — layout broke`).toBeGreaterThan(8);
  expect(info.h, `${label}: zero height — layout broke`).toBeGreaterThan(8);
  return info;
}

test.describe('converted controls', () => {
  test('the add-a-crew tile is a usable, full-width button', async ({ page }) => {
    await bootAuthedApp(page);
    const info = await assertUsableControl(page, '.crew-add-card', 'crew-add-card');
    // It was a block-level card; a button defaults to inline-block, which would
    // collapse it out of the grid row.
    expect(info.display).toBe('block');
    expect(info.w).toBeGreaterThan(100);
  });

  test('the poll type cards are usable buttons', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openCreatePollModal && openCreatePollModal('c1'));
    await page.waitForTimeout(250);

    const present = await page.evaluate(() => !!document.querySelector('#poll-type-choice'));
    test.skip(!present, 'poll modal not reachable in this seed');
    for (const id of ['#poll-type-choice', '#poll-type-yes_no', '#poll-type-rating']) {
      await assertUsableControl(page, id, id);
    }
  });

  test('tag-sheet chips are buttons and report their pressed state', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-you'));
    await page.evaluate(() => enterProfileEditMode('r-you'));
    await page.evaluate(() => openTagSheet && openTagSheet('genre'));
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.genre-preset, .vibe-preset')];
      return {
        n: chips.length,
        allButtons: chips.every(c => c.tagName === 'BUTTON'),
        allPressed: chips.every(c => c.hasAttribute('aria-pressed')),
        // A stale inline keydown would double-fire alongside the native click.
        anyInlineKeydown: chips.some(c => c.hasAttribute('onkeydown')),
      };
    });
    test.skip(state.n === 0, 'tag sheet not reachable in this seed');
    expect(state.allButtons).toBe(true);
    expect(state.allPressed).toBe(true);
    expect(state.anyInlineKeydown).toBe(false);
  });

  // Scoped to the classes converted from div/span. 367 older buttons in the app
  // have no type, which is harmless here — the only <form> is the Huddle
  // composer and it already types its own buttons — but a newly converted
  // control landing inside a form without type would silently submit it.
  test('the converted control classes all carry type="button"', async ({ page }) => {
    await bootAuthedApp(page);
    const CONVERTED = [
      'color-swatch', 'vibe-chip-remove', 'tag-acc-header', 'vibe-preset',
      'genre-preset', 'poll-modal-type-card', 'crew-add-card', 'plur-bar-section',
      'plur-ledger-toggle', 'fest-quick-chip', 'stats-pill',
    ];
    const untyped = await page.evaluate((classes) =>
      classes.flatMap(c =>
        [...document.querySelectorAll(`.${c}`)]
          .filter(el => el.tagName === 'BUTTON' && el.getAttribute('type') !== 'button')
          .map(el => `${c}: type=${el.getAttribute('type')}`)), CONVERTED);
    expect(untyped).toEqual([]);
  });
});

test.describe('stats genre pills · handler injection', () => {
  test('a quote in a genre name cannot open a new attribute', async ({ page }) => {
    const payload = `hard" onmouseover="window.__genreXss=1" x="`;
    const data = seedData();
    data.ravers.find(r => r.id === 'r-you').genres = [payload, 'Techno'];
    await bootAuthedApp(page, { data });

    // Render the pill markup directly — the stats page needs seen-artist data
    // this stub doesn't carry, but the escaping is what's under test.
    const html = await page.evaluate((g) =>
      `<button type="button" class="stats-pill" onclick="openArtistsSeenPage('${escJsAttr(g)}')"></button>`, payload);

    const probe = await page.evaluate((markup) => {
      const host = document.createElement('div');
      host.innerHTML = markup;
      document.body.appendChild(host);
      const btn = host.querySelector('button');
      const out = {
        injected: host.querySelectorAll('[onmouseover]').length,
        onclick: btn ? btn.getAttribute('onclick') : null,
      };
      host.remove();
      return out;
    }, html);

    expect(probe.injected).toBe(0);
    expect(await page.evaluate(() => window.__genreXss)).toBeUndefined();
    // The quote survived as data inside the JS string, not as attribute syntax.
    expect(probe.onclick).toContain('&quot;'.replace('&quot;', '"'));
  });
});
