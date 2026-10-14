// Floating Huddle (iPad). On a touch iPad the Huddle opens as a phone-sized
// window over the app: drag it by its header or grab bar (it snaps to the
// nearer side), resize it from the inner bottom corner, minimize it to a
// bubble, or expand it to the full framed column. It stays open while you
// browse. See "Floating Huddle (iPad)" in app.html.
//
// Headless Chromium can't be trusted to keep hover:none / pointer:coarse
// emulation (see ipad_layout.spec.js), so each test switches the window on by
// replacing huddleFloatEligible(), and switches the tablet CSS on through the
// CSSOM, which together are what a real iPad renders.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

const LANDSCAPE = { width: 1180, height: 820 };
const PORTRAIT = { width: 820, height: 1180 };
const GAP = 16;

const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60000).toISOString();

function seedWithChat() {
  const data = seedData();
  data.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
  ];
  data.huddle_messages = [
    { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'who is driving tomorrow', reactions: {}, created_at: minsAgo(20), deleted_at: null, mentions: [] },
    { id: 'm2', room_id: 'room-main', crew_id: 'c1', sender_id: TEST_UID, kind: 'text', body: 'riding with you', reactions: {}, created_at: minsAgo(10), deleted_at: null, mentions: [] },
  ];
  data.huddle_room_reads = [{ room_id: 'room-main', user_id: TEST_UID, last_read_at: minsAgo(1) }];
  return data;
}

async function bootTablet(page, { eligible = true } = {}) {
  const errors = await bootAuthedApp(page, { data: seedWithChat(), sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  await page.evaluate((on) => {
    window.huddleFloatEligible = () => on;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.media && /pointer: coarse\) and \(min-width: 641px\)/.test(r.media.mediaText)) r.media.mediaText = 'all';
      }
    }
  }, eligible);
  // The snap and slide-in animations only delay what these measure.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  return errors;
}

async function openFloating(page) {
  await page.evaluate(async () => { await openHuddle('c1'); });
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
  await expect(page.locator('#hd-head .hd-room-name')).toHaveText(/main huddle/i);
  await settled(page);
}

// The window slides in (a 10px transform); measure it once that's done.
async function settled(page) {
  await expect.poll(() => page.locator('#huddle-screen').evaluate(el => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
}

const windowRect = (page) => page.locator('#huddle-screen').evaluate(el => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
});

async function drag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(350); // the snap animation
}

