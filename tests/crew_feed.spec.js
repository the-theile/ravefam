// The new crew page (beta, Settings → New crew page). Same panels as the
// classic tile page, laid out as header + Huddle pill + Rave Plan tickets +
// filter chips, with the roster in a bottom sheet. These run with the flag on;
// every other crew spec keeps covering the classic page with it off.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

async function bootWithCrewFeed(page, opts = {}) {
  await page.addInitScript(() => localStorage.setItem('ravefam_crew_feed', '1'));
  return bootAuthedApp(page, opts);
}

async function openC1(page, opts) {
  await page.evaluate(async (o) => { await openDetail('c1', o); }, opts || null);
  await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
}

const panel = (page, key) => page.locator(`#crew-feature-panel-${key}`);

test.describe('new crew page · layout', () => {
  test('flag off keeps the classic tile page', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);
    await expect(page.locator('#page-crew-detail')).not.toHaveClass(/crew-feed/);
    await expect(page.locator('#page-crew-detail .crew-feature-tile')).not.toHaveCount(0);
    await expect(page.locator('#page-crew-detail .stats-subtab')).toHaveCount(2);
  });

  test('flag on renders header, Huddle pill, ticket and filters instead of tiles and tabs', async ({ page }) => {
    const errors = await bootWithCrewFeed(page);
    await openC1(page);
    const detail = page.locator('#page-crew-detail');
    await expect(detail).toHaveClass(/crew-feed/);
    await expect(detail.locator('.crew-feed-name')).toHaveText('Bass Syndicate');
    await expect(detail.locator('.crew-feed-count')).toHaveText('3');
    // Status sits above the roster + share buttons, not under the name.
    await expect(detail.locator('.crew-feed-side > .crew-status')).toHaveText(/Recruiting/);
    await expect(detail.locator('.crew-feed-title .crew-status')).toHaveCount(0);
    await expect(detail.locator('#huddle-tile-preview-root .huddle-tile-preview')).toBeVisible();
    // You and Sam are both going to Tomorrowland, so it gets a Rave Plan ticket.
    await expect(detail.locator('.crew-ticket[data-fest="f1"]')).toContainText('Tomorrowland');
    await expect(detail.locator('.crew-feed-filter')).toHaveText(['All', 'Polls', 'Jams', 'Dreams', 'Plan', 'Memories']);
    await expect(detail.locator('.crew-feature-tile')).toHaveCount(0);
    await expect(detail.locator('.stats-subtab')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('no sideways scroll at phone width, with or without the roster sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootWithCrewFeed(page);
    await openC1(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.evaluate(() => openCrewManifestSheet());
    await expect(page.locator('#crew-manifest-overlay')).toHaveClass(/open/);
    const sheet = await page.evaluate(() => {
      const el = document.getElementById('crew-manifest-content');
      return { right: el.getBoundingClientRect().right, vw: document.documentElement.clientWidth };
    });
    expect(sheet.right).toBeLessThanOrEqual(sheet.vw);
  });

  test('a Secret crew has no Polls or Jams chips', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'secret';
    await bootWithCrewFeed(page, { data });
    await openC1(page);
    await expect(page.locator('#page-crew-detail .crew-feed-filter')).toHaveText(['All', 'Dreams', 'Plan', 'Memories']);
  });
});

