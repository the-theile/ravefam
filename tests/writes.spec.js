const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

// These tests prove the Supabase stub is STATEFUL: a write mutates the store,
// and a fresh loadAllData() (a real re-fetch) reflects the change. That makes
// create/edit/RSVP/membership flows genuinely testable offline.

// Re-fetch from the fake DB and read derived client state.
async function refetch(page, fn) {
  return page.evaluate(async (src) => {
    await loadAllData();
    // eslint-disable-next-line no-new-func
    return new Function('return (' + src + ')()')();
  }, `() => { ${fn} }`);
}

test.describe('stateful writes round-trip via loadAllData', () => {
  test('RSVP: marking Going adds the festival and persists', async ({ page }) => {
    await bootAuthedApp(page);

    // Precondition: you are going to f1 only.
    let going = await refetch(page, "return squad.find(r=>r.isYou).festIds.map(String)");
    expect(going).toContain('f1');
    expect(going).not.toContain('f2');

    // Act: add f2 through the app's write helper, then re-fetch.
    await page.evaluate(async () => { await dbAddRaverFestival('r-you', 'f2'); });
    going = await refetch(page, "return squad.find(r=>r.isYou).festIds.map(String)");
    expect(going).toEqual(expect.arrayContaining(['f1', 'f2']));
  });

  test('RSVP: removing Going deletes the row and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(async () => { await dbRemoveRaverFestival('r-you', 'f1'); });
    const going = await refetch(page, "return squad.find(r=>r.isYou).festIds.map(String)");
    expect(going).not.toContain('f1');
  });

  test('Create crew: new crew is inserted and shows up after re-fetch', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(() => {
      document.getElementById('crew-name-input').value = 'Night Owls';
      createCrew();
    });

    // createCrew persists asynchronously; poll until the re-fetch sees it.
    await expect
      .poll(async () => page.evaluate(async () => {
        await loadAllData();
        return crews.some(c => c.name === 'Night Owls' && c.isLead);
      }))
      .toBe(true);
  });

  test('Crew membership: remove then re-add a member persists both ways', async ({ page }) => {
    await bootAuthedApp(page);

    const ids = () => "return (crews.find(c=>String(c.id)==='c1')?.squadIds||[]).map(String)";

    let members = await refetch(page, ids());
    expect(members).toEqual(expect.arrayContaining(['r-you', 'r-sam']));

    await page.evaluate(async () => { await dbRemoveCrewMember('c1', 'r-sam'); });
    members = await refetch(page, ids());
    expect(members).toContain('r-you');
    expect(members).not.toContain('r-sam');

    await page.evaluate(async () => { await dbAddCrewMember('c1', 'r-sam'); });
    members = await refetch(page, ids());
    expect(members).toEqual(expect.arrayContaining(['r-you', 'r-sam']));
  });

  test('Edit profile: updating a field persists after re-fetch', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(async () => {
      await sb.from('ravers').update({ base: 'Lisbon, PT' }).eq('id', 'r-you');
    });
    const base = await refetch(page, "return squad.find(r=>r.isYou).base");
    expect(base).toBe('Lisbon, PT');
  });

  test('Crew status: updating status persists after re-fetch', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(async () => {
      await sb.from('crews').update({ status: 'locked-in' }).eq('id', 'c1');
    });
    const status = await refetch(page, "return crews.find(c=>String(c.id)==='c1').status");
    expect(status).toBe('locked-in');
  });

  test('upsert respects onConflict (no duplicate RSVP rows)', async ({ page }) => {
    await bootAuthedApp(page);
    // f1 already exists for r-you; adding again must not duplicate.
    await page.evaluate(async () => {
      await dbAddRaverFestival('r-you', 'f1');
      await dbAddRaverFestival('r-you', 'f1');
    });
    const count = await page.evaluate(() =>
      window.__store.raver_festivals.filter(r => r.raver_id === 'r-you' && String(r.festival_id) === 'f1').length);
    expect(count).toBe(1);
  });
});
