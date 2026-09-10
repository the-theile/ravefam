// Finding 14: handlers a keyboard can't reach. A <div onclick> fires on tap and
// on nothing else — no focus, no Enter, no screen-reader announcement. Leaf
// controls are now real <button>s; cards and rows that wrap their own buttons
// carry role="button" + tabindex instead, which the global Enter/Space delegate
// turns into a working control.
//
// This sweeps the RENDERED DOM rather than the source, so template output counts
// and a new <div onclick> can't slip in behind a grep.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

// Clickable-but-deliberately-not-focusable, each for a stated reason. Anything
// not on this list must be keyboard-operable.
const ALLOWED = {
  'tag-sheet-backdrop': 'backdrop — Escape closes the sheet',
  'photo-lightbox': 'backdrop — Escape closes the lightbox',
  'photo-lightbox-card': 'stops propagation only; performs no action',
  'fest-vibe-picker': 'stops propagation only; performs no action',
  'map-pin-lightbox': 'backdrop — Escape closes the lightbox',
  'modal-overlay': 'backdrop — Escape closes the modal',
  'bottom-sheet-overlay': 'backdrop — Escape closes the sheet',
  'notif-drawer-overlay': 'backdrop — Escape closes the drawer',
  // Both of these sit beside a real button that does the same thing, so adding
  // a tab stop would only duplicate it.
  'profile-avatar-ring': 'duplicate of the adjacent .avatar-photo-btn',
  'ief-wrap': 'duplicate of the edit button it wraps',
};

/** Every clickable element the keyboard cannot operate. */
async function unreachableHandlers(page, scope = 'document') {
  return page.evaluate(([allowed, scopeSel]) => {
    const root = scopeSel === 'document' ? document : document.querySelector(scopeSel);
    if (!root) return ['(scope not found)'];
    const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
    // A handler that only swallows the event, or only closes on a click that
    // landed on the backdrop itself, is not a control and needs no tab stop.
    const INERT_HANDLER = /^\s*(event\.stopPropagation\(\)\s*;?\s*)+$|event\.target\s*===?\s*this/;
    return [...root.querySelectorAll('[onclick]')]
      .filter((el) => {
        if (NATIVE.has(el.tagName)) return false;
        if (el.getAttribute('role') === 'button' && el.hasAttribute('tabindex')) return false;
        if (INERT_HANDLER.test(el.getAttribute('onclick') || '')) return false;
        return ![...el.classList].some(c => allowed.includes(c));
      })
      .map(el => `<${el.tagName.toLowerCase()}> #${el.id || '-'} .${[...el.classList].join('.') || '-'} → ${(el.getAttribute('onclick') || '').slice(0, 50)}`);
  }, [Object.keys(ALLOWED), scope]);
}

test.describe('no clickable element is keyboard-unreachable', () => {
  test('the app shell at rest', async ({ page }) => {
    await bootAuthedApp(page);
    expect(await unreachableHandlers(page)).toEqual([]);
  });

  test('the rave list, both as cards and as rows', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('events'));
    for (const view of ['card', 'list']) {
      await page.evaluate((v) => setRaveView(v), view);
      await page.waitForTimeout(250);
      expect(await unreachableHandlers(page, '#events-list'), view).toEqual([]);
    }
  });

  test('a profile, in view and in edit mode', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-you'));
    await page.waitForTimeout(300);
    expect(await unreachableHandlers(page, '#page-profile')).toEqual([]);
    await page.evaluate(() => enterProfileEditMode('r-you'));
    await page.waitForTimeout(300);
    expect(await unreachableHandlers(page, '#page-profile')).toEqual([]);
  });

  test('a crew detail', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openDetail('c1'));
    await page.waitForTimeout(400);
    expect(await unreachableHandlers(page, '#detail-overlay')).toEqual([]);
  });

  test('the stats page and the rave log', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('stats'));
    await page.waitForTimeout(600);
    expect(await unreachableHandlers(page, '#page-stats')).toEqual([]);
  });

  test('the help / FAQ page', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { openAppGuide(); switchGuideTab('faq'); });
    await page.waitForTimeout(400);
    expect(await unreachableHandlers(page, '#app-guide-overlay')).toEqual([]);
  });
});

test.describe('the converted leaf controls', () => {
  test('are real buttons that take focus', async ({ page }) => {
    await bootAuthedApp(page);
    const probe = await page.evaluate(() => {
      const el = document.querySelector('.logo-text');
      if (!el) return null;
      el.focus();
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName, type: el.getAttribute('type'),
        named: !!el.getAttribute('aria-label'),
        focused: document.activeElement === el,
        w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    expect(probe).not.toBeNull();
    expect(probe.tag).toBe('BUTTON');
    expect(probe.type).toBe('button');
    expect(probe.named).toBe(true);
    expect(probe.focused).toBe(true);
    // The header logo is the one conversion where a collapsed box would be
    // obvious on every screen, so check it still occupies its row.
    expect(probe.w).toBeGreaterThan(60);
    expect(probe.h).toBeGreaterThan(14);
  });

  test('the crew status badge is a button on the card', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('crews'));
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => {
      const el = document.querySelector('.crew-status');
      return el && { tag: el.tagName, type: el.getAttribute('type'), text: el.textContent.trim() };
    });
    test.skip(!info, 'no crew card in this seed');
    expect(info.tag).toBe('BUTTON');
    expect(info.type).toBe('button');
    expect(info.text.length).toBeGreaterThan(0);
  });

  test('"+ Add nickname" is reachable when there is no nickname yet', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-sam'));
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const el = document.querySelector('.ief-add-nickname');
      if (!el) return null;
      el.focus();
      return { tag: el.tagName, focused: document.activeElement === el };
    });
    test.skip(!info, 'nickname affordance not rendered for this raver');
    expect(info.tag).toBe('BUTTON');
    expect(info.focused).toBe(true);
  });
});

test.describe('role=button containers behave like buttons', () => {
  test('Enter on a rave row expands it', async ({ page }) => {
    await bootAuthedApp(page);
    // .page is display:none until its tab is active, and a hidden element
    // cannot take focus — so the tab switch is load-bearing here.
    await page.evaluate(() => { switchTab('events'); setRaveView('list'); });
    await page.waitForTimeout(400);

    const row = page.locator('.rave-row').first();
    const n = await page.locator('.rave-row').count();
    test.skip(n === 0, 'no rave rows in this seed');

    expect(await row.getAttribute('aria-expanded')).toBe('false');
    await row.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    // The list re-renders, so read the state off the fresh row.
    expect(await page.locator('.rave-row').first().getAttribute('aria-expanded')).toBe('true');
  });

  test('a FAQ question keeps aria-expanded in step with what is drawn', async ({ page }) => {
    await bootAuthedApp(page);
    // The FAQ list only renders once its tab is selected.
    await page.evaluate(() => { openAppGuide(); switchGuideTab('faq'); });
    await page.waitForTimeout(400);

    const q = page.locator('.help-faq-q').first();
    const n = await page.locator('.help-faq-q').count();
    test.skip(n === 0, 'FAQ not reachable in this seed');

    await q.focus();
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => {
      const el = document.querySelector('.help-faq-q');
      return {
        expanded: el.getAttribute('aria-expanded'),
        open: el.closest('.help-faq-item').classList.contains('open'),
      };
    });
    expect(state.open).toBe(true);
    expect(state.expanded).toBe('true');
  });
});