async function grabBarCenter(page) {
  const b = await page.locator('#hd-grab').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe('floating Huddle · iPad', () => {
  test.use({ viewport: LANDSCAPE, hasTouch: true });

  test('opens as a phone-sized window on the right, clear of the tabs, with the page still usable', async ({ page }) => {
    const errors = await bootTablet(page);
    await openFloating(page);
    await expect(page.locator('#huddle-screen')).toHaveClass(/is-floating/);
    const r = await windowRect(page);
    expect(r.w).toBe(390);
    expect(r.x + r.w).toBe(LANDSCAPE.width - GAP);
    expect(r.y + r.h).toBe(LANDSCAPE.height - GAP);
    const navBottom = await page.locator('nav').evaluate(n => n.getBoundingClientRect().bottom);
    expect(r.y).toBeGreaterThan(navBottom);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    // No keyboard just for opening it.
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('huddle-text-input');

    // The tab bar beside it still works, and the window stays up.
    await page.locator('.nav-tab.c-raves').click();
    await expect(page.locator('#page-events')).toHaveClass(/active/);
    await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
    expect(errors).toEqual([]);
  });

  test('stays open when you leave the crew, and ✕ closes it', async ({ page }) => {
    await bootTablet(page);
    await page.evaluate(async () => { await openDetail('c1'); });
    await openFloating(page);
    await page.evaluate(() => closeDetail());
    await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
    // Still live on its crew: the room and its messages are intact.
    await expect(page.locator('.hd-bub-body').last()).toContainText('riding with you');

    await page.locator('#hd-head .hd-back').click();
    await expect(page.locator('#huddle-screen')).toHaveCount(0);
  });

  test('dragging the grab bar snaps it to the nearer side, inside the screen, and it reopens there', async ({ page }) => {
    await bootTablet(page);
    await openFloating(page);
    const before = await windowRect(page);
    // Most of the way left and far past the top: it lands on the left edge,
    // pulled back inside the screen.
    await drag(page, await grabBarCenter(page), -600, -400);
    const after = await windowRect(page);
    expect(after.x).toBe(GAP);
    expect(after.y).toBeGreaterThanOrEqual(GAP);
    expect(after.w).toBe(before.w);
    await expect(page.locator('#huddle-screen')).toHaveAttribute('data-side', 'left');

    await page.locator('#hd-head .hd-back').click();
    await openFloating(page);
    expect(await windowRect(page)).toEqual(after);
  });

  test('the header buttons keep their taps: a tap on search opens search, not a drag', async ({ page }) => {
    await bootTablet(page);
    await openFloating(page);
    const before = await windowRect(page);
    await page.locator('#hd-head .hd-search-btn').click();
    await expect(page.locator('#hd-search-panel')).toBeVisible();
    expect(await windowRect(page)).toEqual(before);
  });

  test('the corner grip resizes within the limits, keeping the snapped edge put', async ({ page }) => {
    await bootTablet(page);
    await openFloating(page);
    const before = await windowRect(page);
    const grip = await page.locator('#huddle-screen .hd-resize').boundingBox();
    const at = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };

    // Right-side window: the grip is bottom-left; left and up makes it wider
    // and shorter, right edge fixed.
    await drag(page, at, -120, -100);
    let r = await windowRect(page);
    expect(r.w).toBe(before.w + 120);
    expect(r.h).toBe(before.h - 100);
    expect(r.x + r.w).toBe(before.x + before.w);

    // Way past the minimum: it stops at 360×480.
    const grip2 = await page.locator('#huddle-screen .hd-resize').boundingBox();
    await drag(page, { x: grip2.x + grip2.width / 2, y: grip2.y + grip2.height / 2 }, 900, -900);
    r = await windowRect(page);
    expect(r.w).toBe(360);
    expect(r.h).toBe(480);
    expect(r.x + r.w).toBe(LANDSCAPE.width - GAP);
  });

  test('minimize keeps the draft; a message while minimized badges the bubble and stays unread until restored', async ({ page }) => {
    await bootTablet(page);
    await page.evaluate(() => loadHuddleActivityCache());
    await openFloating(page);
    await page.fill('#huddle-text-input', 'half a thought');

    await page.locator('#hd-head .hd-win-btn[aria-label="Minimize the Huddle"]').click();
    await expect(page.locator('#huddle-screen')).toBeHidden();
    const bubble = page.locator('#hd-bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble.locator('.hd-bubble-badge')).toHaveText('');

    // What the realtime INSERT handlers do: the screen's channel appends it,
    // the app-wide one counts it, since a minimized room isn't open.
    await page.evaluate(() => {
      const row = { id: 'incoming', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'where are you', reactions: {}, created_at: new Date().toISOString(), deleted_at: null, mentions: [] };
      huddleMessages.push(row);
      renderHuddleUI();
      handleHuddleMessageRealtimeInsert({ new: row });
    });
    await expect(bubble.locator('.hd-bubble-badge')).toHaveText('1');
    await expect(bubble).toHaveAttribute('aria-label', /1 unread/);

    await bubble.click();
    await expect(page.locator('#hd-bubble')).toHaveCount(0);
    await expect(page.locator('#huddle-screen')).toBeVisible();
    await expect(page.locator('#huddle-text-input')).toHaveValue('half a thought');
    await expect(page.locator('#hd-unread-divider')).toHaveCount(1);
    expect(await page.evaluate(() => (_huddleRoomUnreadCache || {})['room-main'] || 0)).toBe(0);
  });

  test('the bubble drags and snaps to a side; a drag does not reopen the window', async ({ page }) => {
    await bootTablet(page);
    await openFloating(page);
    await page.locator('#hd-head .hd-win-btn[aria-label="Minimize the Huddle"]').click();
    const b = await page.locator('#hd-bubble').boundingBox();
    await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, -900, -200);
    await expect(page.locator('#huddle-screen')).toBeHidden();
    const after = await page.locator('#hd-bubble').boundingBox();
    expect(Math.round(after.x)).toBe(GAP);
    expect(Math.round(after.y)).toBe(Math.round(b.y) - 200);
  });

  test('expand switches to the full framed view and float switches back; the choice is remembered', async ({ page }) => {
    await bootTablet(page);
    await openFloating(page);
    await page.locator('#hd-head .hd-win-btn[aria-label="Expand the Huddle to full screen"]').click();
    await expect(page.locator('#huddle-screen')).not.toHaveClass(/is-floating/);
    expect(await windowRect(page)).toEqual({ x: 0, y: 0, w: LANDSCAPE.width, h: LANDSCAPE.height });
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expect(page.locator('#hd-head .hd-back')).toHaveText('‹');

    await page.locator('#hd-head .hd-back').click();
    await openFloating(page);
    await expect(page.locator('#huddle-screen')).not.toHaveClass(/is-floating/);

    await page.locator('#hd-head .hd-win-btn[aria-label="Float the Huddle in a window"]').click();
    await expect(page.locator('#huddle-screen')).toHaveClass(/is-floating/);
    expect((await windowRect(page)).w).toBe(390);
  });

  test('dropping below the size that fits a window (Split View) switches to full screen live, and back', async ({ page }) => {
    await bootTablet(page);
    await openFloating(page);
    await page.locator('#hd-head .hd-win-btn[aria-label="Minimize the Huddle"]').click();
    await page.evaluate(() => { window.huddleFloatEligible = () => false; window.dispatchEvent(new Event('resize')); });
    await expect(page.locator('#huddle-screen')).toBeVisible();
    await expect(page.locator('#huddle-screen')).not.toHaveClass(/is-floating/);
    await expect(page.locator('#hd-bubble')).toHaveCount(0);
    await expect(page.locator('#hd-head .hd-win-btn')).toHaveCount(0);

    await page.evaluate(() => { window.huddleFloatEligible = () => true; window.dispatchEvent(new Event('resize')); });
    await expect(page.locator('#huddle-screen')).toHaveClass(/is-floating/);
  });

  // Headless Chromium has no on-screen keyboard; what it does to the visual
  // viewport (shrinks it) is what huddleFloatBounds() reads, so stub that.
  test('the keyboard lifts the window so the composer stays above it, and it settles back after', async ({ page }) => {
    await bootTablet(page);
    await openFloating(page);
    const before = await windowRect(page);
    await page.evaluate(() => {
      const real = huddleFloatBounds;
      window.__realBounds = real;
      window.huddleFloatBounds = () => Object.assign(real(), { bottom: 420 });
      window.dispatchEvent(new Event('resize'));
    });
    const up = await windowRect(page);
    expect(up.y + up.h).toBeLessThanOrEqual(420);
    expect(up.h).toBeGreaterThan(200);
    const composer = await page.locator('.hd-composer').boundingBox();
    expect(composer.y + composer.height).toBeLessThanOrEqual(420);

    await page.evaluate(() => { window.huddleFloatBounds = window.__realBounds; window.dispatchEvent(new Event('resize')); });
    expect(await windowRect(page)).toEqual(before);
  });

  test('a saved spot from landscape still fits in portrait', async ({ page }) => {
    await bootTablet(page);
    await page.evaluate(() => localStorage.setItem('rf_hd_float', JSON.stringify({ side: 'right', y: 40, w: 1000, h: 2000 })));
    await page.setViewportSize(PORTRAIT);
    await openFloating(page);
    const r = await windowRect(page);
    expect(r.x).toBeGreaterThanOrEqual(GAP);
    expect(r.x + r.w).toBe(PORTRAIT.width - GAP);
    expect(r.y + r.h).toBeLessThanOrEqual(PORTRAIT.height - GAP);
  });

  test('an activity line opens its item beside the window instead of closing it', async ({ page }) => {
    const data = seedWithChat();
    data.huddle_messages.push({ id: 'sys-rave', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'system', body: '🎟️ Kai is going to Tomorrowland', link: { k: 'rave', id: 'f1' }, reactions: {}, created_at: minsAgo(5), deleted_at: null, mentions: [] });
    await bootAuthedApp(page, { data, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
    await page.evaluate(() => { window.huddleFloatEligible = () => true; });
    await openFloating(page);
    await page.locator('.huddle-system-row.is-link').click();
    await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
    await expect(page.locator('#huddle-screen')).toHaveClass(/is-floating/);
  });

  test("Rave Plan for another crew doesn't retarget the open window", async ({ page }) => {
    const data = seedWithChat();
    data.crews.push({ id: 'c2', name: 'Night Owls', color: '#00F5FF', gradient: 'linear-gradient(90deg,#00F5FF,#BF00FF)', status: 'recruiting', leader_id: TEST_UID, totem_photo_url: null, totem_icon: null, invite_token: 'inv-c2', created_at: '2024-01-01T00:00:00Z', deleted_at: null });
    data.crew_members.push(
      { crew_id: 'c2', raver_id: 'r-you', added_at: '2024-01-01T00:00:00Z', added_by: TEST_UID, deleted_at: null },
      { crew_id: 'c2', raver_id: 'r-sam', added_at: '2024-01-01T00:00:00Z', added_by: TEST_UID, deleted_at: null });
    await bootAuthedApp(page, { data, sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
    await page.evaluate(() => { window.huddleFloatEligible = () => true; });
    await openFloating(page);

    const result = await page.evaluate(async () => {
      const room = await ensureHuddleRoomForFestival('c2', 'f1');
      return { roomCrew: room && room.crew_id, active: _huddleActiveCrewId, rooms: [...new Set(huddleRooms.map(r => r.crew_id))] };
    });
    expect(result).toEqual({ roomCrew: 'c2', active: 'c1', rooms: ['c1'] });
    await expect(page.locator('#hd-head .hd-sub')).toContainText('Bass Syndicate');
  });

  test('phones and mouse desktops keep the full-screen Huddle with no window controls', async ({ page }) => {
    await bootTablet(page, { eligible: false });
    await openFloating(page);
    await expect(page.locator('#huddle-screen')).not.toHaveClass(/is-floating/);
    await expect(page.locator('#hd-head .hd-win-btn')).toHaveCount(0);
    // Navigating away still dismisses it, as it always has (it covers the
    // tab bar, so this is what a tab tap runs).
    await page.evaluate(() => switchTab('events'));
    await expect(page.locator('#huddle-screen')).toHaveCount(0);
  });
});
