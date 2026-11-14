// Finding 20. sb.rpc() resolves with { data, error } rather than throwing, so a
// try/catch around it only ever catches a network-level failure — a PostgREST
// error (missing function, RLS denial) resolves normally. Both feedback flows
// wrapped the call in a catch, never read `error`, and rendered "thanks" BEFORE
// the call, so a response that never landed was reported as sent.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

/** Make one RPC fail the way PostgREST actually fails: resolved, not thrown. */
async function stubRpc(page, name, result) {
  await page.evaluate(([fn, res]) => {
    const real = sb.rpc.bind(sb);
    window.__rpcCalls = [];
    sb.rpc = (n, args) => {
      window.__rpcCalls.push(n);
      if (n === fn) return Promise.resolve(res);
      return real(n, args);
    };
  }, [name, result]);
}

test.describe('micro feedback · a failed submit is not reported as sent', () => {
  test('a resolved PostgREST error swaps the thanks message', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await stubRpc(page, 'submit_micro_feedback', { data: null, error: { message: 'permission denied' } });

    const text = await page.evaluate(async () => {
      const card = document.getElementById('micro-feedback-card');
      card.dataset.milestone = 'first_crew';
      card.dataset.question = 'how was it?';
      card.dataset.crewId = '';
      card.innerHTML = `<input id="micro-feedback-input" value="it was great">`;
      await submitMicroFeedback();
      return card.textContent;
    });

    expect(text).toContain("couldn't send");
    expect(text).not.toContain('thanks for the intel');
    expect(await page.evaluate(() => window.__rpcCalls)).toContain('submit_micro_feedback');
  });

  test('a successful submit still says thanks', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await stubRpc(page, 'submit_micro_feedback', { data: null, error: null });

    const text = await page.evaluate(async () => {
      const card = document.getElementById('micro-feedback-card');
      card.dataset.milestone = 'first_crew';
      card.dataset.question = 'how was it?';
      card.dataset.crewId = '';
      card.innerHTML = `<input id="micro-feedback-input" value="it was great">`;
      await submitMicroFeedback();
      return card.textContent;
    });

    expect(text).toContain('thanks for the intel');
    expect(text).not.toContain("couldn't send");
  });
});

test.describe('NPS · a failed submit is not reported as sent', () => {
  test('a resolved PostgREST error swaps the thanks message', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await stubRpc(page, 'submit_nps_response', { data: null, error: { message: 'permission denied' } });

    const text = await page.evaluate(async () => {
      const slot = document.getElementById('nps-prompt-slot');
      _npsPendingScore = 9;
      await submitNPS(false);
      return slot.textContent;
    });

    expect(text).toContain("couldn't send");
    expect(text).not.toContain('Thanks for the feedback');
  });

  test('a successful submit still says thanks', async ({ page }) => {
    await bootAuthedApp(page, { data: seedData() });
    await stubRpc(page, 'submit_nps_response', { data: null, error: null });

    const text = await page.evaluate(async () => {
      const slot = document.getElementById('nps-prompt-slot');
      _npsPendingScore = 9;
      await submitNPS(false);
      return slot.textContent;
    });

    expect(text).toContain('Thanks for the feedback');
    expect(text).not.toContain("couldn't send");
  });
});
