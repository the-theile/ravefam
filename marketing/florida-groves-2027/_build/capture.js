// Captures the Florida Groves 2027 campaign screens from the real Lineup Explorer
// page (logged out, picks seeded in localStorage). Serve the repo root on :8765 first
// (e.g. npx http-server -p 8765 -s .), then: node marketing/florida-groves-2027/_build/capture.js
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
const URL = 'http://localhost:8765/lineup-explorer/florida-groves-2027.html';
const PICKS = ['Of The Trees', 'Big Gigantic b2b Boogie T', 'Late Night Radio b2b Motifv', 'Moontricks', 'Know Good', 'SoDown'];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await ctx.route(/^https?:\/\/(?!localhost)/, r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.continue() : r.abort());
  await ctx.addInitScript(p => {
    localStorage.setItem('rf_picks', JSON.stringify({ 'florida-groves-2027': { n: p, t: 'Florida Groves 2027', at: '2026-11-11T00:00:00Z' } }));
    localStorage.setItem('rf_platform', 'spotify');
  }, PICKS);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForSelector('.act');
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.cta-bar, .lp-toast, .a2hs-btn, .lp-sheet, .lp-coach { display: none !important; } *, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'hero.png') });
  await page.evaluate(() => window.scrollTo(0, document.getElementById('count').getBoundingClientRect().top + scrollY - 12));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'deck.png') });
  await page.locator('.lp-f[data-v="picks"]').click();
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.lp-f[data-v="picks"]').getBoundingClientRect().top + scrollY - 70));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'picks.png') });
  await b.close();
})();
