const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// One Add ravers sheet for every way in (Ravers tab, crew page, rave), with
// Quick add / Full profile modes, "Add to" crew + rave chips, duplicate
// matching, and the invite Link / QR inline on each new saved spot. Inviting
// stays a Recruiting-stage action: a Secret crew holds invites (nothing is
// sent or notified while you're Secret) and a Locked In crew can't be added to.

const sheet = page => page.locator('#crew-setup-content');
const addedRow = (page, name) => sheet(page).locator('#add-ravers-added .add-ravers-row', { hasText: name });

async function typeAndReturn(page, name) {
  const input = page.locator('#add-ravers-input');
  await input.fill(name);
  await input.press('Enter');
}

function withC1Status(status) {
  const data = seedData();
  data.crews[0].status = status;
  return data;
}

test.describe('Add ravers sheet · Ravers tab', () => {
  test('+ Add Raver opens the sheet; a new spot dropped in a Recruiting crew gets Link + QR inline', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => switchTab('members'));
    await page.getByRole('button', { name: '+ Add Raver' }).click();

    await expect(page.locator('#crew-setup-overlay')).toHaveClass(/open/);
    await expect(sheet(page).locator('.modal-title')).toHaveText('Add ravers');
    await sheet(page).getByRole('button', { name: 'Bass Syndicate' }).click();
    await typeAndReturn(page, 'Newbie One');

    const row = addedRow(page, 'Newbie One');
    await expect(row.getByRole('button', { name: 'Link' })).toBeVisible();
    expect(await page.evaluate(() => getCrew('c1').squadIds.length)).toBe(4);
    await expect(page.locator('#members-grid')).toContainText('Newbie One');

    await row.getByRole('button', { name: /QR/ }).click();
    await expect(page.locator('#qr-overlay')).toHaveClass(/open/);
    expect(errors).toEqual([]);
  });

  test('Link shares the claim URL through the native share sheet, then reads Sent', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => {
      window.__shared = [];
      navigator.share = (payload) => { window.__shared.push(payload); return Promise.resolve(); };
      openAddRaversSheet();
    });
    await typeAndReturn(page, 'Newbie Two');

    // In no crew at all: still invitable (no crew status to respect).
    await addedRow(page, 'Newbie Two').getByRole('button', { name: 'Link' }).click();
    await expect(addedRow(page, 'Newbie Two').getByRole('button', { name: 'Sent ✓' })).toBeVisible();
    const shared = await page.evaluate(() => window.__shared);
    expect(shared.length).toBe(1);
    expect(shared[0].url).toContain('?claim=');
    expect(errors).toEqual([]);
  });

  test('return on a name already in the fam does not create a twin; the create button still can', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => openAddRaversSheet());
    const before = await page.evaluate(() => squad.length);

    await typeAndReturn(page, 'sam p.');
    await expect(page.locator('#toast')).toContainText('already in your fam');
    expect(await page.evaluate(() => squad.length)).toBe(before);
    await expect(sheet(page).locator('#add-ravers-lists')).toContainText('Sam P.');

    await sheet(page).getByRole('button', { name: /New saved spot for/ }).click();
    expect(await page.evaluate(() => squad.length)).toBe(before + 1);
    expect(errors).toEqual([]);
  });

  test('with a rave picked, return on an existing raver links them instead of making a new spot', async ({ page }) => {
    // The "Add to" rave chips are your own upcoming RSVPs; Sam isn't going to f2 yet.
    const data = seedData();
    data.raver_festivals.push({ raver_id: 'r-you', festival_id: 'f2' });
    const errors = await bootAuthedApp(page, { data });
    await page.evaluate(() => openAddRaversSheet());
    const before = await page.evaluate(() => squad.length);

    await sheet(page).getByRole('button', { name: 'Awakenings' }).click();
    await typeAndReturn(page, 'Sam P.');

    expect(await page.evaluate(() => squad.length)).toBe(before);
    expect(await page.evaluate(() => getRaver('r-sam').festIds.map(String))).toContain('f2');
    await expect(addedRow(page, 'Sam P.')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('openProfileEditor() for someone new opens Full profile; Add & next keeps the sheet open', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => openProfileEditor());

    await expect(page.locator('#crew-setup-overlay')).toHaveClass(/open/);
    await expect(page.locator('#profile-edit-overlay')).not.toHaveClass(/open/);
    await expect(sheet(page).getByRole('tab', { name: 'Full profile' })).toHaveAttribute('aria-selected', 'true');

    await page.locator('#ar-name').fill('Sam');
    await expect(sheet(page).locator('#ar-dupe')).toContainText('Sam P. is already in your fam');
    await page.locator('#ar-name').fill('Fiona Full');
    await page.locator('#ar-instagram').fill('@fifull');
    await sheet(page).getByRole('button', { name: 'Add & next' }).click();

    await expect(addedRow(page, 'Fiona Full')).toBeVisible();
    await expect(page.locator('#ar-name')).toHaveValue('');
    // The row renders before the save settles, so wait for the stored value instead of reading it once.
    await expect.poll(() => page.evaluate(() => squad.find(r => r.name === 'Fiona Full')?.instagram)).toBe('@fifull');
    expect(errors).toEqual([]);
  });
});

