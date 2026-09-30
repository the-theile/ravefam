const { test, expect } = require('@playwright/test');
const { installSupabaseStub, bootAuthedApp, makeSession, seedData } = require('./helpers');

// Regression net for the signup + invitation pass: dead claim links before
// signup, stray Enter-key code sends, the post-claim "decline" toast, the
// claim-preview "Cancel edit" button, and first-time setup after a crew link.

const EMPTY = { festivals: [], ravers: [], crews: [], crew_members: [], raver_festivals: [], raver_festival_interest: [] };
const CREW = { id: 'c1', name: 'Bass Syndicate', color: '#FF2D78', status: 'recruiting', member_count: 3 };

async function openSignedOut(page, url, data) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await installSupabaseStub(page, { session: null, data });
  await page.goto(url);
  await expect(page.locator('#auth-screen')).not.toHaveClass(/hidden/);
  return errors;
}

function storedClaim(page) {
  return page.evaluate(() => ({
    session: sessionStorage.getItem('pendingClaim'),
    local: localStorage.getItem('pendingClaimToken'),
  }));
}

test.describe('dead ?claim= links while signed out', () => {
  test('an invalid claim token reads as expired and stops re-prompting', async ({ page }) => {
    const data = { ...seedData(), __rpc: { get_claim_preview: { error: 'invalid_token' } } };
    const errors = await openSignedOut(page, '/app.html?claim=bad-token', data);

    await expect(page.locator('#intercept-title')).toContainText('expired');
    // The localStorage backup used to survive, so every visit re-raised the
    // "You've been invited!" intercept for a token that can never work.
    expect(await storedClaim(page)).toEqual({ session: null, local: null });
    expect(errors).toEqual([]);
  });

  test('an already-claimed spot says so before signup', async ({ page }) => {
    const data = { ...seedData(), __rpc: { get_claim_preview: { error: 'already_claimed', raver_name: 'Sam' } } };
    const errors = await openSignedOut(page, '/app.html?claim=used-token', data);

    await expect(page.locator('#intercept-title')).toContainText('already been claimed');
    expect(await storedClaim(page)).toEqual({ session: null, local: null });
    expect(errors).toEqual([]);
  });

  test('a live claim reads naturally ("X\'s spot is saved for you")', async ({ page }) => {
    const data = { ...seedData(), __rpc: { get_claim_preview: { raver: { id: 's1', name: 'Sam Rivera' }, crew: CREW } } };
    await openSignedOut(page, '/app.html?claim=good-token', data);

    await expect(page.locator('#intercept-title')).toContainText('Bass Syndicate');
    await expect(page.locator('#intercept-sub')).toContainText("Sam Rivera's spot is saved for you");
  });
});

test.describe('auth-screen Enter key', () => {
  test('Enter in the claim-code boxes does not send a login code', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('rf_last_login', JSON.stringify({ method: 'email', value: 'me@example.com' })));
    await openSignedOut(page, '/app.html', seedData());
    await page.evaluate(() => {
      window.__otpSends = 0;
      const orig = sb.auth.signInWithOtp.bind(sb.auth);
      sb.auth.signInWithOtp = (a) => { window.__otpSends++; return orig(a); };
      openScanner(); switchScannerTab('code');
    });
    const box = page.locator('.otp-box').first();
    await box.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // The prefilled email used to be sent a code from behind the scanner.
    expect(await page.evaluate(() => window.__otpSends)).toBe(0);
    await expect(page.locator('#auth-code-form')).toBeHidden();
  });

  test('Enter in the email field still sends the code', async ({ page }) => {
    await openSignedOut(page, '/app.html', seedData());
    await page.fill('#login-id', 'new@example.com');
    await page.locator('#login-id').press('Enter');
    await expect(page.locator('#auth-code-form')).toBeVisible();
  });
});

test.describe('claim commit', () => {
  const PREVIEW = {
    raver: { id: 'stub-1', name: 'Sam Rivera', handle: 'samr', notes: 'met at EDC' },
    crew: CREW,
  };

  async function openPreview(page, data) {
    const errors = await bootAuthedApp(page, { data });
    await page.evaluate((p) => {
      sessionStorage.setItem('pendingClaim', 'tok-abc');
      localStorage.setItem('pendingClaimToken', 'tok-abc');
      document.getElementById('scanner-overlay').classList.add('open');
      showClaimPreview(p, 'tok-abc');
    }, PREVIEW);
    return errors;
  }

  test('a successful claim is not toasted as a decline', async ({ page }) => {
    const data = { ...seedData(), __rpc: { get_claim_preview: PREVIEW, claim_and_merge_raver: { merged_into: 'r-me' } } };
    const errors = await openPreview(page, data);
    await page.evaluate(() => commitClaim());

    await expect(page.locator('#claim-success-screen')).toHaveClass(/open/);
    await expect(page.locator('#toast')).not.toContainText('fresh invite');
    expect(errors).toEqual([]);
  });

  test('a failed claim restores the crew-named button label', async ({ page }) => {
    const data = { ...seedData(), __rpc: { get_claim_preview: PREVIEW, claim_and_merge_raver: { error: 'something_else' } } };
    await openPreview(page, data);
    const label = await page.locator('#confirm-claim-btn').textContent();
    await page.evaluate(() => {
      // Keep the preview in view so the button's restored label can be read.
      window.showScannerError = () => {};
      return commitClaim();
    });
    await expect(page.locator('#confirm-claim-btn')).toHaveText(label);
  });
});

