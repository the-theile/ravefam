const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData } = require('./helpers');

// Open the Bass Syndicate (c1) detail page — its leader_id matches TEST_UID,
// so crew.isLead is true.
async function openC1(page, opts) {
  await page.evaluate(async (o) => { await openDetail('c1', o); }, opts);
  await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
}

// Most of the old per-feature coachmarks (crew_visibility, game_plan_rooms,
// game_plan_claim_slot, privacy_controls, plur_points, unclaimed_badge,
// app_guide_nudge) were retired: a popup you can only ever see once was the
// wrong pattern for anything worth explaining more than once, or anything
// that could be missed by scrolling/navigating away before it registered.
// They were replaced by either a permanent inline caption next to the
// feature, or a checkable item in the post-onboarding guidance checklist.
// `beacon` is the one coachmark left — it needs to interrupt at a specific
// moment (first time the Huddle is open) and has no natural inline home.

test.describe('coachmarks · beacon tip', () => {
  test('shows once when the Huddle tile is first opened', async ({ page }) => {
    const errors = collectPageErrors(page);
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page, { tab: 'huddle' });
    await page.waitForTimeout(400);

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await expect(coachmark).toContainText('Beacon your crew');
    expect(errors).toEqual([]);
  });

  test('dismissing persists — does not re-show later in the same session', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page, { tab: 'huddle' });

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);
    await page.click('.coachmark-dismiss');
    await expect(coachmark).not.toHaveClass(/show/);

    // Leave and come back — should not reappear.
    await page.evaluate(() => closeDetail());
    await openC1(page, { tab: 'huddle' });
    await page.waitForTimeout(400);
    await expect(coachmark).not.toHaveClass(/show/);
  });

  test('does not show again cross-session once seen_tips.beacon is set', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } },
    });
    await openC1(page, { tab: 'huddle' });
    await page.waitForTimeout(400);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });

  // Regression test for the original bug report: a user scrolling or
  // tapping away from the anchored feature before dismissing left the
  // bubble floating over stale coordinates, because the queue only
  // re-checks target visibility when starting the *next* tip, not for one
  // already showing. switchTab/closeDetail/teardownHuddleLive now call
  // _recheckCoachmarkTarget() to hide it the moment its target is gone.
  test('navigating away while showing hides the bubble instead of leaving it stranded', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page, { tab: 'huddle' });

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);

    // Bottom-nav away without ever clicking "Got it".
    await page.evaluate(() => switchTab('events'));
    await expect(coachmark).not.toHaveClass(/show/);

    // The user never got a real look at it, so it must NOT be marked seen —
    // it should still be eligible to fire again later.
    const stillEligible = await page.evaluate(() => !_seenTips.beacon);
    expect(stillEligible).toBe(true);
  });

  test('closing the crew detail page while the bubble is showing hides it too', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page, { tab: 'huddle' });

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);

    await page.evaluate(() => closeDetail());
    await expect(coachmark).not.toHaveClass(/show/);
  });
});

test.describe('coachmarks · settings toggle and reset', () => {
  test('turning tips off in Privacy & Notifications suppresses new coachmarks', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    await page.click('#tips-settings-toggle');
    await page.evaluate(() => closePrivacySettingsModal());

    await openC1(page, { tab: 'huddle' });
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
      sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } },
    });
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    await page.click('#reset-tips-btn');
    await page.evaluate(() => closePrivacySettingsModal());

    await openC1(page, { tab: 'huddle' });
    await expect(page.locator('#coachmark')).toHaveClass(/show/);
    await expect(page.locator('#coachmark')).toContainText('Beacon your crew');
  });
});

