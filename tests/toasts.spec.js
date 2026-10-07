const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

// showToast / toastError in app.html: errors get the .error style instead of a
// ⚠️ prefix, and a passed-in error swaps the copy for offline / permission cases.
test.describe('toasts', () => {
  test('toastError styles the toast and a later showToast clears it', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => toastError('Could not save. Try again'));
    await expect(page.locator('#toast')).toHaveClass(/error/);
    await expect(page.locator('#toast')).toHaveText('Could not save. Try again');

    await page.evaluate(() => showToast('✅ Saved'));
    await expect(page.locator('#toast')).toHaveText('✅ Saved', { timeout: 5000 });
    await expect(page.locator('#toast')).not.toHaveClass(/error/);
  });

  test('a permission error gets the permission message', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => toastError('Could not save. Try again', { code: '42501', message: 'new row violates row-level security policy' }));
    await expect(page.locator('#toast')).toHaveText("You don't have permission to do that.");
  });

  test('a network failure gets the offline message', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => toastError('Could not save. Try again', { message: 'TypeError: Failed to fetch' }));
    await expect(page.locator('#toast')).toHaveText("You're offline. Try again once you're back online.");
  });

  test('without an error object the message is kept as is', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => toastError("Name can't be empty"));
    await expect(page.locator('#toast')).toHaveText("Name can't be empty");
  });
});
