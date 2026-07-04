const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

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
