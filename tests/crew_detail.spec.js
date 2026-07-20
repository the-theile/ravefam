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

  test('claiming an unclaimed task assigns it to the claimer', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('checklist', document.querySelector('.game-plan-section-tab[data-section="checklist"]')));

    const taskId = await page.evaluate(async () => {
      document.getElementById('game-plan-task-input').value = 'Pack the tent';
      await addGamePlanTask('c1');
      return (window.__store.game_plan_items || []).find(it => it.kind === 'task' && it.text === 'Pack the tent').id;
    });
    await expect(page.locator('#game-plan-section-checklist')).toContainText('I got this');

    await page.evaluate(async (id) => { await claimGamePlanTask(id); }, taskId);
    const claimed = await page.evaluate((id) => window.__store.game_plan_items.find(it => it.id === id), taskId);
    expect(claimed.assignee_raver_id).toBe('r-you');
    await expect(page.locator('#game-plan-section-checklist')).toContainText('assigned to Theile');
  });

  test('any crew member can delete a task added by someone else, no reason required', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('checklist', document.querySelector('.game-plan-section-tab[data-section="checklist"]')));

    const taskId = await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      // Simulate a task added by a different crew member than the signed-in test user.
      const { data } = await sb.from('game_plan_items').insert({
        game_plan_id: gp.id, crew_id: 'c1', kind: 'task', added_by: 'kai-uid', text: "Someone else's task", is_done: false
      }).select().single();
      gamePlanItems.push(data);
      rerenderGamePlanChecklist('c1');
      return data.id;
    });
    // Delete button shows even though this task wasn't added by the current user.
    await expect(page.locator(`#game-plan-item-${taskId} .archive-link-del`)).toBeVisible();

    const ok = await page.evaluate(async (id) => dbDeleteGamePlanItem(id, 'c1', null), taskId);
    expect(ok).toBe(true);
    const row = await page.evaluate((id) => window.__store.game_plan_items.find(it => it.id === id), taskId);
    expect(row.deleted_at).toBeTruthy();
  });

  test('the cast card shows a claimed role once assigned', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('roles', document.querySelector('.game-plan-section-tab[data-section="roles"]')));

    await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      await dbAddGamePlanRole(gp.id, 'c1', 'Hype Person', 'r-you');
      rerenderGamePlanRoles('c1');
    });
    await expect(page.locator('.game-plan-cast-wrap')).toContainText('The Cast');
    await expect(page.locator('.game-plan-cast-wrap')).toContainText('Hype Person');
  });

  test('claiming a role posts an activity message into the festival Huddle', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('roles', document.querySelector('.game-plan-section-tab[data-section="roles"]')));

    await page.evaluate(async () => {
      document.getElementById('game-plan-role-custom').value = 'Vibe Curator';
      document.getElementById('game-plan-role-assignee').value = 'r-you';
      await addGamePlanRole('c1');
    });
    await page.waitForTimeout(50);
    const systemMsg = await page.evaluate(() =>
      (window.__store.huddle_messages || []).find(m => m.kind === 'system' && (m.body || '').includes('Vibe Curator')));
    expect(systemMsg).toBeTruthy();
    expect(systemMsg.body).toContain('Theile');
  });

  test('adding an outfit idea with a photo persists the image url', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('outfit', document.querySelector('.game-plan-section-tab[data-section="outfit"]')));

    // Stub the upload pipeline (same technique vendor_village.spec.js uses) —
    // compressImageToBlob needs a real decodable image and the offline
    // storage stub always returns an empty publicUrl, neither of which is
    // what this test cares about (that a picked file reaches the item row).
    await page.evaluate(() => { window.uploadPhotoToStorage = async () => 'https://example.com/fit.jpg'; });
    await page.locator('#game-plan-outfit-image-input').setInputFiles({ name: 'fit.png', mimeType: 'image/png', buffer: Buffer.from('fake') });
    await page.evaluate(async () => {
      document.getElementById('game-plan-outfit-text').value = 'Rave fit check';
      await addGamePlanOutfitIdea('c1');
    });
    await page.waitForTimeout(50);
    const idea = await page.evaluate(() =>
      (window.__store.game_plan_items || []).find(it => it.kind === 'outfit' && it.text === 'Rave fit check'));
    expect(idea.image_url).toBe('https://example.com/fit.jpg');
  });

  test('reacting to an outfit idea toggles the reaction on and off', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    const ideaId = await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      const idea = await dbAddOutfitIdea(gp.id, 'c1', 'Y2K rave fit', null);
      return idea.id;
    });

    await page.evaluate(async (id) => { await toggleGamePlanOutfitReaction(id, '🔥'); }, ideaId);
    let idea = await page.evaluate((id) => window.__store.game_plan_items.find(it => it.id === id), ideaId);
    expect(idea.reactions['🔥']).toEqual(['test-user-id']);

    await page.evaluate(async (id) => { await toggleGamePlanOutfitReaction(id, '🔥'); }, ideaId);
    idea = await page.evaluate((id) => window.__store.game_plan_items.find(it => it.id === id), ideaId);
    expect(idea.reactions['🔥']).toBeUndefined();
  });

  test('pinning a huddle message unpins whatever was previously pinned in that room', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page); // default section is huddle, which materializes the festival room

    const { m1, m2 } = await page.evaluate(async () => {
      const room = huddleRooms[0];
      const a = await sb.from('huddle_messages').insert({ room_id: room.id, crew_id: 'c1', sender_id: 'test-user-id', kind: 'text', body: 'first' }).select().single();
      const b = await sb.from('huddle_messages').insert({ room_id: room.id, crew_id: 'c1', sender_id: 'test-user-id', kind: 'text', body: 'second' }).select().single();
      huddleMessages.push(a.data, b.data);
      return { m1: a.data.id, m2: b.data.id };
    });

    await page.evaluate(async (id) => { await togglePinHuddleMessage(id, false); }, m1);
    await page.evaluate(async (id) => { await togglePinHuddleMessage(id, false); }, m2);

    const pinned = await page.evaluate(() => window.__store.huddle_messages.filter(m => m.pinned_at));
    expect(pinned.length).toBe(1);
    expect(pinned[0].id).toBe(m2);
  });

  test('a lodging host can be joined by a guest, and shows spaces left', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('stay', document.querySelector('.game-plan-section-tab[data-section="stay"]')));

    const { hostId } = await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      const host = await dbAddLodgingHost(gp.id, 'c1', 'r-you', 2, 'Sunset Airbnb', 'https://airbnb.com/rooms/1');
      await dbAddLodgingGuest(gp.id, 'c1', host.id, 'r-sam');
      rerenderGamePlanStay('c1');
      return { hostId: host.id };
    });
    await expect(page.locator('#game-plan-section-stay')).toContainText('Sunset Airbnb');
    await expect(page.locator('#game-plan-section-stay')).toContainText('1 space left');

    const guest = await page.evaluate((hid) =>
      (window.__store.game_plan_items || []).find(it => it.kind === 'lodging_guest' && it.driver_item_id === hid),
      hostId);
    expect(guest).toBeTruthy();
    expect(guest.assignee_raver_id).toBe('r-sam');
  });

  test('posting a stay with a lodging type persists it and shows it on the card', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);
    await page.evaluate(async () => switchGamePlanSection('stay', document.querySelector('.game-plan-section-tab[data-section="stay"]')));

    await page.evaluate(async () => {
      document.getElementById('game-plan-stay-place').value = 'Campground row B';
      document.getElementById('game-plan-stay-type').value = 'rv';
      await addLodgingHost('c1');
    });
    await expect(page.locator('#game-plan-section-stay')).toContainText('an rv');
    const host = await page.evaluate(() =>
      (window.__store.game_plan_items || []).find(it => it.kind === 'lodging_host' && it.text === 'Campground row B'));
    expect(host.lodging_type).toBe('rv');
  });

  test('deleting a lodging host also removes their guests', async ({ page }) => {
    await bootAuthedApp(page);
    await openGamePlan(page);

    const hostId = await page.evaluate(async () => {
      const gp = await dbGetOrCreateGamePlan('c1', 'f1');
      const host = await dbAddLodgingHost(gp.id, 'c1', 'r-you', 2, 'Sunset Airbnb', null);
      await dbAddLodgingGuest(gp.id, 'c1', host.id, 'r-sam');
      return host.id;
    });
    await page.evaluate(async (id) => { await dbDeleteGamePlanItem(id, 'c1'); }, hostId);

    const hostRow = await page.evaluate((id) => window.__store.game_plan_items.find(it => it.id === id), hostId);
    expect(hostRow.deleted_at).toBeTruthy();
    const guestRow = await page.evaluate((id) =>
      window.__store.game_plan_items.find(it => it.kind === 'lodging_guest' && it.driver_item_id === id),
      hostId);
    expect(guestRow.deleted_at).toBeTruthy();
  });
});