test.describe('claim preview "Cancel edit"', () => {
  // Direct claim (no existing profile) is the path that shows the edit form.
  const PREVIEW = { raver: { id: 'stub-1', name: 'Sam Rivera', handle: 'samr' }, crew: CREW };

  async function bootNewUserWithPreview(page) {
    const data = { ...EMPTY, __rpc: { get_claim_preview: PREVIEW, claim_and_merge_raver: { claimed_id: 'stub-1' } } };
    await installSupabaseStub(page, { session: makeSession({ user_metadata: { onboarded: false } }), data });
    await page.goto('/app.html');
    await page.locator('#main-app').waitFor({ state: 'visible' });
    await page.evaluate((p) => {
      document.getElementById('scanner-overlay').classList.add('open');
      showClaimPreview(p, 'tok-abc');
    }, PREVIEW);
  }

  function raverUpdates(page) {
    return page.evaluate(() => (window.__raverUpdates || []));
  }

  async function spyRaverUpdates(page) {
    await page.evaluate(() => {
      window.__raverUpdates = [];
      const from = sb.from.bind(sb);
      sb.from = (t) => {
        const b = from(t);
        if (t !== 'ravers') return b;
        const upd = b.update.bind(b);
        b.update = (p) => { window.__raverUpdates.push(p); return upd(p); };
        return b;
      };
    });
  }

  test('cancelling the edit form discards the edits', async ({ page }) => {
    await bootNewUserWithPreview(page);
    await spyRaverUpdates(page);
    await page.evaluate(() => {
      const btn = document.querySelector('.claim-edit-btn');
      toggleClaimEditForm(btn);
      document.getElementById('claim-edit-name').value = 'Somebody Else';
      toggleClaimEditForm(btn); // ✕ Cancel edit
      return commitClaim();
    });
    expect((await raverUpdates(page)).some(u => u.name === 'Somebody Else')).toBe(false);
  });

  test('saved edits are still applied', async ({ page }) => {
    await bootNewUserWithPreview(page);
    await spyRaverUpdates(page);
    await page.evaluate(() => {
      toggleClaimEditForm(document.querySelector('.claim-edit-btn'));
      document.getElementById('claim-edit-name').value = 'Sammy R';
      return commitClaim();
    });
    const ups = await raverUpdates(page);
    expect(ups.some(u => u.name === 'Sammy R')).toBe(true);
    // Untouched fields aren't rewritten with their own values.
    expect(ups.some(u => 'handle' in u)).toBe(false);
  });
});

test.describe('first-time setup after an invite at boot', () => {
  test('a brand-new user who joins via crew link still gets onboarding', async ({ page }) => {
    const data = {
      ...EMPTY,
      __rpc: {
        get_crew_by_invite_token: CREW,
        join_crew_via_invite: { crew_id: 'c1', crew_name: 'Bass Syndicate', leader_id: 'someone-else' },
      },
    };
    await installSupabaseStub(page, { session: makeSession({ user_metadata: { onboarded: false } }), data });
    await page.goto('/app.html?join=inv-c1');
    await expect(page.locator('#crew-join-overlay')).toHaveClass(/open/);
    await page.fill('#crew-join-name', 'Nova');
    await page.evaluate(() => confirmJoinCrew());

    await expect(page.locator('#onboarding-screen')).toHaveClass(/show/, { timeout: 4000 });
  });

  test('"Maybe later" on a crew link still gets a brand-new user onboarded', async ({ page }) => {
    const data = { ...EMPTY, __rpc: { get_crew_by_invite_token: CREW } };
    await installSupabaseStub(page, { session: makeSession({ user_metadata: { onboarded: false } }), data });
    await page.goto('/app.html?join=inv-c1');
    await expect(page.locator('#crew-join-overlay')).toHaveClass(/open/);
    await page.evaluate(() => closeCrewJoinModal());

    await expect(page.locator('#onboarding-screen')).toHaveClass(/show/, { timeout: 4000 });
  });

  test('declining a claim preview at boot still gets a brand-new user onboarded', async ({ page }) => {
    const PREVIEW = { raver: { id: 'stub-1', name: 'Sam Rivera' }, crew: CREW };
    const data = { ...EMPTY, __rpc: { get_claim_preview: PREVIEW } };
    await installSupabaseStub(page, { session: makeSession({ user_metadata: { onboarded: false } }), data });
    await page.goto('/app.html?claim=tok-abc');
    await expect(page.locator('#sv-preview')).toHaveClass(/active/);
    await page.evaluate(() => closeScanner());

    await expect(page.locator('#onboarding-screen')).toHaveClass(/show/, { timeout: 4000 });
  });

  test('the crew leader is told who joined via the link', async ({ page }) => {
    const data = {
      ...EMPTY,
      __rpc: {
        get_crew_by_invite_token: CREW,
        join_crew_via_invite: { crew_id: 'c1', crew_name: 'Bass Syndicate', leader_id: 'leader-uid' },
      },
    };
    await installSupabaseStub(page, { session: makeSession({ user_metadata: { onboarded: false } }), data });
    await page.goto('/app.html?join=inv-c1');
    await expect(page.locator('#crew-join-overlay')).toHaveClass(/open/);
    await page.evaluate(() => {
      window.__leaderMsgs = [];
      const orig = window.dbAddNotification;
      window.dbAddNotification = (uid, crewId, msg, ...rest) => { window.__leaderMsgs.push(msg); return orig(uid, crewId, msg, ...rest); };
    });
    await page.fill('#crew-join-name', 'Nova');
    await page.evaluate(() => confirmJoinCrew());
    await expect.poll(() => page.evaluate(() => window.__leaderMsgs.join('|'))).toContain('Nova');
  });
});
