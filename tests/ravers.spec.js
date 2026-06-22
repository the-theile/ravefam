const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

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
