// Escape used to close only the photo and map-pin lightboxes; every other
// overlay trapped you until you found its ✕. The generic handler replays each
// overlay's own backdrop-click handler, so it gets that overlay's real close
// path rather than just stripping a class.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

const ESC = 'Escape';

test.describe('Escape closes the top overlay', () => {
  test('a modal-overlay closes, and its close function actually ran', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(() => showCrewEditModal('c1'));
    await expect(page.locator('#crew-edit-overlay')).toHaveClass(/open/);

    await page.keyboard.press(ESC);
    await expect(page.locator('#crew-edit-overlay')).not.toHaveClass(/open/);
  });

  test('a closed overlay is not treated as open', async ({ page }) => {
    await bootAuthedApp(page);
    // .modal-overlay keeps display:flex when closed, so a naive display check
    // would think every modal in the document was on screen.
    const openCount = await page.evaluate(() =>
      [...document.querySelectorAll(OVERLAY_ROOT_SELECTOR)]
        .filter(isOverlayOpen).length);
    expect(openCount).toBe(0);
  });

  test('Escape with nothing open does not throw or close anything', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await bootAuthedApp(page);

    await page.keyboard.press(ESC);
    await page.waitForTimeout(150);

    expect(errors).toEqual([]);
    await expect(page.locator('#page-crews')).toHaveClass(/active/);
  });

  test('the topmost overlay closes first when two are stacked', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(() => {
      showCrewEditModal('c1');
      // Confirm sits above the rest of the modal layer.
      showConfirm('Really?', 'This stacks on top.', 'Yes', () => {});
    });
    await expect(page.locator('#confirm-overlay')).toHaveClass(/open/);

    await page.keyboard.press(ESC);
    // The stacked one goes, the one underneath stays.
    await expect(page.locator('#confirm-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#crew-edit-overlay')).toHaveClass(/open/);

    await page.keyboard.press(ESC);
    await expect(page.locator('#crew-edit-overlay')).not.toHaveClass(/open/);
  });

  // Escape from inside a dialog's own text field should still close the dialog —
  // that's the standard expectation, and modals here autofocus an input, so a
  // blanket "ignore Escape in inputs" rule would make Escape look broken.
  test('Escape from inside a modal text field still closes the modal', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(() => showCrewEditModal('c1'));
    await expect(page.locator('#crew-edit-overlay')).toHaveClass(/open/);

    const input = page.locator('#crew-edit-overlay input').first();
    await expect(input).toHaveCount(1);
    await input.focus();
    await page.keyboard.press(ESC);
    await expect(page.locator('#crew-edit-overlay')).not.toHaveClass(/open/);
  });

  // …but a field with its own open dropdown consumes Escape first, so one press
  // dismisses the dropdown and leaves the overlay alone.
  test('an open location dropdown consumes Escape before the overlay does', async ({ page }) => {
    await bootAuthedApp(page);

    await page.evaluate(() => openNearbyLocModal());
    await expect(page.locator('#nearby-loc-overlay')).toHaveClass(/open/);

    // Put the autocomplete into its open state, as a search result would.
    await page.evaluate(() => {
      const dd = document.getElementById('nearby-loc-dropdown');
      dd.innerHTML = '<div class="loc-item">Berlin, DE</div>';
      dd.style.display = 'block';
    });

    await page.locator('#nearby-loc-input').focus();
    await page.keyboard.press(ESC);

    // Dropdown dismissed, overlay untouched.
    expect(await page.evaluate(() =>
      document.getElementById('nearby-loc-dropdown').style.display)).toBe('none');
    await expect(page.locator('#nearby-loc-overlay')).toHaveClass(/open/);

    // A second press, with no dropdown left to claim it, closes the overlay.
    await page.keyboard.press(ESC);
    await expect(page.locator('#nearby-loc-overlay')).not.toHaveClass(/open/);
  });
});
