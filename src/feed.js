// Full-screen vertical snap feed with infinite loading.
// Each card fires `feed:render` on window ({ detail: { card, paper } }) so
// features (likes, reader) can attach buttons without editing this file.

import { fetchPapers, CATEGORIES } from './arxiv.js';
import { renderMath } from './math.js';

const PAGE = 20;
const PREFETCH_AT = 5;          // load more when this many cards remain
const MIN_INTERVAL_MS = 3000;   // arXiv asks for ~1 request / 3 s
const CACHE_KEY = 'feed:cache:v1';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatAuthors(authors) {
  if (authors.length <= 4) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')} +${authors.length - 3} more`;
}

export function renderCard(paper) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = paper.id;
  card.innerHTML = `
    <div class="card__inner">
      <div class="card__meta">
        <span class="tag tag--primary">${esc(paper.primary)}</span>
        <time datetime="${esc(paper.published)}">${esc(formatDate(paper.published))}</time>
        <span class="card__id">${esc(paper.id)}</span>
      </div>
      <h2 class="card__title">${esc(paper.title)}</h2>
      <p class="card__authors">${esc(formatAuthors(paper.authors))}</p>
      <div class="card__abstract" tabindex="0">${esc(paper.summary)}</div>
      <button class="card__more" type="button" hidden>Show more</button>
      <div class="card__tags">${paper.categories.slice(0, 5).map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</div>
      <div class="card__actions">
        <a class="action-btn action-btn--link" href="${esc(paper.link)}" target="_blank" rel="noopener" aria-label="Open on arXiv">arXiv</a>
      </div>
    </div>`;
  return card;
}

export class Feed {
  constructor(root, { onStatus } = {}) {
    this.root = root;
    this.onStatus = onStatus || (() => {});
    this.papers = new Map();     // id -> paper, in feed order
    this.categories = [...CATEGORIES];
    this.start = 0;
    this.loading = false;
    this.done = false;
    this.lastFetch = 0;
    this.generation = 0;         // bumps on reset so stale responses are dropped

    this.status = document.createElement('div');
    this.status.className = 'feed__status';
    this.root.append(this.status);

    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.loadMore();
    }, { root: this.root, rootMargin: '0px 0px 200% 0px' });

    this.visibleIo = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const paper = this.papers.get(e.target.dataset.id);
        if (paper) window.dispatchEvent(new CustomEvent('feed:view', { detail: { card: e.target, paper } }));
      }
    }, { root: this.root, threshold: 0.6 });
  }

  setCategories(categories) {
    this.categories = categories.length ? categories : [...CATEGORIES];
    this.reset();
    return this.loadMore();
  }

  reset() {
    this.generation++;
    this.papers.clear();
    this.start = 0;
    this.done = false;
    this.loading = false;
    this.root.querySelectorAll('.card').forEach((c) => c.remove());
    this.root.scrollTop = 0;
  }

  cacheKey() { return `${CACHE_KEY}:${this.categories.join(',')}`; }

  // Show the last session's first page instantly (and offline), then refresh.
  restoreCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(this.cacheKey()) || 'null');
      if (cached?.papers?.length) { this.append(cached.papers); return true; }
    } catch {}
    return false;
  }

  saveCache() {
    try {
      localStorage.setItem(this.cacheKey(), JSON.stringify({ papers: [...this.papers.values()].slice(0, PAGE), at: Date.now() }));
    } catch {}
  }

  append(papers) {
    const fresh = papers.filter((p) => !this.papers.has(p.id));
    for (const paper of fresh) {
      this.papers.set(paper.id, paper);
      const card = renderCard(paper);
      this.root.insertBefore(card, this.status);
      window.dispatchEvent(new CustomEvent('feed:render', { detail: { card, paper } }));
      renderMath(card.querySelector('.card__title'));
      renderMath(card.querySelector('.card__abstract'));
      this.setupMore(card);
      this.visibleIo.observe(card);
    }
    this.observeTail();
    return fresh.length;
  }

  setupMore(card) {
    const abs = card.querySelector('.card__abstract');
    const btn = card.querySelector('.card__more');
    requestAnimationFrame(() => {
      if (abs.scrollHeight > abs.clientHeight + 4) btn.hidden = false;
    });
    btn.addEventListener('click', () => {
      const open = card.classList.toggle('card--expanded');
      btn.textContent = open ? 'Show less' : 'Show more';
    });
  }

  observeTail() {
    this.io.disconnect();
    const cards = this.root.querySelectorAll('.card');
    const target = cards[Math.max(0, cards.length - PREFETCH_AT)] || this.status;
    this.io.observe(target);
    this.io.observe(this.status);
  }

  async loadMore() {
    if (this.loading || this.done) return;
    this.loading = true;
    const gen = this.generation;
    const wait = this.lastFetch + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (gen !== this.generation) return;

    this.setStatus('loading', 'Loading papers…');
    try {
      this.lastFetch = Date.now();
      const { papers, total } = await fetchPapers({ categories: this.categories, start: this.start, max: PAGE });
      if (gen !== this.generation) return;
      const firstPage = this.start === 0 && this.papers.size === 0;
      this.start += PAGE;
      const added = this.append(papers);
      if (firstPage) this.root.scrollTo({ top: 0 });
      if (this.start === PAGE) this.saveCache();
      if (!papers.length || (total && this.start >= total)) this.done = true;
      this.setStatus(this.done ? 'end' : 'idle', this.done ? "You've reached the end." : '');
      this.loading = false;
      // Nothing new (all cached or a flaky empty page): fetch the next page.
      if (!added && !this.done) this.loadMore();
    } catch (err) {
      if (gen !== this.generation) return;
      this.loading = false;
      this.setStatus('error', 'Could not load papers. Check your connection.', true);
      console.error(err);
    }
  }

  setStatus(state, text, retry = false) {
    this.status.dataset.state = state;
    this.status.innerHTML = text ? `<p>${esc(text)}</p>` : '';
    if (retry) {
      const b = document.createElement('button');
      b.className = 'action-btn'; b.type = 'button'; b.textContent = 'Retry';
      b.onclick = () => this.loadMore();
      this.status.append(b);
    }
    this.onStatus(state);
  }
}