test.describe('Add ravers sheet · crew status', () => {
  test('a Recruiting crew: Scan + Crew link tiles, and the new spot gets its invite inline', async ({ page }) => {
    const errors = await bootAuthedApp(page); // c1 seeds as 'recruiting'
    await page.evaluate(() => openAddRaversSheet('c1'));

    await expect(sheet(page).locator('.modal-title')).toHaveText('Add to Bass Syndicate');
    await expect(sheet(page).getByRole('button', { name: 'Scan' })).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: 'Crew link' })).toBeVisible();
    await typeAndReturn(page, 'Recruit Rita');
    await expect(addedRow(page, 'Recruit Rita').getByRole('button', { name: 'Link' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a Secret crew is type-only and holds the invite', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: withC1Status('secret') });
    await page.evaluate(() => openAddRaversSheet('c1'));

    await expect(sheet(page)).toContainText('Secret · only you can see it');
    await expect(sheet(page).locator('.add-ravers-tiles')).toHaveCount(0);
    await typeAndReturn(page, 'Secret Sally');
    await expect(addedRow(page, 'Secret Sally')).toContainText('Invite held');
    await expect(addedRow(page, 'Secret Sally').getByRole('button', { name: 'Link' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a Locked In crew does not open the sheet', async ({ page }) => {
    const errors = await bootAuthedApp(page, { data: withC1Status('locked-in') });
    await page.evaluate(() => openAddRaversSheet('c1'));
    await expect(page.locator('#crew-setup-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#toast')).toContainText('Locked In');
    expect(errors).toEqual([]);
  });

  test('a full crew turns the raver away with a toast', async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => {
      const c = getCrew('c1');
      while (c.squadIds.length < CREW_MEMBER_LIMIT) c.squadIds.push('ghost-' + c.squadIds.length);
      openAddRaversSheet('c1');
    });
    await typeAndReturn(page, 'One Too Many');
    await expect(page.locator('#toast')).toContainText('is full');
    expect(await page.evaluate(() => getCrew('c1').squadIds.length)).toBe(await page.evaluate(() => CREW_MEMBER_LIMIT));
    expect(errors).toEqual([]);
  });

  test('raverInviteIsLive: a crewless raver is still invitable', async ({ page }) => {
    await bootAuthedApp(page);
    const [inRecruiting, crewless] = await page.evaluate(() => [
      raverInviteIsLive('r-sam'),
      raverInviteIsLive('r-nobody'),
    ]);
    expect(inRecruiting).toBe(true);
    expect(crewless).toBe(true);
  });

  test('raverInviteIsLive is true when any one of several crews is Recruiting', async ({ page }) => {
    const data = withC1Status('secret');
    data.crews.push({
      id: 'c2', name: 'Second Crew', color: '#00F5FF',
      gradient: 'linear-gradient(90deg,#00F5FF,#0066FF)', status: 'recruiting',
      leader_id: data.crews[0].leader_id, totem_photo_url: null, totem_icon: null,
      invite_token: 'inv-c2', created_at: data.crews[0].created_at, deleted_at: null,
    });
    data.crew_members.push({
      crew_id: 'c2', raver_id: 'r-sam',
      added_at: data.crews[0].created_at, added_by: data.crews[0].leader_id, deleted_at: null,
    });
    await bootAuthedApp(page, { data });

    // r-sam is in a secret crew AND a recruiting one — the live invite wins.
    expect(await page.evaluate(() => raverInviteIsLive('r-sam'))).toBe(true);
    // r-kai is only in the secret crew.
    expect(await page.evaluate(() => raverInviteIsLive('r-kai'))).toBe(false);
  });
});

test.describe('Add ravers sheet · from a rave', () => {
  test("a rave's add-new opens the sheet with that rave locked in, and Done lands back on the rave", async ({ page }) => {
    const errors = await bootAuthedApp(page);
    await page.evaluate(() => { openRaveFocus('f2'); _reSearchQuery = 'Rosa'; reAddNew(); });

    await expect(page.locator('#rave-focus-overlay')).not.toHaveClass(/open/);
    await expect(sheet(page).locator('.modal-title')).toHaveText('Who’s going?');
    await expect(sheet(page).locator('.add-ravers-tiles')).toHaveCount(0);
    await expect(page.locator('#add-ravers-input')).toHaveValue('Rosa');

    await page.locator('#add-ravers-input').press('Enter');
    expect(await page.evaluate(() => squad.find(r => r.name === 'Rosa')?.festIds.map(String))).toContain('f2');

    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('#crew-setup-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#rave-focus-overlay')).toHaveClass(/open/);
    expect(errors).toEqual([]);
  });
});