test.describe('new crew page · filters', () => {
  test('each chip shows only its panels', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);

    // All: the merged feed, no full panels.
    await expect(page.locator('#crew-feed-list')).toBeVisible();
    for (const k of ['poll', 'dreamboard', 'jams', 'archive']) await expect(panel(page, k)).toBeHidden();

    await page.locator('.crew-feed-filter[data-filter="poll"]').click();
    await expect(page.locator('.crew-feed-filter[data-filter="poll"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page, 'poll')).toBeVisible();
    await expect(page.locator('#crew-feed-list')).toBeHidden();
    await expect(panel(page, 'dreamboard')).toBeHidden();

    await page.locator('.crew-feed-filter[data-filter="memories"]').click();
    await expect(panel(page, 'pins')).toBeVisible();
    await expect(panel(page, 'archive')).toBeVisible();
    await expect(panel(page, 'history')).toBeVisible();
    await expect(panel(page, 'poll')).toBeHidden();
    // Archive, then Pins, then History.
    const tops = [];
    for (const k of ['archive', 'pins', 'history']) tops.push((await panel(page, k).boundingBox()).y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  test('the chosen chip survives a re-render of the same crew', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-feed-filter[data-filter="memories"]').click();
    await page.evaluate(() => renderDetail('c1'));
    await expect(page.locator('.crew-feed-filter[data-filter="memories"]')).toHaveClass(/active/);
    await expect(panel(page, 'archive')).toBeVisible();
  });

  test('tapping the ticket opens that rave\'s Plan', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-ticket[data-fest="f1"]').click();
    await expect(page.locator('.crew-feed-filter[data-filter="raveplan"]')).toHaveClass(/active/);
    await expect(panel(page, 'raveplan')).toBeVisible();
    await expect(panel(page, 'poll')).toBeHidden();
    expect(await page.evaluate(() => String(_gamePlanActiveFestivalId))).toBe('f1');
  });

  test('the existing panels still work inside the new page', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-feed-filter[data-filter="dreamboard"]').click();
    await page.evaluate(async () => {
      document.getElementById('dream-pin-input').value = 'Sunrise set at the main stage';
      await addDreamPin('c1');
    });
    await expect(page.locator('#dream-board-section')).toContainText('Sunrise set at the main stage');
  });
});

test.describe('new crew page · roster sheet', () => {
  test('the avatars open the roster sheet; Escape closes it', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-feed-faces').click();
    const sheet = page.locator('#crew-manifest-overlay');
    await expect(sheet).toHaveClass(/open/);
    await expect(sheet).toContainText('Crew Manifest');
    await expect(sheet).toContainText('Sam');
    await expect(sheet.locator('#add-member-input')).toBeVisible();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.getElementById('main-app').inert)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(sheet).not.toHaveClass(/open/);
  });

  test('only one copy of the roster exists, so its ids stay unique', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    expect(await page.locator('#add-member-input').count()).toBe(1);
    await expect(page.locator('#page-crew-detail .crew-manifest')).toHaveCount(0);
  });

  test('leaving the crew page closes the sheet', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.evaluate(() => openCrewManifestSheet());
    await expect(page.locator('#crew-manifest-overlay')).toHaveClass(/open/);
    await page.evaluate(() => closeDetail());
    await expect(page.locator('#crew-manifest-overlay')).not.toHaveClass(/open/);
  });
});

test.describe('new crew page · deep links', () => {
  test('tab:roster opens the sheet', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page, { tab: 'roster' });
    await expect(page.locator('#crew-manifest-overlay')).toHaveClass(/open/);
  });

  test('tab:gameplan opens the Plan for that rave', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page, { tab: 'gameplan', festivalId: 'f1' });
    await expect(page.locator('.crew-feed-filter[data-filter="raveplan"]')).toHaveClass(/active/);
    await expect(panel(page, 'raveplan')).toBeVisible();
  });
});

test.describe('new crew page · settings toggle', () => {
  test('turning it on in Settings swaps an open crew page', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);
    await expect(page.locator('#page-crew-detail')).not.toHaveClass(/crew-feed/);
    await page.evaluate(() => toggleCrewFeedEnabled(document.getElementById('crew-feed-settings-toggle')));
    await expect(page.locator('#page-crew-detail')).toHaveClass(/crew-feed/);
    expect(await page.evaluate(() => localStorage.getItem('ravefam_crew_feed'))).toBe('1');

    await page.evaluate(() => toggleCrewFeedEnabled(document.getElementById('crew-feed-settings-toggle')));
    await expect(page.locator('#page-crew-detail')).not.toHaveClass(/crew-feed/);
    await expect(page.locator('#page-crew-detail .stats-subtab')).toHaveCount(2);
    expect(await page.locator('#add-member-input').count()).toBe(1);
  });
});

