const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

async function refetch(page, expr) {
  return page.evaluate(async (src) => { await loadAllData(); return eval(src); }, expr);
}

test.describe('crews', () => {
  test('crew detail lists both members', async ({ page }) => {
    await bootAuthedApp(page);
    await page.locator('#crew-grid .crew-card .crew-row-open').first().click();
    // The detail roster shows first names only.
    const detail = page.locator('#page-crew-detail');
    await expect(detail).toContainText('Theile');
    await expect(detail).toContainText('Sam');
  });

  test('editing a crew name persists', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => {
      showCrewEditModal('c1');
      document.getElementById('crew-edit-name-input').value = 'Bass Syndicate II';
      saveCrewEdit();
    });
    const name = await refetch(page, "crews.find(c=>String(c.id)==='c1').name");
    expect(name).toBe('Bass Syndicate II');
  });

  test('changing crew status persists (recruiting → locked-in)', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(async () => { await sb.from('crews').update({ status: 'locked-in' }).eq('id', 'c1'); });
    const status = await refetch(page, "crews.find(c=>String(c.id)==='c1').status");
    expect(status).toBe('locked-in');
  });

  test('opening a freshly-created crew to recruiting works after the temp id resolves', async ({ page }) => {
    // Regression test: createCrew() renders the detail page immediately with a
    // client-side temp id, then swaps in the real DB id once the insert
    // resolves. If the detail page isn't re-rendered on that swap, the "Open
    // the Crew to Recruiting" button keeps calling setStatus() with the
    // stale temp id — getCrew() then finds nothing, and the (sole, actual)
    // Crew Lead gets a misleading "Only the Crew Lead can change the status"
    // toast.
    await bootAuthedApp(page);

    await page.evaluate(() => {
      document.getElementById('crew-name-input').value = 'Our House';
      createCrew();
    });

    // Wait for the temp -> real id swap (the async dbSaveCrew().then()) to land.
    await expect
      .poll(() => page.evaluate(() => crews.find(c => c.name === 'Our House')?.id))
      .not.toMatch(/^temp_/);

    // The lead is on the Roster tab — where the status control lives.
    await page.locator('#page-crew-detail .stats-subtab', { hasText: 'Roster' }).click();
    await page.locator('#page-crew-detail .btn-status-cta', { hasText: 'Open the Crew to Recruiting' }).click();
    await page.locator('#status-warn-modal .btn-primary').click();

    await expect(page.locator('#toast')).not.toContainText('Only the Crew Lead');
    const status = await page.evaluate(() => crews.find(c => c.name === 'Our House')?.status);
    expect(status).toBe('recruiting');
  });

  test('deleting a crew removes it and its memberships', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(async () => { await deleteCrew('c1', 'test cleanup'); });
    // Soft delete: gone from live app state and future re-fetches, but the
    // underlying rows persist with deleted_at set (see soft_delete.spec.js).
    const gone = await refetch(page, "crews.some(c=>String(c.id)==='c1')");
    expect(gone).toBe(false);
    const crewRow = await page.evaluate(() => window.__store.crews.find(c => c.id === 'c1'));
    expect(crewRow.deleted_at).toBeTruthy();
    expect(crewRow.delete_reason).toBe('test cleanup');
    const members = await page.evaluate(() => window.__store.crew_members.filter(m => m.crew_id === 'c1'));
    expect(members.length).toBeGreaterThan(0);
    expect(members.every(m => m.deleted_at)).toBe(true);

    const audit = await page.evaluate(() =>
      window.__store.audit_logs.filter(a => a.action === 'crew.delete' && a.entity_id === 'c1'));
    expect(audit.length).toBe(1);
    expect(audit[0].reason).toBe('test cleanup');
  });

  test('crew search shows no card for an unknown query, restores on clear', async ({ page }) => {
    await bootAuthedApp(page);
    await page.fill('#crew-search', 'zzz-no-match');
    await page.evaluate(() => renderCrews());
    await expect(page.locator('#crew-grid .crew-card')).toHaveCount(0);
    await page.fill('#crew-search', '');
    await page.evaluate(() => renderCrews());
    await expect(page.locator('#crew-grid .crew-card')).toHaveCount(1);
  });

  // Two crews: c1 (Bass Syndicate, visible) and c2 (a secret crew).
  function seedTwoCrews() {
    const data = seedData();
    data.crews.push({
      id: 'c2', name: 'Night Shift', color: '#00F5FF',
      gradient: 'linear-gradient(90deg,#00F5FF,#BF00FF)', status: 'secret',
      leader_id: TEST_UID, totem_photo_url: null, totem_icon: null, invite_token: 'inv-c2',
      created_at: '2024-02-01T00:00:00Z', deleted_at: null,
    });
    data.crew_members.push({ crew_id: 'c2', raver_id: 'r-you', added_at: '2024-02-01T00:00:00Z', added_by: TEST_UID, deleted_at: null });
    return data;
  }

  test('crew list is an accordion: one row open, tapping toggles it', async ({ page }) => {
    await bootAuthedApp(page, { data: seedTwoCrews() });
    const cards = page.locator('#crew-grid .crew-card');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('#crew-grid .crew-card.is-open')).toHaveCount(1);

    const closed = page.locator('#crew-grid .crew-card:not(.is-open)');
    const closedId = await closed.getAttribute('data-crew-id');
    await closed.locator('.crew-row-toggle').click();
    const nowOpen = page.locator(`#crew-grid .crew-card[data-crew-id="${closedId}"]`);
    await expect(nowOpen).toHaveClass(/is-open/);
    await expect(nowOpen.locator('.crew-row-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#crew-grid .crew-card.is-open')).toHaveCount(1);

    // Tapping the open row collapses everything, and it stays collapsed across re-renders.
    await nowOpen.locator('.crew-row-toggle').click();
    await expect(page.locator('#crew-grid .crew-card.is-open')).toHaveCount(0);
    await page.evaluate(() => renderCrews());
    await expect(page.locator('#crew-grid .crew-card.is-open')).toHaveCount(0);
  });

  test('visibility eye only shows on the open row, crossed out for secret crews', async ({ page }) => {
    await bootAuthedApp(page, { data: seedTwoCrews() });
    await expect(page.locator('#crew-grid .crew-row-eye')).toHaveCount(1);
    await expect(page.locator('#crew-grid .crew-row-toggle .crew-row-eye')).toHaveCount(0);

    await page.locator('#crew-grid .crew-card[data-crew-id="c2"] .crew-row-toggle').click();
    await expect(page.locator('#crew-grid .crew-card[data-crew-id="c2"] .crew-row-eye.eye-secret')).toHaveCount(1);
    await page.locator('#crew-grid .crew-card[data-crew-id="c1"] .crew-row-toggle').click();
    await expect(page.locator('#crew-grid .crew-card[data-crew-id="c1"] .crew-row-eye.eye-open')).toHaveCount(1);
  });

  test('a collapsed row carries the Huddle unread badge', async ({ page }) => {
    const data = seedTwoCrews();
    data.huddle_rooms = [
      { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
    ];
    data.huddle_messages = [
      { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'yo', reactions: {}, created_at: '2099-01-01T00:00:00Z', deleted_at: null },
    ];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => loadHuddleActivityCache());
    await page.locator('#crew-grid .crew-card[data-crew-id="c2"] .crew-row-toggle').click();
    const c1 = page.locator('#crew-grid .crew-card[data-crew-id="c1"]');
    await expect(c1.locator('.crew-row-badge')).toHaveText('1');
    await expect(c1.locator('.huddle-cta-btn')).toHaveCount(0);
  });

  test('collapsed rows show a small avatar stack and dim the stripe of secret crews', async ({ page }) => {
    await bootAuthedApp(page, { data: seedTwoCrews() });
    const c2 = page.locator('#crew-grid .crew-card[data-crew-id="c2"]');
    await expect(c2).not.toHaveClass(/is-open/);
    await expect(c2).toHaveClass(/is-secret/);
    await expect(c2.locator('.crew-row-avs .avatar')).toHaveCount(1);
    const filter = await c2.locator('.crew-row-stripe').evaluate(el => getComputedStyle(el).filter);
    expect(filter).toContain('grayscale');
    // The open row drops the mini stack — the full roster is in its body.
    await expect(page.locator('#crew-grid .crew-card.is-open .crew-row-avs')).toHaveCount(0);
  });

  test('the open row previews the latest Huddle message and opens the Huddle', async ({ page }) => {
    const data = seedData();
    data.huddle_rooms = [
      { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
    ];
    data.huddle_messages = [
      { id: 'm1', room_id: 'room-main', crew_id: 'c1', sender_id: 'kai-uid', kind: 'text', body: 'who is driving?', reactions: {}, created_at: '2099-01-01T00:00:00Z', deleted_at: null },
    ];
    await bootAuthedApp(page, { data });
    await page.evaluate(() => loadHuddleActivityCache());
    const last = page.locator('#crew-grid .crew-card.is-open .crew-row-last');
    await expect(last).toContainText('who is driving?');
    await last.click();
    await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
  });

  test('quick RSVP adds the next-up rave to your list when you are not going yet', async ({ page }) => {
    const data = seedData();
    data.raver_festivals = data.raver_festivals.filter(r => r.raver_id !== 'r-you');
    await bootAuthedApp(page, { data });
    const rsvp = page.locator('#crew-grid .crew-card.is-open .crew-row-rsvp:not(.is-interest)');
    await expect(rsvp).toHaveCount(1);
    await rsvp.click();
    await expect(page.locator('#crew-grid .crew-card.is-open .crew-row-rsvp')).toHaveCount(0);
    await expect(page.locator('#crew-grid .crew-card.is-open .crew-row-fest-going')).toContainText('2 going');
    const stored = await page.evaluate(() =>
      (window.__store.raver_festivals || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f1'));
    expect(stored).toBe(true);
  });

  test('no quick RSVP when you are already going', async ({ page }) => {
    await bootAuthedApp(page);
    await expect(page.locator('#crew-grid .crew-card.is-open .crew-row-fest')).toHaveCount(1);
    await expect(page.locator('#crew-grid .crew-row-rsvp')).toHaveCount(0);
  });

  test('quick RSVP can mark you Interested, and Going then clears it', async ({ page }) => {
    const data = seedData();
    data.raver_festivals = data.raver_festivals.filter(r => r.raver_id !== 'r-you');
    await bootAuthedApp(page, { data });
    const interest = page.locator('#crew-grid .crew-card.is-open .crew-row-rsvp.is-interest');
    await expect(interest).toHaveAttribute('aria-pressed', 'false');
    await interest.click();
    await expect(interest).toHaveAttribute('aria-pressed', 'true');
    const interested = () => page.evaluate(() =>
      (window.__store.raver_festival_interest || []).some(r => r.raver_id === 'r-you' && r.festival_id === 'f1'));
    expect(await interested()).toBe(true);

    await page.locator('#crew-grid .crew-card.is-open .crew-row-rsvp:not(.is-interest)').click();
    await expect(page.locator('#crew-grid .crew-row-rsvp')).toHaveCount(0);
    expect(await interested()).toBe(false);
  });

  test('"+ New crew" sits beside the search bar and opens the create modal', async ({ page }) => {
    await bootAuthedApp(page);
    const btn = page.locator('.crew-search-row .crew-add-card');
    await expect(btn).toHaveText(/New crew/);
    await expect(page.locator('#crew-grid .crew-add-card')).toHaveCount(0);
    const [s, b] = await Promise.all([
      page.locator('.crew-search-row .crew-search-wrap').boundingBox(),
      btn.boundingBox(),
    ]);
    expect(Math.abs((s.y + s.height / 2) - (b.y + b.height / 2))).toBeLessThan(4);
    expect(b.x).toBeGreaterThan(s.x + s.width - 1);
  });

  test('collapsed avatar stack hides on small phones', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootAuthedApp(page, { data: seedTwoCrews() });
    await expect(page.locator('#crew-grid .crew-card[data-crew-id="c2"] .crew-row-avs')).toBeHidden();
  });
});
