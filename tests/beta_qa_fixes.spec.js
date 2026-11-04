const { test, expect } = require('@playwright/test');
const { installSupabaseStub, bootAuthedApp, makeSession, seedData, SETTLED_GUIDANCE } = require('./helpers');

const EMPTY = { festivals: [], ravers: [], crews: [], crew_members: [], raver_festivals: [], raver_festival_interest: [] };

// A handle held by a stranger (a row RLS hides from this user) must read as
// taken: availability goes through handle_available(), the same rule the
// unique index enforces, never a direct ravers select.
test.describe('onboarding handle availability', () => {
  async function bootOnboarding(page, ravers) {
    await installSupabaseStub(page, {
      session: makeSession({ user_metadata: { onboarded: false } }),
      data: { ...EMPTY, ravers },
    });
    await page.goto('/app.html');
    await expect(page.locator('#ob-handle-input')).toBeVisible({ timeout: 4000 });
  }
  const stranger = { id: 'r-x', name: 'Someone', handle: 'Tester', claimed_by: 'other-uid', created_by: 'other-uid', status: 'claimed', deleted_at: null };

  test('a handle owned by someone else (any case) shows as taken', async ({ page }) => {
    await bootOnboarding(page, [stranger]);
    await page.fill('#ob-name-input', 'New Raver');
    await page.fill('#ob-handle-input', 'tester');
    await expect(page.locator('#ob-handle-status')).toHaveText('@tester is taken 😔');
    await expect(page.locator('#ob-step2-btn')).toBeDisabled();
  });

  test('underscore is literal, not a wildcard', async ({ page }) => {
    await bootOnboarding(page, [{ ...stranger, handle: 'djax' }]);
    await page.fill('#ob-name-input', 'New Raver');
    await page.fill('#ob-handle-input', 'dj_x');
    await expect(page.locator('#ob-handle-status')).toHaveText('@dj_x is all yours 🎉');
  });

  test('a failed check never claims the handle is free', async ({ page }) => {
    await bootOnboarding(page, []);
    await page.evaluate(() => { const orig = sb.rpc.bind(sb); sb.rpc = (fn, a) => fn === 'handle_available' ? Promise.resolve({ data: null, error: { message: 'boom' } }) : orig(fn, a); });
    await page.fill('#ob-name-input', 'New Raver');
    await page.fill('#ob-handle-input', 'freshname');
    await expect(page.locator('#ob-handle-status')).toHaveText("Couldn't check that handle. Try again");
    await expect(page.locator('#ob-step2-btn')).toBeDisabled();
  });
});

test.describe('bell badge and drawer stay in step', () => {
  test('a realtime reload re-renders the open drawer and keeps unsaved local rows', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => { openNotifDrawer(); });
    // Local row whose insert hasn't returned yet (non-uuid id) + a server reload landing.
    await page.evaluate(async () => {
      _notifications.unshift({ id: 'local_1', message: 'Pending local ping', timestamp: Date.now(), read: false, type: null, data: null });
      window.__store.notifications = [{ id: '33333333-3333-4333-8333-333333333333', user_id: currentUser.id, crew_id: null, message: 'From the server', read: false, created_at: new Date().toISOString(), data: null }];
      await dbLoadNotifications();
    });
    await expect(page.locator('#notif-list')).toContainText('From the server');
    await expect(page.locator('#notif-list')).toContainText('Pending local ping');
    await expect(page.locator('#notif-badge')).toHaveText('2');
    await expect(page.locator('#notif-drawer-sub')).toHaveText('2 unread');
  });
});

test.describe('browser Back between sections', () => {
  test('Back walks back through bottom-nav sections inside the app', async ({ page }) => {
    await bootAuthedApp(page);
    await page.click('.nav-tab[onclick*="\'events\'"]');
    await page.click('.nav-tab[onclick*="\'members\'"]');
    await expect(page.locator('#page-members')).toHaveClass(/active/);
    await page.goBack();
    await expect(page.locator('#page-events')).toHaveClass(/active/);
    await page.goBack();
    await expect(page.locator('#page-crews')).toHaveClass(/active/);
    expect(page.url()).toContain('/app.html');
  });
});

test.describe('RSVP confirmation', () => {
  test('first RSVP via a ticket type shows one confirmation, not a toast on top', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: { ...SETTLED_GUIDANCE, quests: { ...SETTLED_GUIDANCE.quests, first_rsvp: false } } } } });
    await page.evaluate(() => openGoingOptionsSheet('f2'));
    await page.locator('.going-ticket-chip').first().click();
    await expect(page.getByText('You’re going!').first()).toBeVisible();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => _toastQueue.length + (_toastShowing ? 1 : 0))).toBe(0);
  });
});

test.describe('crew share card', () => {
  test('a Secret crew card has no QR and says invites open in Recruiting', async ({ page }) => {
    const data = seedData(); data.crews[0].status = 'secret';
    await bootAuthedApp(page, { data });
    await page.evaluate(() => openCrewShareCard('c1'));
    await expect(page.locator('#crew-share-card .crew-share-qr-pending')).toBeVisible();
    await expect(page.locator('#crew-share-qr')).toHaveCount(0);
  });
});
