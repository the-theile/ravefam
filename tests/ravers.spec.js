const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

async function refetch(page, expr) {
  return page.evaluate(async (src) => { await loadAllData(); return eval(src); }, expr);
}

test.describe('ravers / profile', () => {
  test('opening a raver shows their profile details', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openProfile('r-sam'));
    const profile = page.locator('#page-profile');
    await expect(profile).toHaveClass(/active/);
    await expect(profile).toContainText('Sam P.');
    await expect(profile).toContainText('London');
  });

  test('editing your profile base via the form persists', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => {
      enterProfileEditMode('r-you');
      document.getElementById('pf-base').value = 'Lisbon, PT';
      saveProfile();
    });
    const base = await refetch(page, "squad.find(r=>r.isYou).base");
    expect(base).toBe('Lisbon, PT');
  });

  test('adding a vibe tag in edit mode persists', async ({ page }) => {
    await bootAuthedApp(page);
    const added = await page.evaluate(() => {
      enterProfileEditMode('r-you');
      const preset = VIBE_PRESETS.find(p => !editingVibeTags.has(p.id));
      toggleVibePick(preset.id, document.createElement('span'));
      saveProfile();
      return preset.id;
    });
    const tags = await refetch(page, "squad.find(r=>r.isYou).vibeTags");
    expect(tags).toContain(added);
  });

  test('adding a genre in edit mode persists', async ({ page }) => {
    await bootAuthedApp(page);
    const added = await page.evaluate(() => {
      enterProfileEditMode('r-you');
      const presets = allGenrePresets().filter(g => !editingGenres.has(g));
      const g = presets[0];
      toggleGenrePick(g, document.createElement('span'));
      saveProfile();
      return g;
    });
    const genres = await refetch(page, "squad.find(r=>r.isYou).genres");
    expect(genres).toContain(added);
  });

  test('opening the vibe tag sheet, toggling a chip, and hitting Done persists after Save', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => enterProfileEditMode('r-you'));
    await page.click('#vibe-edit-btn');
    await expect(page.locator('#tag-sheet')).toHaveClass(/open/);
    const addedId = await page.evaluate(() => VIBE_PRESETS.find(p => p.cat === 'chaos' && !editingVibeTags.has(p.id)).id);
    await page.click(`#tag-sheet-accordions .vibe-preset[onclick*="${addedId}"]`);
    await page.click('.tag-sheet-footer button:has-text("Done")');
    await expect(page.locator('#tag-sheet')).not.toHaveClass(/open/);
    await page.evaluate(() => saveProfile());
    const tags = await refetch(page, "squad.find(r=>r.isYou).vibeTags");
    expect(tags).toContain(addedId);
  });

  test('cancelling the vibe tag sheet does not persist an in-sheet toggle', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => enterProfileEditMode('r-you'));
    await page.click('#vibe-edit-btn');
    const skippedId = await page.evaluate(() => VIBE_PRESETS.find(p => p.cat === 'chaos' && !editingVibeTags.has(p.id)).id);
    await page.click(`#tag-sheet-accordions .vibe-preset[onclick*="${skippedId}"]`);
    await page.click('.tag-sheet-footer button:has-text("Cancel")');
    const stillUnpicked = await page.evaluate((id) => !editingVibeTags.has(id), skippedId);
    expect(stillUnpicked).toBe(true);
    await page.evaluate(() => saveProfile());
    const tags = await refetch(page, "squad.find(r=>r.isYou).vibeTags");
    expect(tags).not.toContain(skippedId);
  });

  test('opening the genre sheet, toggling a chip, and hitting Done persists after Save', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => enterProfileEditMode('r-you'));
    await page.click('#genre-edit-btn');
    await expect(page.locator('#tag-sheet')).toHaveClass(/open/);
    const added = await page.evaluate(() => allGenrePresets().find(g => genreCategory(g) === 'house' && !editingGenres.has(g)));
    await page.click(`#tag-sheet-accordions .genre-preset[onclick*="${added.replace(/'/g, "\\'")}"]`);
    await page.click('.tag-sheet-footer button:has-text("Done")');
    await page.evaluate(() => saveProfile());
    const genres = await refetch(page, "squad.find(r=>r.isYou).genres");
    expect(genres).toContain(added);
  });

  test('cancelling the genre sheet does not persist an in-sheet toggle', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => enterProfileEditMode('r-you'));
    await page.click('#genre-edit-btn');
    const skipped = await page.evaluate(() => allGenrePresets().find(g => genreCategory(g) === 'house' && !editingGenres.has(g)));
    await page.click(`#tag-sheet-accordions .genre-preset[onclick*="${skipped.replace(/'/g, "\\'")}"]`);
    await page.click('.tag-sheet-footer button:has-text("Cancel")');
    await page.evaluate(() => saveProfile());
    const genres = await refetch(page, "squad.find(r=>r.isYou).genres");
    expect(genres).not.toContain(skipped);
  });

  test('creator still sees a crew-less raver after their invite is merged into an existing account', async ({ page }) => {
    // Reproduces: Theile creates Jose without adding him to a crew, sends Jose
    // an invite link, Jose (already signed up elsewhere) redeems it — the
    // client merges the stub into Jose's own raver and marks the stub
    // 'merged'. With no crew link ever created, Theile's only tie to Jose was
    // that merged stub, so Jose must still surface via merged_into.
    const data = seedData();
    data.ravers.push({
      id: 'r-jose', name: 'Jose', handle: 'jose',
      is_you: false, created_by: 'jose-uid', claimed_by: 'jose-uid', status: 'claimed',
      base: 'Madrid, ES', gradient: 'linear-gradient(135deg,#FF2D78,#BF00FF)',
      avatar_url: null, blocked_tags: [], genres: [],
      instagram: '', radiate: '', phone: '', phone_visible: false,
      met_story: '', notes: '', qr_token: 'qr-jose',
      vibe_tags: [], custom_vibe_tags: [], deleted_at: null,
    });
    data.ravers.push({
      id: 'r-jose-stub', name: 'Jose', handle: '',
      is_you: false, created_by: TEST_UID, claimed_by: null, status: 'merged', merged_into: 'r-jose',
      base: '', gradient: 'linear-gradient(135deg,#FF2D78,#BF00FF)',
      avatar_url: null, blocked_tags: [], genres: [],
      instagram: '', radiate: '', phone: '', phone_visible: false,
      met_story: '', notes: '', qr_token: 'qr-jose-stub',
      vibe_tags: [], custom_vibe_tags: [], deleted_at: null,
    });
    await bootAuthedApp(page, { data });

    const jose = await refetch(page, "squad.find(r => r.id === 'r-jose')");
    expect(jose).toBeTruthy();
    expect(jose.name).toBe('Jose');

    const stubStillShown = await refetch(page, "squad.some(r => r.id === 'r-jose-stub')");
    expect(stubStillShown).toBe(false);
  });

  test('raver search filters the grid', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('members'));

    await page.fill('#raver-search', 'Sam');
    await page.evaluate(() => renderSquad());
    await expect(page.locator('#members-grid')).toContainText('Sam P.');

    await page.fill('#raver-search', 'zzz-nobody');
    await page.evaluate(() => renderSquad());
    await expect(page.locator('#members-grid')).not.toContainText('Sam P.');
  });
});
