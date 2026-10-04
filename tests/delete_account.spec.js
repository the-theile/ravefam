const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

test.describe('self-serve account deletion', () => {
  test('requires typing DELETE, then erases the account and signs out', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(() => {
      window.__removed = [];
      const orig = sb.storage.from.bind(sb.storage);
      sb.storage.from = (bucket) => {
        const api = orig(bucket);
        return { ...api, remove(paths) { window.__removed.push({ bucket, paths }); return api.remove(paths); } };
      };
      openDeleteAccountModal();
    });
    await expect(page.locator('#delete-account-overlay')).toHaveClass(/open/);
    await expect(page.locator('#delete-account-go')).toBeDisabled();

    await page.fill('#delete-account-confirm', 'delet');
    await expect(page.locator('#delete-account-go')).toBeDisabled();
    await page.fill('#delete-account-confirm', 'DELETE');
    await expect(page.locator('#delete-account-go')).toBeEnabled();
    await page.locator('#delete-account-go').click();

    await expect(page.locator('#auth-screen')).toBeVisible();
    expect(await page.evaluate(() => window.__deleteAccountCalls)).toBe(1);
    expect(await page.evaluate(() => window.__removed)).toEqual([{ bucket: 'photos', paths: ['profiles/me.jpg'] }]);
  });

  test('settings exposes the delete-account entry point', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => notifDrawerSettings());
    await expect(page.locator('#privacy-settings-overlay')).toHaveClass(/open/);
    await page.locator('#delete-account-btn').click();
    await expect(page.locator('#privacy-settings-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#delete-account-overlay')).toHaveClass(/open/);
  });

  test('messages from a deleted account are labelled "Deleted raver"', async ({ page }) => {
    await bootAuthedApp(page);
    expect(await page.evaluate(() => huddleSenderName(null))).toBe('Deleted raver');
  });
});
