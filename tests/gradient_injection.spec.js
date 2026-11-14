const { test, expect } = require('@playwright/test');
const { bootAuthedApp, seedData } = require('./helpers');

// crews.gradient / ravers.gradient are plain text columns whose values normally
// come from preset maps, but a direct API write (a stub's creator has RLS to
// make one) could put a quote in them. They get interpolated into style=""
// attributes in ~18 places, so an unescaped quote closes the attribute and
// opens whatever comes next. safeGradient() is the safeColor() counterpart.

const HOSTILE = 'linear-gradient(135deg,#FF2D78,#BF00FF)" onmouseover="window.__pwned=1" data-x="';

test.describe('safeGradient', () => {
  test('accepts every shape the app actually generates', async ({ page }) => {
    await bootAuthedApp(page);
    const results = await page.evaluate(() => [
      safeGradient('linear-gradient(135deg,#FF2D78,#BF00FF)'),
      safeGradient('linear-gradient(90deg,#00F5FF,#0066FF)'),
      safeGradient('linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))'),
      safeGradient('radial-gradient(circle, #39FF14 0%, transparent 68%)'),
      safeGradient('linear-gradient(135deg,#00F5FF,#00F5FF88)'),
    ]);
    // None should have been swapped for the fallback.
    expect(results.every(r => !r.startsWith('linear-gradient(135deg,#FF2D78,#BF00FF)') || r === 'linear-gradient(135deg,#FF2D78,#BF00FF)')).toBe(true);
    expect(results[1]).toBe('linear-gradient(90deg,#00F5FF,#0066FF)');
    expect(results[2]).toBe('linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))');
    expect(results[3]).toBe('radial-gradient(circle, #39FF14 0%, transparent 68%)');
  });

  test('falls back on anything that could close the attribute', async ({ page }) => {
    await bootAuthedApp(page);
    const fallback = 'linear-gradient(135deg,#FF2D78,#BF00FF)';
    const results = await page.evaluate((hostile) => [
      safeGradient(hostile),
      safeGradient('red;" onload="alert(1)'),
      safeGradient('linear-gradient(135deg,#fff)</div><script>x</script>'),
      safeGradient(null),
      safeGradient(undefined),
      safeGradient(''),
      safeGradient('url(javascript:alert(1))'),
    ], HOSTILE);
    expect(results).toEqual(Array(7).fill(fallback));
  });
});

test.describe('hostile gradient cannot break out of a style attribute', () => {
  test('a crew with a hostile gradient renders inert', async ({ page }) => {
    const data = seedData();
    data.crews[0].gradient = HOSTILE;
    const errors = await bootAuthedApp(page, { data });

    // Open the crew so every gradient-bearing surface renders.
    await page.evaluate(() => openDetail('c1'));

    const pwned = await page.evaluate(() => window.__pwned);
    expect(pwned).toBeUndefined();

    // No element anywhere ended up with the injected handler.
    const injected = await page.evaluate(() =>
      document.querySelectorAll('[onmouseover*="__pwned"], [data-x]').length);
    expect(injected).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a raver with a hostile gradient renders inert', async ({ page }) => {
    const data = seedData();
    const sam = data.ravers.find(r => r.id === 'r-sam');
    sam.gradient = HOSTILE;
    const errors = await bootAuthedApp(page, { data });

    await page.evaluate(() => switchTab('members'));
    await page.evaluate(() => openProfile('r-sam'));

    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.evaluate(() =>
      document.querySelectorAll('[onmouseover*="__pwned"], [data-x]').length)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('the claim preview neutralises a hostile stub gradient', async ({ page }) => {
    const errors = await bootAuthedApp(page);

    await page.evaluate((hostile) => {
      document.getElementById('scanner-overlay').classList.add('open');
      showClaimPreview({
        raver: { id: 'stub-x', name: 'Hostile Stub', gradient: hostile },
        crew:  { id: 'c1', name: 'Bass Syndicate', color: '#FF2D78', status: 'recruiting', member_count: 2 },
      }, 'tok-x');
    }, HOSTILE);

    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.evaluate(() =>
      document.querySelectorAll('#preview-body [onmouseover], #preview-body [data-x]').length)).toBe(0);
    expect(errors).toEqual([]);
  });
});
