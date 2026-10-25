// Full-paper reader: open one paper and scroll its full text, or doom-scroll a
// feed of full papers back to back. ES module, also exposed as window.Reader.
//
// Sources, tried in order per paper:
//   1. arXiv's native HTML (arxiv.org/html/{id}), papers from ~Dec 2023 on
//   2. ar5iv (ar5iv.labs.arxiv.org/html/{id}), older papers
//   3. The PDF rendered with pdf.js
//   4. Abstract + "Open PDF" link (Safari renders PDFs natively)
// arxiv.org sends no CORS headers, so fetches go direct, then through the
// same-origin proxy, then public CORS proxies. The one that works is remembered.

import * as Likes from './likes.js';

export const config = {
  proxies: [
    { name: 'direct', url: (u) => u },
    { name: 'proxy', url: (u) => `/api/arxiv?url=${encodeURIComponent(u)}` },
    { name: 'corsproxy', url: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
    { name: 'allorigins', url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  ],
  timeoutMs: 15000,
  pdfTimeoutMs: 40000,
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  keepPapersBehind: 2, // feed mode: older papers are collapsed to placeholders
};

const PROXY_KEY = 'reader:proxy';
const POS_KEY = 'mlscroll.readpos.v1';
const cache = new Map(); // id -> Promise<{kind, node|pdf, ...}>

// ---------- fetching ----------

function orderedProxies() {
  let pref = null;
  try { pref = localStorage.getItem(PROXY_KEY); } catch {}
  return pref ? [...config.proxies].sort((a, b) => (b.name === pref) - (a.name === pref)) : config.proxies;
}

class NotFound extends Error {}

/** Fetch `url` through the proxy chain. `validate(body)` must return true for a real response. */
async function fetchVia(url, { as = 'text', validate = () => true, timeout = config.timeoutMs } = {}) {
  const errors = [];
  let notFound = 0;
  for (const p of orderedProxies()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(p.url(url), { signal: ctrl.signal, redirect: 'follow' });
      if (res.status === 404) { notFound++; throw new Error('404'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = as === 'arrayBuffer' ? await res.arrayBuffer() : await res.text();
      if (!validate(body)) throw new Error('unexpected content');
      try { localStorage.setItem(PROXY_KEY, p.name); } catch {}
      return { body, finalUrl: p.name === 'direct' ? res.url : url };
    } catch (e) {
      errors.push(`${p.name}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (notFound >= 2) throw new NotFound(url);
  throw new Error(errors.join('; '));
}

// ---------- HTML (LaTeXML) ----------

const isLatexml = (html) => /ltx_document|ltx_page_content/.test(html) && !/No HTML for|conversion failed/i.test(html.slice(0, 4000));

function baseFor(doc, html, fallback) {
  const b = doc.querySelector('base[href]')?.getAttribute('href');
  if (b) return new URL(b, fallback).href;
  return fallback.endsWith('/') ? fallback : fallback + '/';
}

let uid = 0;

/** Turn a fetched arXiv/ar5iv page into a sanitized, mobile-friendly fragment. */
function extractArticle(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = baseFor(doc, html, pageUrl);
  const article = doc.querySelector('article.ltx_document') || doc.querySelector('.ltx_page_content') || doc.querySelector('.ltx_document');
  if (!article) throw new Error('no article');

  article.querySelectorAll(
    'script, style, link, meta, iframe, object, embed, form, input, button, noscript,' +
    '.ltx_page_header, .ltx_page_footer, .ltx_page_logo, .package-alerts, .ar5iv-footer, .ltx_role_affiliationtext + br'
  ).forEach((n) => n.remove());

  // The title/authors/abstract are rendered by our own paper header.
  article.querySelectorAll('h1.ltx_title_document, .ltx_authors, .ltx_dates').forEach((n) => n.remove());

  const prefix = `rp${++uid}-`;
  const abs = (v) => { try { return new URL(v, base).href; } catch { return null; } };

  for (const el of article.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || (/^(href|src|xlink:href)$/.test(n) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
    if (el.id) el.id = prefix + el.id;
  }
  article.querySelectorAll('img').forEach((img) => {
    const src = abs(img.getAttribute('src'));
    if (src) img.setAttribute('src', src);
    img.removeAttribute('srcset');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    img.removeAttribute('width');
    img.removeAttribute('height');
  });
  article.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      a.setAttribute('href', '#' + prefix + href.slice(1));
      a.dataset.local = '1';
    } else {
      const u = abs(href);
      if (u) { a.setAttribute('href', u); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    }
  });
  // Wide things scroll sideways instead of blowing out the page.
  article.querySelectorAll('table.ltx_equation, table.ltx_equationgroup, table.ltx_eqn_table, table.ltx_tabular, .ltx_tabular, math[display="block"], pre, .ltx_listing')
    .forEach((el) => {
      if (el.parentElement?.classList.contains('reader__scrollx') || el.closest('.reader__scrollx')) return;
      const wrap = doc.createElement('div');
      wrap.className = 'reader__scrollx';
      el.replaceWith(wrap);
      wrap.appendChild(el);
    });

  const frag = document.createElement('div');
  frag.className = 'reader__html ltx';
  frag.append(...[...article.childNodes].map((n) => document.importNode(n, true)));
  return frag;
}

async function loadHtml(id) {
  const sources = [`https://arxiv.org/html/${id}`, `https://ar5iv.labs.arxiv.org/html/${id}`];
  let lastErr;
  for (const url of sources) {
    try {
      const { body, finalUrl } = await fetchVia(url, { validate: isLatexml });
      return { kind: 'html', node: extractArticle(body, finalUrl), source: url };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---------- PDF (pdf.js) ----------

let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  pdfjsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = config.pdfjs;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdfjsWorker;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfjsPromise = null; reject(new Error('pdf.js failed to load')); };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

const isPdf = (buf) => {
  const b = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  return String.fromCharCode(...b).includes('%PDF');
};

async function loadPdf(paper) {
  const url = (paper.pdf || `https://arxiv.org/pdf/${paper.id}`).replace(/^http:/, 'https:');
  const [lib, { body }] = await Promise.all([
    loadPdfJs(),
    fetchVia(url, { as: 'arrayBuffer', validate: isPdf, timeout: config.pdfTimeoutMs }),
  ]);
  const pdf = await lib.getDocument({ data: new Uint8Array(body) }).promise;
  return { kind: 'pdf', pdf, source: url };
}

/** Lazily render PDF pages as the reader scrolls; frees far-away canvases (iOS caps canvas memory). */
async function mountPdf(container, pdf, scroller) {
  const wrap = document.createElement('div');
  wrap.className = 'reader__pdf';
  container.appendChild(wrap);
  const first = await pdf.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const slot = document.createElement('div');
    slot.className = 'reader__pdfpage';
    slot.style.aspectRatio = `${vp1.width} / ${vp1.height}`;
    slot.dataset.page = i;
    wrap.appendChild(slot);
    pages.push(slot);
  }
  const rendering = new Map();
  const render = async (slot) => {
    if (slot.firstChild || rendering.has(slot)) return;
    const n = Number(slot.dataset.page);
    const job = (async () => {
      const page = await pdf.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      slot.style.aspectRatio = `${vp0.width} / ${vp0.height}`;
      const cssW = slot.clientWidth || wrap.clientWidth || 360;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (cssW * dpr) / vp0.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (slot.dataset.visible === '1') slot.appendChild(canvas);
      else { canvas.width = canvas.height = 0; }
    })().catch((e) => console.warn('[reader] page render failed', e)).finally(() => rendering.delete(slot));
    rendering.set(slot, job);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const slot = e.target;
      if (e.isIntersecting) { slot.dataset.visible = '1'; render(slot); }
      else {
        slot.dataset.visible = '0';
        const c = slot.querySelector('canvas');
        if (c) { c.width = c.height = 0; c.remove(); }
      }
    }
  }, { root: scroller, rootMargin: '150% 0px' });
  pages.forEach((p) => io.observe(p));
  return () => io.disconnect();
}

// ---------- paper loading ----------

function loadContent(paper, { preferPdf = false } = {}) {
  const key = paper.id + (preferPdf ? ':pdf' : '');
  if (!cache.has(key)) {
    const p = (async () => {
      if (!preferPdf) {
        try { return await loadHtml(paper.id); } catch (e) { console.info('[reader] no HTML, trying PDF', e.message); }
      }
      return loadPdf(paper);
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    // Keep the cache small: rendered DOM and PDFs are heavy.
    while (cache.size > 6) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

/** Warm the cache for a paper (call when it is likely to be opened next). */
export function prefetch(paper) {
  loadContent(normalize(paper)).catch(() => {});
}

function normalize(paperOrId) {
  if (typeof paperOrId === 'string') {
    const id = Likes.normalizeId(paperOrId);
    return window.App?.papers?.get?.(id) || Likes.get(id) || { id, title: `arXiv:${id}`, authors: [], link: `https://arxiv.org/abs/${id}` };
  }
  return { ...paperOrId, id: Likes.normalizeId(paperOrId.id) };
}

// ---------- UI ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ICON_BACK = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function readPositions() {
  try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch { return {}; }
}
function savePosition(id, frac) {
  const all = readPositions();
  if (frac > 0.98) delete all[id]; else all[id] = Math.round(frac * 1000) / 1000;
  const keys = Object.keys(all);
  if (keys.length > 200) delete all[keys[0]];
  try { localStorage.setItem(POS_KEY, JSON.stringify(all)); } catch {}
}

let current = null; // the open reader session

/**
 * Open a single paper full-screen.
 * @param paperOrId paper object or arXiv id
 * @param opts.pdf  start in PDF mode
 */
export function open(paperOrId, opts = {}) {
  const paper = normalize(paperOrId);
  return mount({ queue: [paper], index: 0, feed: false, preferPdf: !!opts.pdf });
}

/**
 * Doom-scroll full papers back to back.
 * @param papers     array of papers (defaults to liked papers)
 * @param opts.start index to start at
 * @param opts.more  async () => papers[]  called when the list runs out
 */
export function openFeed(papers = Likes.all(), opts = {}) {
  // Start at opts.start and wrap around, so every paper in the list comes up.
  const start = Math.min(Math.max(0, opts.start || 0), Math.max(0, papers.length - 1));
  const queue = [...papers.slice(start), ...papers.slice(0, start)].map(normalize);
  if (!queue.length) return null;
  return mount({ queue, index: 0, feed: true, more: opts.more ?? defaultMore(queue), title: opts.title });
}

// When liked papers run out, keep going with abstracts already loaded in the main feed.
function defaultMore(queue) {
  return async () => {
    const seen = new Set(queue.map((p) => p.id));
    const pool = window.App?.papers ? [...window.App.papers.values()] : [];
    return pool.filter((p) => !seen.has(Likes.normalizeId(p.id))).slice(0, 10);
  };
}

export function close() {
  if (!current) return;
  if (history.state?.reader) history.back();
  else teardown();
}

export const isOpen = () => !!current;

function teardown() {
  if (!current) return;
  const s = current;
  current = null;
  s.cleanup.forEach((fn) => { try { fn(); } catch {} });
  s.root.classList.add('is-closing');
  const done = () => s.root.remove();
  s.root.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);
  document.documentElement.classList.remove('reader-open');
  window.dispatchEvent(new CustomEvent('reader:close'));
}

function mount({ queue, index, feed, preferPdf = false, more, title }) {
  if (current) teardown();

  const root = document.createElement('div');
  root.className = 'reader' + (feed ? ' reader--feed' : '');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <header class="reader__header">
      <div class="reader__bar">
        <button type="button" class="reader__back icon-btn" aria-label="Close">${ICON_BACK}</button>
        <div class="reader__heading">
          <div class="reader__title"></div>
          <div class="reader__sub"></div>
        </div>
      </div>
      <div class="reader__progress" style="--progress:0"></div>
    </header>
    <main class="reader__body"></main>
    <div class="reader__dock">
      <span class="reader__dock-like"></span>
      <span class="spacer"></span>
      <button type="button" class="btn btn--ghost reader__mode" hidden></button>
      <a class="btn btn--ghost reader__ext" target="_blank" rel="noopener">PDF ↗</a>
    </div>`;
  document.body.appendChild(root);
  document.documentElement.classList.add('reader-open');

  const s = {
    root, queue, feed, more, title,
    body: root.querySelector('.reader__body'),
    sections: [],
    active: null,
    cleanup: [],
    loadingNext: false,
    exhausted: false,
  };
  current = s;

  root.querySelector('.reader__back').addEventListener('click', close);
  root.querySelector('.reader__mode').addEventListener('click', () => {
    const sec = s.active;
    if (!sec?.show) return;
    sec.show(sec.mode === 'html');
    sec.el.scrollIntoView({ block: 'start' });
  });

  // Back gesture / back button closes the reader.
  history.pushState({ ...(history.state || {}), reader: true }, '');
  const onPop = () => { if (current === s) teardown(); };
  window.addEventListener('popstate', onPop);
  s.cleanup.push(() => window.removeEventListener('popstate', onPop));

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  s.cleanup.push(() => window.removeEventListener('keydown', onKey));

  // In-paper anchor links (citations, figure refs) scroll inside the reader.
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-local]');
    if (!a) return;
    const el = root.querySelector(`[id="${CSS.escape(a.getAttribute('href').slice(1))}"]`);
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  // Track which paper is in view and the reading progress.
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateProgress(s); });
  };
  root.addEventListener('scroll', onScroll, { passive: true });

  const firstSection = addPaper(s, queue[index], preferPdf);
  s.next = index + 1;
  setActive(s, firstSection);

  if (!feed) {
    const pos = readPositions()[queue[index].id];
    if (pos) firstSection.ready.then(() => requestAnimationFrame(() => {
      const top = firstSection.el.offsetTop;
      root.scrollTop = top + pos * Math.max(0, firstSection.el.offsetHeight - root.clientHeight);
    }));
  }

  if (feed) {
    const sentinel = document.createElement('div');
    sentinel.className = 'reader__sentinel';
    root.appendChild(sentinel);
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) appendNext(s); },
      { root, rootMargin: '0px 0px 150% 0px' });
    io.observe(sentinel);
    s.cleanup.push(() => io.disconnect());
  }

  window.dispatchEvent(new CustomEvent('reader:open', { detail: { paper: queue[index], feed } }));
  return s;
}

function addPaper(s, paper, preferPdf = false) {
  const el = document.createElement('section');
  el.className = 'reader__paper';
  el.dataset.id = paper.id;
  const authors = (paper.authors || []).join(', ');
  const date = paper.published ? new Date(paper.published).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const n = s.sections.length;
  el.innerHTML = `
    ${s.feed && n > 0 ? '<div class="reader__divider" aria-hidden="true"><span>Next paper</span></div>' : ''}
    <header class="reader__paperhead">
      <div class="reader__meta">${esc(paper.primary || paper.categories?.[0] || '')}${date ? ' · ' + esc(date) : ''} · <a href="https://arxiv.org/abs/${esc(paper.id)}" target="_blank" rel="noopener">arXiv:${esc(paper.id)}</a></div>
      <h1 class="reader__ptitle">${esc(paper.title)}</h1>
      ${authors ? `<p class="reader__authors">${esc(authors)}</p>` : ''}
      ${paper.summary ? `<details class="reader__abstract" ${s.feed ? '' : 'open'}><summary>Abstract</summary><p>${esc(paper.summary)}</p></details>` : ''}
    </header>
    <div class="reader__content"><div class="reader__loading" role="status"><span class="spinner"></span> Loading full paper…</div></div>`;
  s.body.appendChild(el);
  // $LaTeX$ in titles/abstracts, using the app's KaTeX loader when present.
  import('../src/math.js').then((m) => {
    m.renderMath(el.querySelector('.reader__ptitle'));
    m.renderMath(el.querySelector('.reader__abstract p'));
  }).catch(() => {});

  const pdfUrl = (paper.pdf || `https://arxiv.org/pdf/${paper.id}`).replace(/^http:/, 'https:');
  const section = { el, paper, mode: null, cleanup: null, ready: null, pdfUrl };
  const content = el.querySelector('.reader__content');

  const show = (pdfMode) => {
    section.cleanup?.();
    section.cleanup = null;
    content.innerHTML = `<div class="reader__loading" role="status"><span class="spinner"></span> ${pdfMode ? 'Loading PDF…' : 'Loading full paper…'}</div>`;
    section.mode = null;
    syncDock(s);
    section.ready = loadContent(paper, { preferPdf: pdfMode }).then(async (res) => {
      if (!el.isConnected) return;
      content.innerHTML = '';
      section.mode = res.kind;
      if (res.kind === 'html') {
        content.appendChild(res.node.cloneNode(true));
      } else {
        section.cleanup = await mountPdf(content, res.pdf, s.root);
      }
      section.htmlFailed = pdfMode ? section.htmlFailed : res.kind === 'pdf';
      el.dataset.mode = res.kind;
      syncDock(s);
    }).catch((e) => {
      console.warn('[reader] failed', paper.id, e);
      if (!el.isConnected) return;
      section.mode = 'error';
      el.dataset.mode = 'error';
      syncDock(s);
      content.innerHTML = `
        <div class="reader__error">
          <p>Couldn't load the full text here${navigator.onLine === false ? ' (you look offline)' : ''}.</p>
          <p><a class="btn btn--primary" href="${esc(pdfUrl)}" target="_blank" rel="noopener">Open the PDF</a>
             <button type="button" class="btn reader__retry">Try again</button></p>
        </div>`;
      content.querySelector('.reader__retry').addEventListener('click', () => show(pdfMode));
    });
    return section.ready;
  };
  section.show = show;
  show(preferPdf);

  s.sections.push(section);
  s.cleanup.push(() => section.cleanup?.());
  return section;
}

async function appendNext(s) {
  if (s.loadingNext || s.exhausted || current !== s) return;
  s.loadingNext = true;
  try {
    if (s.next >= s.queue.length && s.more) {
      const extra = (await s.more()) || [];
      const seen = new Set(s.queue.map((p) => p.id));
      s.queue.push(...extra.map(normalize).filter((p) => !seen.has(p.id)));
    }
    if (s.next >= s.queue.length) {
      s.exhausted = true;
      const end = document.createElement('div');
      end.className = 'reader__end';
      end.innerHTML = '<p>You reached the end. Go like some more abstracts.</p>';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = 'Back to the feed';
      b.addEventListener('click', close);
      end.appendChild(b);
      s.body.appendChild(end);
      return;
    }
    // Only append once the previous paper has something to scroll through.
    const last = s.sections[s.sections.length - 1];
    await Promise.race([last.ready?.catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
    if (current !== s) return;
    addPaper(s, s.queue[s.next++]);
    if (s.queue[s.next]) prefetch(s.queue[s.next]);
  } finally {
    s.loadingNext = false;
  }
}

function setActive(s, section) {
  if (s.active === section) return;
  s.active = section;
  const p = section.paper;
  s.root.querySelector('.reader__title').textContent = p.title || '';
  const i = s.sections.indexOf(section);
  s.root.querySelector('.reader__sub').textContent = s.feed
    ? `${s.title || 'Full papers'} · ${i + 1} of ${s.queue.length}${s.more && !s.exhausted ? '+' : ''}`
    : [p.primary || p.categories?.[0], (p.authors || [])[0] && `${p.authors[0]}${p.authors.length > 1 ? ' et al.' : ''}`].filter(Boolean).join(' · ');
  const like = s.root.querySelector('.reader__dock-like');
  like.replaceChildren(Likes.heartButton(p));
  syncDock(s);
  collapseFarBehind(s, i);
}

// Dock buttons act on the paper in view.
function syncDock(s) {
  const sec = s.active;
  if (!sec) return;
  const mode = s.root.querySelector('.reader__mode');
  const ext = s.root.querySelector('.reader__ext');
  ext.href = sec.pdfUrl;
  // Offer the switch only when there is something to switch to.
  const canToggle = sec.mode === 'html' || (sec.mode === 'pdf' && !sec.htmlFailed);
  mode.hidden = !canToggle;
  mode.textContent = sec.mode === 'html' ? 'View PDF' : 'View text';
}

// iOS kills tabs that hold too much; collapse papers well above the viewport.
function collapseFarBehind(s, activeIndex) {
  s.sections.forEach((sec, i) => {
    if (i >= activeIndex - config.keepPapersBehind || sec.collapsed) return;
    const h = sec.el.offsetHeight;
    sec.cleanup?.();
    sec.cleanup = null;
    sec.el.style.height = h + 'px';
    sec.el.classList.add('is-collapsed');
    sec.el.replaceChildren();
    sec.collapsed = true;
  });
}

function updateProgress(s) {
  const top = s.root.scrollTop;
  const vh = s.root.clientHeight;
  const mid = top + vh * 0.35;
  let active = s.sections[0];
  for (const sec of s.sections) { if (sec.el.offsetTop <= mid) active = sec; }
  if (active) setActive(s, active);
  const el = active.el;
  const span = Math.max(1, el.offsetHeight - vh);
  const frac = Math.min(1, Math.max(0, (top - el.offsetTop) / span));
  s.root.querySelector('.reader__progress').style.setProperty('--progress', frac.toFixed(4));
  if (!s.feed && active.mode && active.mode !== 'error') savePosition(active.paper.id, frac);
  // Warm the next paper when halfway through this one.
  if (s.feed && frac > 0.5 && s.queue[s.next]) prefetch(s.queue[s.next]);
}

const Reader = { open, openFeed, close, isOpen, prefetch, config };
window.Reader = Reader;
export default Reader;
