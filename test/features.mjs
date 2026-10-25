// Headless test for likes + the full-paper reader on an iPhone viewport.
// arXiv (API, HTML, PDF) and the public CORS proxies are mocked.
// Run: node server.js & node test/features.mjs
// Optional: PDFJS_DIR=<pdfjs-dist@3.11.174>/build serves pdf.js locally to also test the PDF fallback.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:5173/';
const PDFJS_DIR = process.env.PDFJS_DIR;
const cors = { 'access-control-allow-origin': '*' };
const assert = (ok, msg) => { if (!ok) throw new Error(msg); console.log('  ok -', msg); };

function atom(start, n) {
  const entries = Array.from({ length: n }, (_, i) => {
    const id = `2410.${10000 + start + i}`;
    return `<entry><id>http://arxiv.org/abs/${id}v1</id><published>2024-10-21T12:00:00Z</published>
      <title>Paper ${start + i}</title><summary>Abstract ${start + i}. ${'Words about models. '.repeat(10)}</summary>
      <author><name>Ada Lovelace</name></author><link title="pdf" href="http://arxiv.org/pdf/${id}v1"/>
      <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG"/><category term="cs.LG"/></entry>`;
  }).join('');
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1000</opensearch:totalResults>${entries}</feed>`;
}

// LaTeXML-shaped page like arxiv.org/html/{id}.
function latexml(id) {
  const paras = Array.from({ length: 40 }, (_, k) =>
    `<div class="ltx_para"><p class="ltx_p">Paragraph ${k} of ${id}, see <a class="ltx_ref" href="#bib.bib1">[1]</a>. ${'Lorem ipsum dolor sit amet. '.repeat(6)}</p></div>`).join('');
  return `<!DOCTYPE html><html><head><base href="/html/${id}v1/"><script>window.__pwned = 1</script></head><body>
  <div class="ltx_page_content"><article class="ltx_document"><h1 class="ltx_title_document">T</h1>
  <section class="ltx_section" id="S1"><h2 class="ltx_title">1 Introduction</h2>${paras}
  <figure class="ltx_figure"><img src="x1.png" onerror="window.__pwned = 2"><figcaption class="ltx_caption">Figure 1</figcaption></figure>
  <table class="ltx_equation"><tr><td><math display="block"><mi>x</mi><mo>=</mo><mn>1</mn></math></td></tr></table>
  <a href="javascript:window.__pwned=3">x</a></section>
  <section class="ltx_bibliography"><ul><li class="ltx_bibitem" id="bib.bib1">Ref</li></ul></section></article></div></body></html>`;
}

// One-page PDF.
const PDF = (() => {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 36 Tf 72 700 Td (PDF fallback works) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
})();

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
page.on('dialog', (d) => { console.error('DIALOG', d.message()); process.exitCode = 1; d.dismiss(); });

await page.route('https://export.arxiv.org/**', (r) => r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/atom+xml' },
  body: atom(Number(new URL(r.request().url()).searchParams.get('start')), 20) }));
// Paper 2410.10001 has no HTML version, so it must fall back to the PDF.
await page.route(/https:\/\/(arxiv\.org|ar5iv\.labs\.arxiv\.org)\/.*/, (r) => {
  const u = r.request().url();
  if (u.endsWith('.png')) return r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  if (u.includes('/pdf/')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/pdf', body: PDF });
  const m = u.match(/\/html\/([\d.]+)/);
  if (m && m[1] !== '2410.10001' && u.startsWith('https://arxiv.org')) return r.fulfill({ status: 200, headers: cors, contentType: 'text/html', body: latexml(m[1]) });
  return r.fulfill({ status: 404, headers: cors, body: 'No HTML' });
});
await page.route(/corsproxy\.io|allorigins\.win/, (r) => r.fulfill({ status: 404, headers: cors, body: '' }));
if (PDFJS_DIR) {
  await page.route(/cdnjs\.cloudflare\.com\/.*pdf\.worker\.min\.js$/, (r) => r.fulfill({ contentType: 'text/javascript', body: readFileSync(`${PDFJS_DIR}/pdf.worker.min.js`) }));
  await page.route(/cdnjs\.cloudflare\.com\/.*pdf\.min\.js$/, (r) => r.fulfill({ contentType: 'text/javascript', body: readFileSync(`${PDFJS_DIR}/pdf.min.js`) }));
}

await page.goto(BASE);
await page.evaluate(() => localStorage.removeItem('mlscroll.likes.v1'));
await page.reload();
await page.waitForSelector('.card .like-btn');
console.log('feed cards');
assert(await page.$$eval('.card', (cs) => cs.every((c) => c.querySelector('.like-btn') && c.querySelector('.card__read'))), 'every card has a heart and Read paper');
assert(await page.locator('.tabbar .tab').count() === 2, 'tab bar has Feed and Liked');

console.log('double-tap to like');
const card = page.locator('.card').first();
const box = await card.boundingBox();
const x = box.x + box.width / 2, y = box.y + box.height * 0.45;
await page.touchscreen.tap(x, y);
await page.waitForTimeout(100);
await page.touchscreen.tap(x + 2, y + 2);
await page.waitForTimeout(100);
assert(await page.locator('.card').first().locator('.heart-burst').count() === 1, 'burst shows');
assert(await page.evaluate(() => Likes.isLiked('2410.10000')), 'double-tap liked the paper');
assert(await card.locator('.like-btn').getAttribute('aria-pressed') === 'true', 'card heart is filled');
assert(await page.locator('.toast').count() === 1, 'toast shows');
await page.touchscreen.tap(x, y);
await page.waitForTimeout(100);
await page.touchscreen.tap(x, y);
assert(await page.evaluate(() => Likes.isLiked('2410.10000')), 'second double-tap does not unlike');

console.log('heart button');
await page.$eval('.feed', (f) => f.scrollBy(0, f.clientHeight));
await page.waitForTimeout(400);
await page.locator('.card').nth(1).locator('.like-btn').tap();
assert(await page.evaluate(() => Likes.count()) === 2, 'heart button likes');
await page.locator('.card').nth(1).locator('.like-btn').tap();
assert(await page.evaluate(() => Likes.count()) === 1, 'heart button unlikes');
await page.locator('.card').nth(1).locator('.like-btn').tap();
await page.reload();
await page.waitForSelector('.card .like-btn');
assert(await page.evaluate(() => Likes.count()) === 2, 'likes survive reload');

console.log('Liked tab');
await page.locator('.tab--liked').tap();
assert(await page.locator('.liked-page').isVisible(), 'Liked page shows');
assert(await page.locator('.liked-item').count() === 2, 'Liked list has 2 papers');
assert((await page.locator('.liked-item__title').first().textContent()) === 'Paper 1', 'newest like first');
await page.screenshot({ path: 'test/features-liked.png' });

console.log('doom-scroll liked papers in full');
await page.locator('.liked-page__readall').tap();
// Newest like first: Paper 1 (2410.10001, no HTML -> PDF), then Paper 0 (HTML), then more from the feed.
const first = page.locator('.reader__paper').first();
await first.locator('.reader__pdf, .reader__error').first().waitFor({ timeout: 20000 });
const mode = await first.getAttribute('data-mode');
if (PDFJS_DIR) {
  assert(mode === 'pdf', `paper without HTML falls back to PDF (mode=${mode})`);
  await page.waitForSelector('.reader__pdfpage canvas', { timeout: 15000 });
  assert(true, 'PDF page rendered to canvas');
} else {
  assert(mode === 'pdf' || mode === 'error', `paper without HTML tries the PDF (mode=${mode}; set PDFJS_DIR to render it)`);
}
await page.screenshot({ path: 'test/features-pdf.png' });
for (let i = 0; i < 4; i++) { await page.$eval('.reader', (r) => r.scrollBy(0, 1200)); await page.waitForTimeout(200); }
await page.waitForSelector('.reader__html', { timeout: 15000 });
assert(true, 'next liked paper appended and loaded as HTML');
assert(await page.evaluate(() => window.__pwned === undefined), 'no script/handler from fetched HTML ran');
assert(await page.locator('.reader script, .reader [onerror]').count() === 0, 'fetched HTML is sanitized');
assert((await page.locator('.reader__html img').first().getAttribute('src')) === 'https://arxiv.org/html/2410.10000v1/x1.png', 'image URLs are absolute');
await page.locator('.reader__html').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/features-reader.png' });
for (let i = 0; i < 40; i++) { await page.$eval('.reader', (r) => r.scrollBy(0, 1500)); await page.waitForTimeout(150); }
await page.waitForFunction(() => document.querySelectorAll('.reader__paper').length >= 4, null, { timeout: 15000 });
assert(true, 'after the liked papers it keeps going with feed papers');
assert(await page.locator('.reader__paper.is-collapsed').count() >= 1, 'papers far behind are collapsed to save memory');
const progress = await page.$eval('.reader__progress', (p) => Number(p.style.getPropertyValue('--progress')));
assert(progress >= 0 && progress <= 1, 'progress bar updates');

console.log('close with back');
await page.goBack();
await page.waitForTimeout(500);
assert(await page.locator('.reader').count() === 0, 'back closes the reader');

console.log('Read paper from the feed');
await page.locator('.tabbar .tab').first().tap();
await page.locator('.card').first().locator('.card__read').tap();
await page.waitForSelector('.reader__html');
assert((await page.locator('.reader__title').textContent()) === 'Paper 0', 'reader opens the tapped paper');
await page.locator('.reader__back').tap();
await page.waitForTimeout(500);
assert(await page.locator('.reader').count() === 0, 'close button closes the reader');

await browser.close();
console.log(process.exitCode ? 'FAILED' : 'OK');
