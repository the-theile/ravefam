const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// A Secret crew is a private workspace — the onboarding copy promises "nothing
// is sent or notified while you're Secret" — so adding someone to one must not
// push an invite at the leader. Locked In is the same story from the other end:
// the roster is closed. Only a Recruiting crew should surface the invite prompt.

/** Add a raver via the profile editor, then drop them into `crewId`. */
async function addRaverToCrew(page, name, crewId) {
  await page.evaluate(() => openProfileEditor());
  await page.locator('#pf-name').fill(name);
  await page.evaluate(() => saveProfile());
  await expect(page.locator('#crew-pick-overlay')).toHaveClass(/open/);
  await page.locator(`.crew-pick-item`).first().click();
  await page.locator('#crew-pick-modal').getByRole('button', { name: /Let's go/ }).click();
  return crewId;
}

test.describe('invite prompt · crew status gating', () => {
  test('a Recruiting crew still offers the invite prompt', async ({ page }) => {
    const errors = await bootAuthedApp(page); // c1 seeds as 'recruiting'
    await addRaverToCrew(page, 'Recruit Rita', 'c1');

    await expect(page.locator('#invite-prompt-overlay')).toHaveClass(/open/);
    await expect(page.locator('#invite-prompt-modal')).toContainText('Invite Recruit now?');
    expect(errors).toEqual([]);
  });

  test('a Secret crew does not prompt to invite, and says why', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'secret';
    const errors = await bootAuthedApp(page, { data });

    await addRaverToCrew(page, 'Secret Sally', 'c1');

    await expect(page.locator('#invite-prompt-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#toast')).toContainText('open the crew to Recruiting');
    expect(errors).toEqual([]);
  });

  test('a Locked In crew does not prompt to invite either', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'locked-in';
    const errors = await bootAuthedApp(page, { data });

    await addRaverToCrew(page, 'Locked Lou', 'c1');

    await expect(page.locator('#invite-prompt-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#toast')).toContainText('locked in');
    expect(errors).toEqual([]);
  });

  test('raverInviteIsLive: a crewless raver is still invitable', async ({ page }) => {
    await bootAuthedApp(page);
    // r-sam is in c1 (recruiting); a raver in no crew has no status to respect.
    const [inRecruiting, crewless] = await page.evaluate(() => [
      raverInviteIsLive('r-sam'),
      raverInviteIsLive('r-nobody'),
    ]);
    expect(inRecruiting).toBe(true);
    expect(crewless).toBe(true);
  });

  test('raverInviteIsLive is true when any one of several crews is Recruiting', async ({ page }) => {
    const data = seedData();
    data.crews[0].status = 'secret';
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
