// Headless smoke test on an iPhone-sized viewport. arXiv responses are
// served from a generated fixture, so it runs without network access.
// Run: node server.js & node test/smoke.mjs
import { createRequire } from 'node:module';

// The preinstalled Playwright is resolved via require() so no install is needed.
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:5173/';

function atom(start, n) {
  const entries = Array.from({ length: n }, (_, i) => {
    const k = start + i;
    const id = `2410.${String(10000 + k)}`;
    return `<entry>
  <id>http://arxiv.org/abs/${id}v1</id>
  <updated>2024-10-2${k % 9}T12:00:00Z</updated><published>2024-10-2${k % 9}T12:00:00Z</published>
  <title>Paper ${k}: Scaling   laws for $\\mathcal{O}(n)$ attention</title>
  <summary>  We study things. ${'Long abstract sentence about transformers and gradients. '.repeat(k % 3 ? 4 : 20)}</summary>
  <author><name>Ada Lovelace</name></author><author><name>Alan Turing</name></author>
  <author><name>Grace Hopper</name></author><author><name>Yann LeCun</name></author><author><name>Fei-Fei Li</name></author>
  <link href="http://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/>
  <link title="pdf" href="http://arxiv.org/pdf/${id}v1" rel="related" type="application/pdf"/>
  <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/><category term="stat.ML" scheme="http://arxiv.org/schemas/atom"/>
</entry>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
<opensearch:totalResults>1000</opensearch:totalResults>
${entries}
</feed>`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const requests = [];
await page.route('https://export.arxiv.org/**', (route) => {
  const u = new URL(route.request().url());
  requests.push(u.search);
  const start = Number(u.searchParams.get('start'));
  route.fulfill({ status: 200, headers: { 'content-type': 'application/atom+xml', 'access-control-allow-origin': '*' }, body: atom(start, 20) });
});
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });

await page.goto(BASE);
await page.waitForSelector('.card');
const first = await page.$eval('.card', (c) => ({
  id: c.dataset.id, title: c.querySelector('.card__title').textContent,
  authors: c.querySelector('.card__authors').textContent, h: c.getBoundingClientRect().height,
}));
console.log('first card', first, 'viewport', page.viewportSize());
if (first.id !== '2410.10000') throw new Error('bad id');
if (Math.abs(first.h - page.viewportSize().height) > 2) throw new Error('card is not full screen');

await page.waitForSelector('.card .card__title .katex', { timeout: 5000 });
console.log('math rendered with KaTeX');

// Swipe down through the feed until a second page loads.
for (let i = 0; i < 18; i++) {
  await page.$eval('.feed', (f) => f.scrollBy(0, f.clientHeight));
  await page.waitForTimeout(150);
}
await page.waitForFunction(() => document.querySelectorAll('.card').length >= 40, null, { timeout: 10000 });
console.log('cards after scroll', await page.$$eval('.card', (c) => c.length), 'requests', requests.length);

// Category chip triggers a filtered reload.
await page.click('.chip[data-cat="cs.CV"]');
await page.waitForTimeout(3500);
await page.waitForSelector('.card');
const last = requests.at(-1);
console.log('after chip', decodeURIComponent(last));
if (!last.includes('cs.CV') || last.includes('cs.LG')) throw new Error('chip filter not applied');
const top = await page.$eval('.feed', (f) => f.scrollTop);
if (top !== 0) throw new Error(`feed did not return to top after filter (scrollTop ${top})`);

await page.screenshot({ path: process.env.SHOT || 'test/screenshot.png' });
await browser.close();
console.log('OK');
