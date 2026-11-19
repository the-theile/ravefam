const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData, TEST_UID } = require('./helpers');

// A Huddle message with a link gets a preview card from the link-preview edge
// function (stubbed here); Instagram links with no title/image still get a
// branded card, and a failed lookup leaves just the plain link.

const SESSION_OVER = { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } };

function seed(bodies) {
  const data = seedData();
  data.huddle_rooms = [{ id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' }];
  data.huddle_messages = bodies.map((body, i) => ({
    id: 'm' + i, room_id: 'room-main', crew_id: 'c1', sender_id: TEST_UID, kind: 'text', body,
    reactions: {}, created_at: new Date(Date.now() - (bodies.length - i) * 60000).toISOString(),
  }));
  return data;
}

async function stubPreviews(page, previews) {
  await page.evaluate((previews) => {
    window.__previewCalls = [];
    sb.functions = { invoke: async (name, { body }) => {
      window.__previewCalls.push({ name, url: body.url });
      const p = previews[body.url];
      return p ? { data: p, error: null } : { data: null, error: new Error('nope') };
    } };
  }, previews);
}

test('link messages show a preview card; Instagram gets a branded fallback', async ({ page }) => {
  const yt = 'https://www.youtube.com/watch?v=abc';
  const ig = 'https://www.instagram.com/reel/XYZ/';
  const bad = 'https://example.com/broken';
  await bootAuthedApp(page, { data: seed([`check this set ${yt}`, ig, `nope ${bad}`, 'no link here']), sessionOver: SESSION_OVER });
  await stubPreviews(page, {
    [yt]: { url: yt, site: 'YouTube', title: 'Boiler Room: Fred again..', description: '@Boiler Room', image: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' },
    [ig]: { url: ig, site: 'Instagram', title: null, description: null, image: null },
  });
  await page.evaluate(() => openHuddle('c1'));
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);

  const ytCard = page.locator('#hd-bub-m0 .hd-link-card');
  await expect(ytCard).toContainText('Boiler Room: Fred again..');
  await expect(ytCard).toContainText('YouTube');
  await expect(ytCard).toHaveAttribute('href', yt);
  await expect(ytCard.locator('img')).toHaveAttribute('src', 'https://i.ytimg.com/vi/abc/hqdefault.jpg');

  await expect(page.locator('#hd-bub-m1 .hd-link-card')).toContainText('Instagram post');
  await expect(page.locator('#hd-bub-m2 .huddle-link')).toHaveText(bad);
  await expect(page.locator('#hd-bub-m2 .hd-link-card')).toHaveCount(0);
  await expect(page.locator('#hd-bub-m3 .hd-link-slot')).toHaveCount(0);

  // One lookup per URL, even across re-renders.
  await page.evaluate(() => renderHuddleUI());
  await expect(page.locator('#hd-bub-m0 .hd-link-card')).toBeVisible();
  const calls = await page.evaluate(() => window.__previewCalls.map(c => c.name + ' ' + c.url));
  expect(calls.sort()).toEqual([`link-preview ${bad}`, `link-preview ${ig}`, `link-preview ${yt}`].sort());
});

test('preview text from the server is escaped', async ({ page }) => {
  const url = 'https://evil.example/x';
  await bootAuthedApp(page, { data: seed([url]), sessionOver: SESSION_OVER });
  await stubPreviews(page, { [url]: { url, site: '<b>s</b>', title: '<img src=x onerror="window.__pwned=1">', description: null, image: 'javascript:alert(1)' } });
  await page.evaluate(() => openHuddle('c1'));
  await expect(page.locator('#hd-bub-m0 .hd-link-card-title')).toHaveText('<img src=x onerror="window.__pwned=1">');
  await expect(page.locator('#hd-bub-m0 .hd-link-card img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});
