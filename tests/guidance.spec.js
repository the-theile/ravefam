const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData } = require('./helpers');

// 2.0 guidance (see the GUIDANCE KIT and REALMS sections of app.html). It
// replaced the one-shot coachmarks and the post-onboarding checklist.
//
// bootAuthedApp defaults to a settled raver who has already found every tab
// and seen every intro (so other specs aren't interrupted). Specs here that
// exercise first-time guidance pass `guidance: null` for a fresh 2.0 raver.
const FRESH = { user_metadata: { guidance: null } };

async function openC1(page, opts) {
  await page.evaluate(async (o) => { await openDetail('c1', o); }, opts);
  await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
}
async function closeSheets(page) {
  await page.evaluate(() => { closeZoneSheet(); document.getElementById('gk-moment-screen')?.remove(); });
  await page.waitForTimeout(350);
}

test.describe('guidance · places', () => {
  test('first visit to a tab shows the unlock banner and its intro, and claims the reward server-side', async ({ page }) => {
    const errors = collectPageErrors(page);
    const data = seedData();
    data.__rpc = { claim_realm_discovery: true };
    await bootAuthedApp(page, { sessionOver: FRESH, data });
    await closeSheets(page); // the 2.0 welcome
    await page.evaluate(() => switchTab('stats'));
    await expect(page.locator('.gk-banner')).toContainText('+10 Unity · Stats');
    await expect(page.locator('.gk-sheet .gk-title').last()).toHaveText('Rave Life');
    const calls = await page.evaluate(() => (window.__store.__rpcCalls || []).filter(c => c.fn === 'claim_realm_discovery').map(c => c.args.p_realm));
    expect(calls).toContain('stats');
    expect(errors).toEqual([]);
  });

  test('the banner never promises points the server did not pay', async ({ page }) => {
    const data = seedData();
    data.__rpc = { claim_realm_discovery: false };
    await bootAuthedApp(page, { sessionOver: FRESH, data });
    await closeSheets(page);
    await page.evaluate(() => switchTab('stats'));
    await expect(page.locator('.gk-banner')).toBeVisible();
    await expect(page.locator('.gk-banner')).not.toContainText('Unity');
  });

  test('unfound tabs twinkle; a found tab stops', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: FRESH });
    await closeSheets(page);
    await expect(page.locator('.nav-tab.c-stats .gk-twinkle')).toHaveCount(1);
    await page.evaluate(() => switchTab('stats'));
    await expect(page.locator('.nav-tab.c-stats .gk-twinkle')).toHaveCount(0);
  });

  test('Later saves the intro: yellow ! on the tab and Resume in the hub', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: FRESH });
    await closeSheets(page);
    await page.evaluate(() => switchTab('stats'));
    await page.locator('.gk-sheet .gk-btn.ghost').last().click();
    await expect(page.locator('.nav-tab.c-stats .gk-saved-badge')).toHaveCount(1);
    await page.evaluate(() => openAppGuide());
    await expect(page.locator('#guide-hub-root')).toContainText('SAVED FOR LATER');
    await expect(page.locator('#guide-hub-root')).toContainText('Stats');
  });

  test('a settled raver gets no banners or intros', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('stats'));
    await page.waitForTimeout(400);
    await expect(page.locator('.gk-banner')).toHaveCount(0);
    await expect(page.locator('.gk-sheet')).toHaveCount(0);
  });
});

test.describe('guidance · existing raver welcome', () => {
  test('an existing raver sees "What\'s new in 2.0" once, and dismissing it does not change their help level', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: FRESH });
    await expect(page.locator('.gk-sheet .gk-title').last()).toHaveText('Fresh help that fades as you go');
    await page.locator('#gk-sheet-overlay').click({ position: { x: 5, y: 5 } });
    expect(await page.evaluate(() => _guidance.help_level)).toBe('guide');
    expect(await page.evaluate(() => !!_guidance.quests.welcome_2_0)).toBe(true);
  });
});