// Crewmate content for the merged feed. `ago` is hours before now, so the
// "new since you looked" rules (watermark, or the last two weeks when a
// feature was never opened) can be exercised.
function seedFeed({ ago = 2, reads = [] } = {}) {
  const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const data = seedData();
  // Under a year old, so opening the crew doesn't award Year One mid-test.
  data.crews[0].created_at = at(24 * 30);
  data.dream_board_pins = [
    { id: 'dp1', crew_id: 'c1', added_by: 'kai-uid', label: 'Tomorrowland 2027', hyped_by: [], created_at: at(ago), deleted_at: null },
    { id: 'dp2', crew_id: 'c1', added_by: 'test-user-id', label: 'My own dream', hyped_by: [], created_at: at(ago + 1), deleted_at: null },
  ];
  data.crew_polls = [
    { id: 'p1', crew_id: 'c1', created_by: 'kai-uid', question: 'Which stage first?', poll_type: 'yes_no', options: [], is_anonymous: false, expires_at: null, is_locked: false, is_pinned: false, reactions: {}, created_at: at(ago + 2), deleted_at: null },
  ];
  data.crew_jams = [
    { id: 'j1', crew_id: 'c1', added_by: 'kai-uid', url: 'https://open.spotify.com/playlist/x', platform: 'spotify', title: 'Pre-game bangers', cover_url: null, track_count: 1, tag: null, description: '', festival_id: null, reactions: {}, is_pinned: false, poll_id: null, created_at: at(ago + 3), deleted_at: null },
  ];
  data.crew_archive_links = [
    { id: 'al1', crew_id: 'c1', added_by: 'kai-uid', url: 'https://photos.example.com/album', label: 'Gate pics', festival_id: null, created_at: at(400), deleted_at: null },
  ];
  data.crew_feed_events = [
    { id: 'fe1', crew_id: 'c1', event_type: 'badge_earned', raver_id: 'r-kai', badge_id: 'b1', badge_name: 'Squad Goals', badge_emoji: '🎯', is_crew_level: true, created_at: at(500) },
  ];
  data.crew_feature_reads = reads;
  return data;
}

const feedCards = (page) => page.locator('#crew-feed-list .crew-feed-card[data-kind]');

