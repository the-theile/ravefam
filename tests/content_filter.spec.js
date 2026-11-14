// The server-side word filter (supabase/migrations/20261013000000_content_filter.sql)
// rejects with 'content_not_allowed'. The app must say why, not "Try again".
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

test.describe('content filter · rejected text gets a clear toast', () => {
  test('toastError explains a content_not_allowed rejection', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    const msgs = await page.evaluate(() => {
      const seen = [];
      window.showToast = (m) => seen.push(m);
      toastError('Could not save review. Try again', { code: 'P0001', message: 'content_not_allowed', details: 'body' });
      toastError('Could not save review. Try again', { code: 'P0001', message: 'something else' });
      return seen;
    });
    expect(msgs[0]).toContain("language RaveFAM doesn't allow");
    expect(msgs[1]).toBe('Could not save review. Try again');
  });

  test('isContentBlocked only matches the filter error', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    const r = await page.evaluate(() => [
      isContentBlocked({ message: 'content_not_allowed' }),
      isContentBlocked({ message: 'permission denied' }),
      isContentBlocked(null),
    ]);
    expect(r).toEqual([true, false, false]);
  });
});
