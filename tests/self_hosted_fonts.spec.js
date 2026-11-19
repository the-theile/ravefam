// M10: app.html draws in self-hosted fonts (webfonts/) that the service worker
// precaches, so it never waits on fonts.googleapis.com and an offline cold
// start still renders the real fonts.
const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

const FACES = [
  ['DM Sans', 400], ['DM Sans', 700],
  ['Outfit', 400], ['Outfit', 900],
  ['Urbanist', 900], ['Fraunces', 800], ['Orbitron', 700], ['Courier Prime', 700],
];

async function loadFaces(page) {
  return page.evaluate(async faces => {
    const out = {};
    for (const [family, weight] of faces) {
      const loaded = await document.fonts.load(`${weight} 16px "${family}"`, 'Aa');
      out[`${family} ${weight}`] = loaded.length > 0;
    }
    return out;
  }, FACES);
}

test.describe('self-hosted fonts', () => {
  test.use({ serviceWorkers: 'block' });

  test('the app requests no Google Fonts and every family loads locally', async ({ page }) => {
    const external = [];
    page.on('request', r => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) external.push(r.url()); });
    const fontResponses = [];
    page.on('response', r => { if (r.url().includes('/webfonts/')) fontResponses.push([r.url().split('/webfonts/')[1], r.status()]); });

    await bootAuthedApp(page);
    const faces = await loadFaces(page);
    for (const [face, ok] of Object.entries(faces)) expect(ok, face).toBe(true);
    expect(external).toEqual([]);
    expect(fontResponses.length).toBeGreaterThan(0);
    for (const [file, status] of fontResponses) expect(status, file).toBe(200);
  });
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('after the service worker installs, an offline reload still has the real fonts', async ({ page, context }) => {
    await page.goto('/app.html');
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      return !!reg;
    });
    // Every precached font is in the worker's cache.
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const cache = await caches.open(keys.find(k => k.startsWith('ravefam-')));
      const reqs = await cache.keys();
      return reqs.map(r => new URL(r.url).pathname).filter(p => p.startsWith('/webfonts/'));
    });
    expect(cached).toEqual(expect.arrayContaining([
      '/webfonts/fonts.css', '/webfonts/dm-sans-latin-400-700.woff2', '/webfonts/outfit-latin-400-900.woff2',
    ]));
    expect(cached.length).toBe(8);

    await context.setOffline(true);
    await page.reload();
    const faces = await loadFaces(page);
    for (const [face, ok] of Object.entries(faces)) expect(ok, face).toBe(true);
    const outfit = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(outfit).toContain('DM Sans');
    await context.setOffline(false);
  });
});