test.describe('new crew page · merged feed', () => {
  test('All lists every kind, new ones first then the rest newest first, with History at the end', async ({ page }) => {
    const errors = await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    await expect(feedCards(page)).toHaveCount(6);
    expect(await feedCards(page).evaluateAll(els => els.map(e => `${e.dataset.kind}:${e.dataset.id}`)))
      .toEqual(['dream:dp1', 'poll:p1', 'jam:j1', 'dream:dp2', 'archive:al1', 'badge:fe1']);
    await expect(page.locator('#crew-feed-list .crew-feed-card[data-kind="badge"]')).toHaveClass(/is-paper/);
    await expect(page.locator('#crew-feed-list .crew-feed-history')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('"new since you looked" covers crewmates\' recent posts, never your own', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    // Never-opened features: the last two weeks count, older ones don't.
    await expect(page.locator('#crew-feed-list .crew-feed-sep.is-new')).toHaveText('3 new since you looked');
    const fresh = page.locator('#crew-feed-list .crew-feed-card.is-new');
    expect(await fresh.evaluateAll(els => els.map(e => e.dataset.id))).toEqual(['dp1', 'p1', 'j1']);
  });

  test('a read watermark after the post means it is not new, and opening marks features read', async ({ page }) => {
    const later = new Date(Date.now() - 1800e3).toISOString();
    await bootWithCrewFeed(page, { data: seedFeed({ reads: [
      { user_id: 'test-user-id', crew_id: 'c1', feature: 'dreamboard', last_read_at: later },
    ] }) });
    await openC1(page);
    await expect(page.locator('#crew-feed-list .crew-feed-sep.is-new')).toHaveText('2 new since you looked');
    await expect(page.locator('#crew-feed-list .crew-feed-card[data-id="dp1"]')).not.toHaveClass(/is-new/);
    await expect.poll(() => page.evaluate(() =>
      ['poll', 'jams', 'archive', 'pins'].every(f => (window.__store.crew_feature_reads || [])
        .some(r => r.feature === f && String(r.crew_id) === 'c1')))).toBe(true);
  });

  test('hyping a dream from its card updates the card and persists', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    const hype = page.locator('#crew-feed-list .crew-feed-card[data-id="dp1"] .crew-feed-act[data-pin-id]');
    await hype.click();
    await expect(page.locator('#crew-feed-list .crew-feed-card[data-id="dp1"] .crew-feed-act[data-pin-id]')).toHaveText('🔥 Hype · 1');
    const stored = await page.evaluate(() => (window.__store.dream_board_pins.find(p => p.id === 'dp1').hyped_by || []).includes('test-user-id'));
    expect(stored).toBe(true);
  });

  test('a new dream pin shows up in the feed', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    await page.evaluate(async () => {
      document.getElementById('dream-pin-input').value = 'Boiler Room Berlin';
      await addDreamPin('c1');
    });
    // Your own post is never "new", so it tops the Earlier group.
    await expect(page.locator('#crew-feed-list .crew-feed-card[data-kind]:not(.is-new)').first()).toContainText('Boiler Room Berlin');
  });

  test('Vote jumps to the Polls chip', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    await page.locator('#crew-feed-list .crew-feed-card[data-id="p1"] .crew-feed-act', { hasText: 'Vote' }).click();
    await expect(page.locator('.crew-feed-filter[data-filter="poll"]')).toHaveClass(/active/);
    await expect(panel(page, 'poll')).toBeVisible();
    await expect(page.locator('#crew-feed-list')).toBeHidden();
  });

  test('an empty crew gets an empty state, not a blank page', async ({ page }) => {
    const data = seedData();
    data.crews[0].created_at = new Date(Date.now() - 30 * 86400e3).toISOString();  // no Year One award
    await bootWithCrewFeed(page, { data });
    await openC1(page);
    await expect(page.locator('#crew-feed-list .crew-feed-empty')).toContainText('Nothing here yet');
    await expect(page.locator('#crew-feed-list .crew-feed-history')).toBeVisible();
  });
});

test.describe('new crew page · + menu', () => {
  test('opens, closes on Escape, and Dream lands in the Dream Board input', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    const btn = page.locator('.crew-feed-add');
    const menu = page.locator('.crew-feed-add-menu');
    await btn.click();
    await expect(menu).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await btn.click();
    await menu.locator('[data-kind="dream"]').click();
    await expect(menu).toBeHidden();
    await expect(page.locator('.crew-feed-filter[data-filter="dreamboard"]')).toHaveClass(/active/);
    await expect(page.locator('#dream-pin-input')).toBeFocused();
  });

  test('Poll opens the create-poll modal', async ({ page }) => {
    await bootWithCrewFeed(page);
    await openC1(page);
    await page.locator('.crew-feed-add').click();
    await page.locator('.crew-feed-add-menu [data-kind="poll"]').click();
    await expect(page.locator('.modal-overlay.open')).toHaveCount(1);
  });

  test('a Secret crew\'s menu has no Poll or Jam', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'secret';
    await bootWithCrewFeed(page, { data });
    await openC1(page);
    await expect(page.locator('.crew-feed-add-menu [data-kind]')).toHaveCount(2);
    await expect(page.locator('.crew-feed-add-menu [data-kind="poll"]')).toHaveCount(0);
  });
});