test.describe('guidance · Huddle and Beacon', () => {
  test('📡 pulses until its first tap, which opens the Beacon intro; the practice Beacon never sends', async ({ page }) => {
    const errors = collectPageErrors(page);
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: null } } });
    await closeSheets(page);
    await openC1(page, { tab: 'huddle' });
    await page.waitForTimeout(500);
    await closeSheets(page); // the Huddle's own intro
    await expect(page.locator('.huddle-beacon-fab-inline')).toHaveClass(/gk-pulse/);
    await page.evaluate(() => { window.__beaconSends = 0; const orig = sendBeacon; window.sendBeacon = sendBeacon = async (...a) => { window.__beaconSends++; return orig(...a); }; });
    await page.click('.huddle-beacon-fab-inline');
    await expect(page.locator('.gk-sheet .gk-title').last()).toHaveText('Beacon');
    await page.locator('.gk-sheet .gk-btn.primary').last().click();
    await expect(page.locator('#hd-beacon-slot')).toContainText('PRACTICE BEACON · ONLY YOU SEE THIS');
    await expect(page.locator('.huddle-beacon-fab-inline')).not.toHaveClass(/gk-pulse/);
    expect(await page.evaluate(() => window.__beaconSends)).toBe(0);
    const inserted = await page.evaluate(() => (window.__store.huddle_messages || []).filter(m => m.kind === 'beacon').length);
    expect(inserted).toBe(0);
    expect(errors).toEqual([]);
  });

  test('after the intro, 📡 opens the real Beacon form', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page, { tab: 'huddle' });
    await page.waitForTimeout(400);
    await page.click('.huddle-beacon-fab-inline');
    await expect(page.locator('#huddle-beacon-form')).toBeVisible();
    await expect(page.locator('.gk-sheet')).toHaveCount(0);
  });
});

test.describe('guidance · help level and settings', () => {
  test('turning Tips & hints off in Settings sets I\'m a pro, and intros stop', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: FRESH });
    await closeSheets(page);
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    await page.click('#tips-settings-toggle');
    await page.evaluate(() => closePrivacySettingsModal());
    expect(await page.evaluate(() => _guidance.help_level)).toBe('pro');
    await page.evaluate(() => switchTab('stats'));
    await page.waitForTimeout(400);
    await expect(page.locator('.gk-sheet')).toHaveCount(0);
  });

  test('an old tips_enabled:false carries over as I\'m a pro, and the toggle reflects it', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: { user_metadata: { guidance: null, tips_enabled: false } } });
    await closeSheets(page);
    expect(await page.evaluate(() => _guidance.help_level)).toBe('pro');
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    const on = await page.locator('#tips-settings-toggle').evaluate(el => el.classList.contains('on'));
    expect(on).toBe(false);
  });

  test('Reset tips brings intros back but keeps places found', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => openPrivacySettingsModal('r-you'));
    await page.click('#reset-tips-btn');
    await page.evaluate(() => closePrivacySettingsModal());
    const state = await page.evaluate(() => ({ zones: Object.keys(_guidance.zones).length, found: Object.keys(_guidance.realms).length }));
    expect(state.zones).toBe(0);
    expect(state.found).toBe(5);
  });

  test('the Guide & Help hub opens on help for the current screen', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('members'));
    await page.evaluate(() => openAppGuide());
    await expect(page.locator('#guide-hub-root')).toContainText('YOU’RE ON · RAVERS');
    await expect(page.locator('#guide-hub-root')).toContainText('HOW MUCH HELP?');
    await page.click('#guide-hub-root >> text=I’m a pro');
    expect(await page.evaluate(() => _guidance.help_level)).toBe('pro');
  });

  test('the Setup pill shows in the first week for an unfinished raver', async ({ page }) => {
    await bootAuthedApp(page, { sessionOver: FRESH });
    await closeSheets(page);
    await expect(page.locator('#setup-pill')).toBeVisible();
    await page.click('#setup-pill');
    await expect(page.locator('.gk-sheet .gk-title').last()).toHaveText('Finish setting up');
  });
});

test.describe('inline captions', () => {
  test('crew status zone shows the "no going back" warning inline', async ({ page }) => {
    // seedData()'s c1 defaults to 'recruiting' — the "no going back" caption
    // only applies while Secret, so flip it for this test.
    const data = seedData();
    data.crews = data.crews.map(c => c.id === 'c1' ? { ...c, status: 'secret' } : c);
    await bootAuthedApp(page, { data });
    await openC1(page, { tab: 'roster' });
    await page.waitForTimeout(400);
    await expect(page.locator('#page-crew-detail .crew-status-zone')).toContainText('No going back to Secret');
  });

  test('unclaimed member badge carries the explanation as a title attribute', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() => switchTab('members'));
    await page.waitForTimeout(400);
    const badge = page.locator('#members-grid .claim-badge-unclaimed').first();
    await expect(badge).toHaveAttribute('title', /placeholder until they scan their QR/i);
  });

  test('Roles/Rides/Stay sections show the "claim a slot" hint inline', async ({ page }) => {
    await bootAuthedApp(page);
    await openC1(page, { tab: 'gameplan' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const btn = document.querySelector('#crew-feature-panel-raveplan .game-plan-section-tab[data-section="roles"]');
      switchGamePlanSection('roles', btn);
    });
    await expect(page.locator('#game-plan-section-roles')).toContainText('Tap an open slot to claim it');
  });
});
