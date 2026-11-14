const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

// A claim can land on the server while its response is lost to the network.
// The retry then gets "invalid_or_used_token", which used to tell the person
// who had just claimed the spot that it was already taken (REVIEW L9).
// The seeded user (r-you) is in crew c1, standing in for "the claim landed".

async function claimWith(page, results, crewId = 'c1') {
  await page.evaluate(({ results, crewId }) => {
    const orig = sb.rpc.bind(sb);
    const queue = results.slice();
    sb.rpc = (fn, args) => {
      if (fn === 'claim_and_merge_raver') return Promise.resolve(queue.shift());
      if (fn === 'get_claim_preview') {
        return Promise.resolve({ data: { raver: { id: 'stub-1', name: 'Sam' }, crew: { id: crewId, name: 'Bass Syndicate', status: 'recruiting' } }, error: null });
      }
      return orig(fn, args);
    };
    document.getElementById('scanner-overlay').classList.add('open');
  }, { results, crewId });
}

const NETWORK = { data: null, error: { message: 'Failed to fetch' } };
const USED = { data: { error: 'invalid_or_used_token' }, error: null };

test('a retry after a lost response shows success when the first claim landed', async ({ page }) => {
  await bootAuthedApp(page);
  await claimWith(page, [NETWORK, USED]);
  await page.evaluate(() => { _pendingClaimToken = 'tok-abc'; return commitClaim(); });
  await expect(page.locator('#sv-error')).toHaveClass(/active/);
  await page.evaluate(() => { _pendingClaimToken = 'tok-abc'; return commitClaim(); });
  await expect(page.locator('#claim-success-screen')).toHaveClass(/open/);
  expect(await page.evaluate(() => localStorage.getItem('pendingClaimToken'))).toBeNull();
});

test('without an earlier network failure, a used token still reads as taken', async ({ page }) => {
  await bootAuthedApp(page);
  await claimWith(page, [USED]);
  await page.evaluate(() => { _pendingClaimToken = 'tok-abc'; return commitClaim(); });
  await expect(page.locator('#sv-error')).toHaveClass(/active/);
  await expect(page.locator('#sv-error')).toContainText("This spot's taken");
  await expect(page.locator('#claim-success-screen')).not.toHaveClass(/open/);
});
