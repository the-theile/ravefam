const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// Open the Bass Syndicate (c1) detail page and wait for its async loads.
async function openC1(page) {
  await page.evaluate(async () => { await openDetail('c1'); });
  await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
}

test.describe('crew detail · dream board', () => {
  test('pinning a dream shows it and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);

    await page.evaluate(async () => {
      document.getElementById('dream-pin-input').value = 'Sunrise set at the main stage';
      await addDreamPin('c1');
    });

    await expect(page.locator('#dream-board-section')).toContainText('Sunrise set at the main stage');
    const stored = await page.evaluate(() =>
      (window.__store.dream_board_pins || []).some(p => p.label === 'Sunrise set at the main stage' && p.crew_id === 'c1'));
    expect(stored).toBe(true);
  });
});

test.describe('crew detail · archive links', () => {
  test('adding a valid link shows it and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);

    await page.evaluate(async () => {
      document.getElementById('archive-url-input').value = 'https://photos.example.com/album';
      document.getElementById('archive-label-input').value = 'Afters dump';
      await addArchiveLink('c1');
    });

    await expect(page.locator('#archive-section')).toContainText('Afters dump');
    const stored = await page.evaluate(() =>
      (window.__store.crew_archive_links || []).some(l => l.url === 'https://photos.example.com/album'));
    expect(stored).toBe(true);
  });

  test('a non-http link is rejected (not persisted)', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);
    await page.evaluate(async () => {
      document.getElementById('archive-url-input').value = 'ftp://nope';
      await addArchiveLink('c1');
    });
    const count = await page.evaluate(() => (window.__store.crew_archive_links || []).length);
    expect(count).toBe(0);
  });
});

test.describe('crew detail · polls', () => {
  test('creating a poll then voting both persist', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);

    const pollId = await page.evaluate(async () => {
      const poll = await dbCreatePoll('c1', {
        question: 'Pre-game spot?', pollType: 'multiple_choice',
        options: ['Bar', 'Hotel'], isAnonymous: false, expiresAt: null,
      });
      await dbLoadPolls('c1'); rerenderPolls('c1');
      return poll.id;
    });

    await expect(page.locator('#fam-poll-section')).toContainText('Pre-game spot?');
    expect(await page.evaluate(() => (window.__store.crew_polls || []).length)).toBe(1);

    await page.evaluate(async (id) => { await dbVotePoll(id, 'Bar'); }, pollId);
    const votes = await page.evaluate((id) =>
      (window.__store.crew_poll_votes || []).filter(v => v.poll_id === id).length, pollId);
    expect(votes).toBe(1);
  });

  test('deleting a poll removes it', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);
    const pollId = await page.evaluate(async () => {
      const poll = await dbCreatePoll('c1', { question: 'Doomed poll', pollType: 'yes_no', options: null, isAnonymous: true, expiresAt: null });
      return poll.id;
    });
    await page.evaluate(async (id) => { await dbDeletePoll(id); }, pollId);
    // Polls are soft-deleted (deleted_at set), not removed from the store —
    // matches dbDeleteFestival/dbRemoveCrewMember in soft_delete.spec.js.
    const poll = await page.evaluate((id) => window.__store.crew_polls.find(p => p.id === id), pollId);
    expect(poll).toBeTruthy();
    expect(poll.deleted_at).toBeTruthy();
  });
});

test.describe('crew detail · jams', () => {
  test('adding a playlist shows it and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);

    await page.evaluate(async () => {
      await dbAddJam('c1', {
        url: 'https://open.spotify.com/playlist/123', platform: 'spotify',
        title: 'Warehouse Warmup', coverUrl: null, trackCount: 12,
        tag: 'warmup', description: 'pre-game heat', festivalId: null,
      });
      await dbLoadJams('c1'); rerenderJams('c1');
    });

    await expect(page.locator('#jam-section')).toContainText('Warehouse Warmup');
    const stored = await page.evaluate(() =>
      (window.__store.crew_jams || []).some(j => j.title === 'Warehouse Warmup'));
    expect(stored).toBe(true);
  });
});

