// Crew votes (poll_type 'pick_many', started from the Lineup Explorer) in the
// app's FAM Poll section: pick up to N sets, RSVP-gated, ⭐ Fam Faves once
// closed. See the pick_many helpers in the "===== FAM Poll =====" section.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

function voteData(poll = {}, votes = []) {
  const d = seedData();
  d.festivals[0].slug = 'tomorrowland-2099';
  d.crew_polls = [{
    id: 'p1', crew_id: 'c1', created_by: TEST_UID, question: 'Which sets are we hitting at Tomorrowland?',
    poll_type: 'pick_many', festival_id: 'f1', max_picks: 2, is_anonymous: false,
    options: [{ id: 11, n: 'Amelie Lens' }, { id: 12, n: 'Adam Beyer' }, { id: 13, n: 'Boris Brejcha' }],
    expires_at: '2099-07-18T00:00:00Z', is_locked: false, is_pinned: false, reactions: {},
    created_at: '2024-02-01T00:00:00Z', deleted_at: null, ...poll,
  }];
  d.crew_poll_votes = votes;
  return d;
}

async function openPolls(page) {
  await page.evaluate(async () => { await openDetail('c1'); await dbLoadPolls('c1'); rerenderPolls('c1'); });
  // The FAM Poll lives behind its crew feature tile.
  await page.locator(".crew-feature-tile[onclick*=\"'poll'\"]").click();
  await expect(page.locator('#crew-feature-panel-poll')).toBeVisible();
  await expect(page.locator('#fam-poll-section')).toContainText('Which sets are we hitting');
}

test('pick up to N sets, then vote', async ({ page }) => {
  const errors = await bootAuthedApp(page, { data: voteData() });
  await openPolls(page);
  const card = page.locator('#poll-card-p1');
  await expect(card.locator('.poll-type-badge')).toHaveText('Crew Vote · Pick 2');
  await expect(card.locator('.poll-lineup-link')).toHaveAttribute('href', '/lineup-explorer/tomorrowland-2099');
  const submit = card.locator('.poll-pick-submit');
  await expect(submit).toBeDisabled();

  await card.locator('.poll-pick-btn', { hasText: 'Adam Beyer' }).click();
  await page.locator('#poll-card-p1 .poll-pick-btn', { hasText: 'Amelie Lens' }).click();
  await expect(page.locator('#poll-card-p1 .poll-pick-btn', { hasText: 'Boris Brejcha' })).toBeDisabled();
  await expect(page.locator('#poll-card-p1 .poll-pick-submit')).toHaveText('Vote (2/2)');
  await page.locator('#poll-card-p1 .poll-pick-submit').click();

  await expect(page.locator('#poll-card-p1 .poll-result-row')).toHaveCount(3);
  const stored = await page.evaluate(() => window.__store.crew_poll_votes.filter(v => v.poll_id === 'p1'));
  expect(stored).toHaveLength(1);
  expect(JSON.parse(stored[0].vote_value).sort()).toEqual([11, 12]);
  await expect(page.locator('#poll-card-p1 .poll-result-row.my-vote')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('only crewmates Going or Interested can vote', async ({ page }) => {
  const d = voteData();
  d.raver_festivals = d.raver_festivals.filter(r => r.raver_id !== 'r-you');
  await bootAuthedApp(page, { data: d });
  await openPolls(page);
  const card = page.locator('#poll-card-p1');
  await expect(card.locator('.poll-pick-btn')).toHaveCount(0);
  await expect(card.locator('.poll-pick-note')).toHaveText('Only crewmates who are Going or Interested can vote.');
  await expect(card.locator('.poll-result-row')).toHaveCount(3);
});

test('a closed vote shows its Fam Faves, ties at the cut-off included', async ({ page }) => {
  const votes = [
    { id: 'v1', poll_id: 'p1', voter_user_id: TEST_UID, vote_value: '[11,12]', created_at: '2024-02-02T00:00:00Z' },
    { id: 'v2', poll_id: 'p1', voter_user_id: 'kai-uid', vote_value: '[11,13]', created_at: '2024-02-02T00:00:00Z' },
  ];
  await bootAuthedApp(page, { data: voteData({ is_locked: true }, votes) });
  await openPolls(page);
  const card = page.locator('#poll-card-p1');
  // Amelie Lens 2, Adam Beyer 1, Boris Brejcha 1: max 2 → Amelie + both tied at 1.
  await expect(card.locator('.poll-fam-faves')).toHaveText('⭐ Fam Faves: Amelie Lens, Adam Beyer, Boris Brejcha');
  await expect(card.locator('.poll-result-row').first()).toContainText('⭐ Amelie Lens');
});
