const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors } = require('./helpers');

// Open the Bass Syndicate (c1) detail page — its leader_id matches TEST_UID,
// so crew.isLead is true and the crew_visibility coachmark is eligible to fire.
async function openC1(page, opts) {
  await page.evaluate(async (o) => { await openDetail('c1', o); }, opts);
  await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
}

test.describe('coachmarks · crew visibility tip', () => {
  test('shows once on a crew lead\'s own crew detail page, anchored to the status zone', async ({ page }) => {
    const errors = collectPageErrors(page);
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Secret vs Recruiting');
    expect(errors).toEqual([]);
  });

  test('dismissing persists — does not re-show later in the same session', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await page.click('.coachmark-dismiss');
    await expect(coachmark).not.toHaveClass(/show/);

    // Leave and come back — should not reappear.
    await page.evaluate(() => closeDetail());
    await openC1(page);
    await page.waitForTimeout(400);
    await expect(coachmark).not.toHaveClass(/show/);
  });

  test('does not show again cross-session once seen_tips.crew_visibility is set', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { crew_visibility: true } } },
    });
    await openC1(page);
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });
});

test.describe('coachmarks · huddle rooms tip', () => {
  test('shows once when the Huddle tab is first opened, anchored to the room selector', async ({ page }) => {
    // Pre-seen the crew-visibility tip so it doesn't queue ahead of this one.
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { crew_visibility: true } } },
    });
    await openC1(page, { tab: 'huddle' });
    await page.waitForTimeout(400);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText("Huddle isn't just one room");
  });
});

test.describe('coachmarks · app guide nudge', () => {
  test('shows once right after the guidance banner appears, pointing at the header button', async ({ page }) => {
    // bootAuthedApp's cleanup calls closeWelcomePopup() -> showGuidanceBanner(),
    // which is exactly the hook point for this tip — no extra navigation needed.
    await bootAuthedApp(page);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Lost on the floor');
  });
});

test.describe('coachmarks · one at a time', () => {
  test('a second queued tip only appears after the first is dismissed', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });

    // Opening c1 queues+shows crew_visibility; switching to Huddle right after
    // queues huddle_rooms behind it while crew_visibility is still showing.
    await page.evaluate(async () => {
      await openDetail('c1');
      const huddleBtn = document.querySelector('#page-crew-detail .stats-subtab:nth-child(3)');
      switchCrewDetailTab('huddle', huddleBtn);
    });
    await page.waitForTimeout(400);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Secret vs Recruiting');

    await page.click('.coachmark-dismiss');
    await page.waitForTimeout(400);
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText("Huddle isn't just one room");
  });
});