test.describe('crew-wide activity feed (main Huddle)', () => {
  test('postCrewActivity posts a system message into the main Huddle room', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(async () => { await postCrewActivity('c1', '🎉 Test crew event'); });

    const room = await page.evaluate(() =>
      (window.__store.huddle_rooms || []).find(r => r.crew_id === 'c1' && r.room_key === 'main'));
    expect(room).toBeTruthy();
    const msg = await page.evaluate((roomId) =>
      (window.__store.huddle_messages || []).find(m => m.room_id === roomId && m.kind === 'system' && m.body === '🎉 Test crew event'),
      room.id);
    expect(msg).toBeTruthy();
  });

  test('RSVPing to a new festival posts an activity message into each shared crew\'s main Huddle', async ({ page }) => {
    await bootAuthedApp(page); // c1 (status: recruiting) already has r-you as a member
    await page.evaluate(async () => { await toggleGoingToFest('f2'); });
    await page.waitForTimeout(50);

    const room = await page.evaluate(() =>
      (window.__store.huddle_rooms || []).find(r => r.crew_id === 'c1' && r.room_key === 'main'));
    expect(room).toBeTruthy();
    const msg = await page.evaluate((roomId) =>
      (window.__store.huddle_messages || []).find(m => m.room_id === roomId && m.kind === 'system' && (m.body || '').includes('Awakenings')),
      room.id);
    expect(msg).toBeTruthy();
    expect(msg.body).toContain('Theile');
  });
});