// Default seedData() already has r-you and r-sam (both members of c1) RSVP'd
// to f1 — that's exactly the shared-attendance rule deriveCrewFestivalRooms
// uses, so c1 qualifies for a Game Plan on f1 without any extra seeding.
test.describe('crew detail · game plan', () => {
  async function openGamePlan(page) {
    await page.evaluate(async () => { await openDetail('c1', { tab: 'gameplan' }); });
    await expect(page.locator('#crew-detail-panel-gameplan')).toBeVisible();
  }

  test('the Game Plan tab is offered for a shared upcoming rave', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page);
    await expect(page.locator('#page-crew-detail .stats-subtab[data-tab="gameplan"]')).toContainText('Game Plan');
  });

  test('the Game Plan tab is NOT offered when no rave has shared attendance', async ({ page }) => {
    // Same deriveCrewFestivalRooms rule the per-rave Huddle room used to gate
    // on — strip r-sam's RSVP so only "you" is going to f1, no overlap.
    const data = seedData();
    data.raver_festivals = data.raver_festivals.filter(rf => rf.raver_id !== 'r-sam');
    await bootAuthedApp(page, { data });
    await openC1(page);
    await expect(page.locator('#page-crew-detail .stats-subtab[data-tab="gameplan"]')).toHaveCount(0);
  });

  test('adding a checklist task shows it, persists, and can be toggled done', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('checklist', document.querySelector('.game-plan-section-tab[data-section="checklist"]')));

    await page.evaluate(async () => {
      document.getElementById('game-plan-task-input').value = 'Buy tickets';
      await addGamePlanTask('c1');
    });
    await expect(page.locator('#game-plan-section-checklist')).toContainText('Buy tickets');
    const task = await page.evaluate(() => (window.__store.game_plan_items || []).find(it => it.kind === 'task' && it.text === 'Buy tickets'));
    expect(task).toBeTruthy();
    expect(task.is_done).toBe(false);

    await page.evaluate(async (id) => { await toggleGamePlanTask(id, true); }, task.id);
    const updated = await page.evaluate((id) => window.__store.game_plan_items.find(it => it.id === id), task.id);
    expect(updated.is_done).toBe(true);
  });

  test('a role can be shared by multiple people, and one person can hold multiple roles', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('roles', document.querySelector('.game-plan-section-tab[data-section="roles"]')));

    const gpId = await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      await dbAddGamePlanRole(gp.id, 'c1', 'Driver / DD', 'r-you');
      await dbAddGamePlanRole(gp.id, 'c1', 'Driver / DD', 'r-sam'); // same role, second holder
      await dbAddGamePlanRole(gp.id, 'c1', 'Navigator', 'r-you');   // second role, same holder
      return gp.id;
    });
    const roles = await page.evaluate(() => (window.__store.game_plan_items || []).filter(it => it.kind === 'role'));
    expect(roles.length).toBe(3);
    expect(roles.filter(r => r.role_name === 'Driver / DD').length).toBe(2);
    expect(roles.filter(r => r.assignee_raver_id === 'r-you').length).toBe(2);
    expect(gpId).toBeTruthy();
  });

  test('a carpool driver can be joined by a rider', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);

    const { driverId } = await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      const driver = await dbAddCarpoolDriver(gp.id, 'c1', 'r-you', 3);
      await dbAddCarpoolRider(gp.id, 'c1', driver.id, 'r-sam');
      return { driverId: driver.id };
    });
    const rider = await page.evaluate((did) =>
      (window.__store.game_plan_items || []).find(it => it.kind === 'carpool_rider' && it.driver_item_id === did),
      driverId);
    expect(rider).toBeTruthy();
    expect(rider.assignee_raver_id).toBe('r-sam');
  });

  test('deleting a carpool driver also removes their riders', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);

    const driverId = await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      const driver = await dbAddCarpoolDriver(gp.id, 'c1', 'r-you', 3);
      await dbAddCarpoolRider(gp.id, 'c1', driver.id, 'r-sam');
      return driver.id;
    });
    await page.evaluate(async (did) => { await dbDeleteGamePlanItem(did, 'c1'); }, driverId);

    const driverRow = await page.evaluate((did) => window.__store.game_plan_items.find(it => it.id === did), driverId);
    expect(driverRow.deleted_at).toBeTruthy();
    const riderRow = await page.evaluate((did) =>
      window.__store.game_plan_items.find(it => it.kind === 'carpool_rider' && it.driver_item_id === did),
      driverId);
    expect(riderRow.deleted_at).toBeTruthy();
  });

  test('saving the meetup time and location persists on the game plan header', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);

    await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      await dbUpdateGamePlanHeader(gp.id, { meetupLocation: 'Front gate' });
    });
    const stored = await page.evaluate(() => (window.__store.game_plans || []).find(g => g.crew_id === 'c1' && g.festival_id === 'f1'));
    expect(stored.meetup_location).toBe('Front gate');
  });

  test('adding an outfit idea with a link shows it and persists', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('outfit', document.querySelector('.game-plan-section-tab[data-section="outfit"]')));

    await page.evaluate(async () => {
      document.getElementById('game-plan-outfit-text').value = 'Neon jungle fit';
      document.getElementById('game-plan-outfit-link').value = 'https://pinterest.com/board/1';
      await addGamePlanOutfitIdea('c1');
    });
    await expect(page.locator('#game-plan-section-outfit')).toContainText('Neon jungle fit');
    const idea = await page.evaluate(() => (window.__store.game_plan_items || []).find(it => it.kind === 'outfit'));
    expect(idea.link_url).toBe('https://pinterest.com/board/1');
  });
});