test.describe('coachmark bubble positioning (regression)', () => {
  // The arrow tip must track the target's true center even when the bubble
  // itself gets edge-clamped to stay on-screen — drive it with a synthetic
  // near-edge target so this doesn't depend on which real feature happens
  // to sit at a screen edge.
  test('the arrow tip stays aligned with the target even when the bubble is edge-clamped', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });

    await page.evaluate(() => {
      const el = document.createElement('button');
      el.id = 'coachmark-test-target';
      el.textContent = 'x';
      // position:absolute, not fixed — fixed elements have offsetParent===null
      // in every browser, which would trip the queue's own visibility guard
      // and make this synthetic target look "hidden" before it even shows.
      // Sized/placed to reproduce the real scenario: close enough to the
      // right edge that the bubble's own left position gets clamped to stay
      // on-screen, but not so close that the arrow's *own* min/max clamp
      // (which keeps it from rendering outside the bubble) also engages —
      // this test is specifically about the first kind of clamping.
      el.style.cssText = 'position:absolute;top:10px;right:60px;width:44px;height:20px;';
      document.body.appendChild(el);
      queueCoachmark('__test_tip__', {
        targetEl: el,
        title: 'Test tip',
        body: 'Regression check for arrow alignment.',
      });
    });

    const coachmark = page.locator('#coachmark');
    await expect(coachmark).toHaveClass(/show/);

    const alignment = await page.evaluate(() => {
      const target = document.getElementById('coachmark-test-target').getBoundingClientRect();
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

test.describe('post-onboarding guidance checklist', () => {
  test('renders the three checklist items unchecked for a fresh user', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: {} } });
    // bootAuthedApp force-closes the welcome popup, which triggers showGuidanceBanner().
    await expect(page.locator('#guidance-banner')).toBeVisible();
    const items = page.locator('#guidance-checklist .ob-checklist-item');
    await expect(items).toHaveCount(3);
    await expect(page.locator('#checklist-plur_points')).not.toHaveClass(/done/);
    await expect(page.locator('#checklist-vendor_village_intro')).not.toHaveClass(/done/);
    await expect(page.locator('#checklist-privacy_controls')).not.toHaveClass(/done/);
  });

  test('clicking a checklist item marks it done, persists it, and navigates', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: {} } });
    await expect(page.locator('#guidance-banner')).toBeVisible();

    await page.click('#checklist-privacy_controls');
    await expect(page.locator('#checklist-privacy_controls')).toHaveClass(/done/);
    await expect(page.locator('#privacy-settings-overlay')).toHaveClass(/open/);

    const persisted = await page.evaluate(() => !!_seenTips.privacy_controls);
    expect(persisted).toBe(true);
  });

  test('an item already in seen_tips (e.g. from the old coachmark) renders pre-checked', async ({ page }) => {
    await bootAuthedApp(page, {
      sessionOver: { user_metadata: { seen_tips: { plur_points: true } } },
    });
    await expect(page.locator('#guidance-banner')).toBeVisible();
    await expect(page.locator('#checklist-plur_points')).toHaveClass(/done/);
    await expect(page.locator('#checklist-vendor_village_intro')).not.toHaveClass(/done/);
  });
});

test.describe('inline captions replacing old coachmarks', () => {
  test('crew status zone shows the "no going back" warning inline, not as a popup', async ({ page }) => {
    // seedData()'s c1 defaults to 'recruiting' — the "no going back" caption
    // only applies while Secret, so flip it for this test.
    const data = seedData();
    data.crews = data.crews.map(c => c.id === 'c1' ? { ...c, status: 'secret' } : c);
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } }, data });
    await openC1(page, { tab: 'roster' });
    await page.waitForTimeout(400);

    await expect(page.locator('#page-crew-detail .crew-status-zone')).toContainText('No going back to Secret');
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });

  test('unclaimed member badge carries the explanation as a title attribute', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await page.evaluate(() => switchTab('members'));
    await page.waitForTimeout(400);

    const badge = page.locator('#members-grid .claim-badge-unclaimed').first();
    await expect(badge).toHaveAttribute('title', /placeholder until they scan their QR/i);
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });

  test('Roles/Rides/Stay sections show the "claim a slot" hint inline instead of a coachmark', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance_dismissed: true } } });
    await openC1(page, { tab: 'gameplan' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const btn = document.querySelector('#crew-feature-panel-raveplan .game-plan-section-tab[data-section="roles"]');
      switchGamePlanSection('roles', btn);
    });

    await expect(page.locator('#game-plan-section-roles')).toContainText('Tap an open slot to claim it');
    await expect(page.locator('#coachmark')).not.toHaveClass(/show/);
  });
});
