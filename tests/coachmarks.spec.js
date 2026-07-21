const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData } = require('./helpers');

// Open the Bass Syndicate (c1) detail page — its leader_id matches TEST_UID,
// so crew.isLead is true and the crew_visibility coachmark is eligible to fire.
async function openC1(page, opts) {
  await page.evaluate(async (o) => { await openDetail('c1', o); }, opts);
  await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
}

test.describe('coachmarks · crew visibility tip', () => {
  test('shows once when a crew lead opens the Roster tab, anchored to the status zone', async ({ page }) => {
    const errors = collectPageErrors(page);
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page, { tab: 'roster' });

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Secret vs Recruiting');
    expect(errors).toEqual([]);
  });

  test('dismissing persists — does not re-show later in the same session', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page, { tab: 'roster' });

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await page.click('.coachmark-dismiss');
    await expect(coachmark).not.toHaveClass(/show/);

    // Leave and come back — should not reappear.
    await page.evaluate(() => closeDetail());
    await openC1(page, { tab: 'roster' });
    await page.waitForTimeout(400);
    await expect(coachmark).not.toHaveClass(/show/);
  });

  test('does not show again cross-session once seen_tips.crew_visibility is set', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { crew_visibility: true } } },
    });
    await openC1(page, { tab: 'roster' });
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });
});

test.describe('coachmarks · game plan rooms tip', () => {
  test('shows once when the Game Plan tab is first opened, anchored to the rave picker', async ({ page }) => {
    // Pre-seen the crew-visibility tip so it doesn't queue ahead of this one.
    // Default seedData() already has r-you and r-sam both RSVP'd to f1, so
    // crew c1 qualifies for a Game Plan (deriveCrewFestivalRooms).
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { crew_visibility: true } } },
    });
    await openC1(page, { tab: 'gameplan' });
    await page.waitForTimeout(400);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('A Game Plan for every shared rave');
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

  // app-guide-btn sits in the top-right corner, so the bubble's left edge
  // gets clamped away from targetRect.left to stay on-screen. The arrow
  // must still track the button's true center, not a fixed offset from the
  // bubble's (now-shifted) own box — regression test for that misalignment.
  test('the arrow tip stays aligned with the header button even when the bubble is edge-clamped', async ({ page }) => {
    await bootAuthedApp(page);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);

    const alignment = await page.evaluate(() => {
      const target = document.getElementById('app-guide-btn').getBoundingClientRect();
      const bubble = document.getElementById('coachmark').getBoundingClientRect();
      const arrowLeftPx = parseFloat(
        getComputedStyle(document.getElementById('coachmark')).getPropertyValue('--arrow-left')
      );
      const arrowTipX = bubble.left + arrowLeftPx + 6; // +6 = half the 12px arrow box
      const targetCenterX = target.left + target.width / 2;
      return { arrowTipX, targetCenterX };
    });

    expect(Math.abs(alignment.arrowTipX - alignment.targetCenterX)).toBeLessThan(2);
  });
});

test.describe('coachmarks · one at a time', () => {
  test('a second queued tip only appears after the first is dismissed', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });

    // Opening the Roster tab queues+shows crew_visibility; switching to Game
    // Plan right after queues game_plan_rooms behind it while crew_visibility
    // still shows.
    await page.evaluate(async () => {
      await openDetail('c1');
      const rosterBtn = document.querySelector('#page-crew-detail .stats-subtab:nth-child(2)');
      switchCrewDetailTab('roster', rosterBtn);
      const gamePlanBtn = document.querySelector('#page-crew-detail .stats-subtab[data-tab="gameplan"]');
      switchCrewDetailTab('gameplan', gamePlanBtn);
    });
    await page.waitForTimeout(400);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Secret vs Recruiting');

    await page.click('.coachmark-dismiss');
    await page.waitForTimeout(400);
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('A Game Plan for every shared rave');
  });
});

test.describe('coachmarks · privacy controls tip', () => {
  test('shows once on your own profile, anchored to the privacy button', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await page.evaluate(() => openProfile('r-you'));
    await expect(page.locator('#page-profile')).toHaveClass(/active/);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Show only what you want');
  });

  test('does not fire on someone else\'s profile', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await page.evaluate(() => openProfile('r-sam'));
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });
});

test.describe('coachmarks · plur points tip', () => {
  // privacy_controls also queues (synchronously) on your own profile, ahead
  // of plur_points (which only queues once the async totals load resolves),
  // so it's pre-seen here the same way stacked tips are elsewhere in this file.
  test('shows once on your own profile, anchored to the PLUR bar', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { privacy_controls: true } } },
    });
    await page.evaluate(() => openProfile('r-you'));
    await expect(page.locator('#page-profile')).toHaveClass(/active/);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Earn PLUR Points');
  });

  test('does not fire on someone else\'s profile', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await page.evaluate(() => openProfile('r-sam'));
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });

  test('does not show again cross-session once seen_tips.plur_points is set', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: {
        user_metadata: { guidance_dismissed: true, seen_tips: { privacy_controls: true, plur_points: true } },
      },
    });
    await page.evaluate(() => openProfile('r-you'));
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });
});

test.describe('coachmarks · unclaimed badge tip', () => {
  test('shows once on the Ravers grid when an unclaimed profile is present', async ({ page }) => {
    // seedData()'s r-sam is unclaimed (claimed_by: null, status: 'unclaimed'). The
    // tip queues from switchTab('members', ...) — the grid itself is pre-rendered
    // during boot regardless of active tab, so the hook has to live on tab switch,
    // not on renderSquad(), or the anchor would still be hidden when queued.
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await page.evaluate(() => switchTab('members'));

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Not claimed yet');
  });

  test('does not fire when every raver is already claimed', async ({ page }) => {
    const data = seedData();
    data.ravers = data.ravers.map(r => r.id === 'r-sam' ? { ...r, claimed_by: 'sam-uid', status: 'claimed' } : r);
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } }, data });
    await page.evaluate(() => switchTab('members'));
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });
});

test.describe('coachmarks · beacon tip', () => {
  test('shows once when the Huddle tile is first opened', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { crew_visibility: true } } },
    });
    await openC1(page, { tab: 'huddle' });
    await page.waitForTimeout(400);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Beacon your crew');
  });

  test('does not show again cross-session once seen_tips.beacon is set', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: {
        user_metadata: {
          guidance_dismissed: true,
          seen_tips: { crew_visibility: true, huddle_rooms: true, beacon: true },
        },
      },
    });
    await openC1(page, { tab: 'huddle' });
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });
});

test.describe('coachmarks · settings toggle and reset', () => {
  test('turning tips off in Privacy & Notifications suppresses new coachmarks', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    await page.click('#tips-settings-toggle');
    await page.evaluate(() => closePrivacySettingsModal());

    await openC1(page);
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });

  test('tips-settings-toggle reflects persisted tips_enabled state on open', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true, tips_enabled: false } } });
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    const hasOnClass = await page.locator('#tips-settings-toggle').evaluate(el => el.classList.contains('on'));
    expect(hasOnClass).toBe(false);
  });

  test('reset tips clears seen_tips so a previously-dismissed tip can queue again', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { crew_visibility: true } } },
    });
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    await page.click('#reset-tips-btn');
    await page.evaluate(() => closePrivacySettingsModal());

    await openC1(page, { tab: 'roster' });
    await expect(page.locator('#coachmark')).toHaveClass(/show/);
    await expect(page.locator('#coachmark')).toContainText('Secret vs Recruiting');
  });
});