// ── PR 3: check-offs, Reply in Huddle, non-member preview ──

function seedCheckoffs() {
  const data = seedFeed();
  data.game_plans = [{ id: 'gp1', crew_id: 'c1', festival_id: 'f1', created_at: new Date().toISOString() }];
  data.game_plan_items = [
    { id: 't1', game_plan_id: 'gp1', crew_id: 'c1', kind: 'task', added_by: 'kai-uid', text: 'Book the Airbnb',
      is_done: true, done_at: new Date(Date.now() - 1800e3).toISOString(), done_by: 'kai-uid',
      created_at: new Date(Date.now() - 86400e3).toISOString(), deleted_at: null },
    // Ticked before done_at existed: no stamp, so it never shows.
    { id: 't0', game_plan_id: 'gp1', crew_id: 'c1', kind: 'task', added_by: 'kai-uid', text: 'Old task',
      is_done: true, done_at: null, done_by: null, created_at: new Date(Date.now() - 86400e3).toISOString(), deleted_at: null },
  ];
  return data;
}

test.describe('new crew page · plan check-offs', () => {
  test('a crewmate\'s check-off shows as a paper card that opens its Rave Plan', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedCheckoffs() });
    await openC1(page);
    const card = page.locator('#crew-feed-list .crew-feed-card[data-kind="checkoff"]');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/is-paper/);
    await expect(card).toHaveClass(/is-new/);
    await expect(card).toContainText('checked off');
    await expect(card).toContainText('Book the Airbnb');
    await expect(card).toContainText('Tomorrowland Rave Plan');
    await card.locator('.crew-feed-act', { hasText: 'Open plan' }).click();
    await expect(page.locator('.crew-feed-filter[data-filter="raveplan"]')).toHaveClass(/active/);
    expect(await page.evaluate(() => String(_gamePlanActiveFestivalId))).toBe('f1');
  });

  test('ticking a task in the Rave Plan adds a check-off card without a reload', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    await page.locator('.crew-ticket[data-fest="f1"]').click();
    await expect(page.locator('#game-plan-task-input')).toBeAttached();
    await page.evaluate(async () => {
      document.getElementById('game-plan-task-input').value = 'Buy tickets';
      await addGamePlanTask('c1');
    });
    const id = await page.evaluate(() => window.__store.game_plan_items.find(it => it.text === 'Buy tickets').id);
    await page.evaluate(async (tid) => { await toggleGamePlanTask(tid, true); }, id);
    await page.locator('.crew-feed-filter[data-filter="all"]').click();
    await expect(page.locator('#crew-feed-list .crew-feed-card[data-kind="checkoff"]')).toContainText('Buy tickets');

    await page.evaluate(async (tid) => { await toggleGamePlanTask(tid, false); }, id);
    await expect(page.locator('#crew-feed-list .crew-feed-card[data-kind="checkoff"]')).toHaveCount(0);
  });
});

test.describe('new crew page · reply in Huddle', () => {
  test('Reply quotes the card in the Huddle, and the sent message links back to it', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    await page.locator('#crew-feed-list .crew-feed-card[data-id="dp1"] .crew-feed-act', { hasText: 'Reply' }).click();
    await expect(page.locator('#huddle-screen')).toBeVisible();
    await expect(page.locator('#hd-replybar-slot')).toContainText('Replying to a dream');
    await expect(page.locator('#hd-replybar-slot')).toContainText('Tomorrowland 2027');

    await page.locator('#huddle-text-input').fill('who is in??');
    await page.evaluate(() => submitHuddleTextMessage());
    await expect.poll(() => page.evaluate(() =>
      (window.__store.huddle_messages || []).find(m => m.body === 'who is in??')?.link)).toEqual(
      { k: 'tile', feature: 'dreamboard', id: 'dp1', q: 'Tomorrowland 2027' });
    await expect(page.locator('#hd-replybar-slot')).toBeEmpty();
    await expect(page.locator('#hd-stream .hd-quote', { hasText: 'Tomorrowland 2027' })).toBeVisible();
  });

  test('cancelling the quote sends a plain message', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    await page.locator('#crew-feed-list .crew-feed-card[data-id="p1"] .crew-feed-act', { hasText: 'Reply' }).click();
    await expect(page.locator('#hd-replybar-slot')).toContainText('Replying to a poll');
    await page.locator('#hd-replybar-slot .hd-replybar-close').click();
    await page.locator('#huddle-text-input').fill('plain');
    await page.evaluate(() => submitHuddleTextMessage());
    await expect.poll(() => page.evaluate(() =>
      (window.__store.huddle_messages || []).some(m => m.body === 'plain'))).toBe(true);
    expect(await page.evaluate(() => (window.__store.huddle_messages || []).find(m => m.body === 'plain').link ?? null)).toBeNull();
  });
});

function seedOtherCrew(status) {
  const data = seedData();
  data.crews.push({
    id: 'c2', name: 'Warehouse Kids', color: '#00F5FF', gradient: 'linear-gradient(90deg,#00F5FF,#5B6EFF)',
    status, leader_id: 'kai-uid', totem_photo_url: null, totem_icon: null, invite_token: 'inv-c2',
    created_at: new Date(Date.now() - 30 * 86400e3).toISOString(), deleted_at: null,
  });
  data.crew_members.push({ crew_id: 'c2', raver_id: 'r-kai', added_at: '2024-01-01T00:00:00Z', added_by: 'kai-uid', deleted_at: null });
  return data;
}

test.describe('new crew page · non-member preview', () => {
  test('outsiders get the header and a way in, not the crew\'s content', async ({ page }) => {
    const errors = await bootWithCrewFeed(page, { data: seedOtherCrew('recruiting') });
    await page.evaluate(async () => { await openDetail('c2'); });
    const detail = page.locator('#page-crew-detail');
    await expect(detail.locator('.crew-feed-name')).toHaveText('Warehouse Kids');
    await expect(detail.locator('.crew-feed-preview')).toBeVisible();
    for (const sel of ['#huddle-tile-preview-root', '.crew-feed-filters', '.crew-ticket', '.crew-feature-panel']) {
      await expect(detail.locator(sel)).toHaveCount(0);
    }
    expect(errors).toEqual([]);

    await detail.locator('.crew-feed-preview-cta .btn', { hasText: 'Join this crew' }).click();
    await expect(detail.locator('.crew-feed-filters')).toBeVisible();
    await expect(detail.locator('.crew-feed-preview')).toHaveCount(0);
    const joined = await page.evaluate(() => (window.__store.crew_members || []).some(m => m.crew_id === 'c2' && m.raver_id === 'r-you'));
    expect(joined).toBe(true);
  });

  test('a Locked In crew is invite-only', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedOtherCrew('locked-in') });
    await page.evaluate(async () => { await openDetail('c2'); });
    await expect(page.locator('.crew-feed-preview-cta .btn')).toContainText('Locked');
  });
});

test.describe('new crew page · compact pins', () => {
  test('a FAM Pin is one short row that opens the Pins panel', async ({ page }) => {
    await bootWithCrewFeed(page, { data: seedFeed() });
    await openC1(page);
    const pin = page.locator('#crew-feed-list .crew-feed-pin[data-kind="badge"]');
    await expect(pin).toContainText('The whole crew unlocked Squad Goals');
    expect((await pin.boundingBox()).height).toBeLessThan(60);
    await expect(pin.locator('.crew-feed-act')).toHaveCount(0);
    await pin.click();
    await expect(page.locator('.crew-feed-filter[data-filter="memories"]')).toHaveClass(/active/);
    await expect(page.locator('#crew-feature-panel-pins')).toBeVisible();
  });
});
