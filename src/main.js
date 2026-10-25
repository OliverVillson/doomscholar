// App boot: loads optional feature modules, wires the category chips,
// starts the feed and registers the service worker.

import { Feed } from './feed.js';
import { CATEGORIES } from './arxiv.js';

const CAT_KEY = 'feed:categories';

// Feature modules owned by sibling work (likes, full-paper reader). They are
// loaded before the first card renders so their `feed:render` listeners
// see every card. A missing module is fine.
const FEATURES = ['../features/likes.js', '../features/reader.js', '../features/hooks.js'];

async function loadFeatures() {
  const results = await Promise.allSettled(FEATURES.map((p) => import(p)));
  results.forEach((r, i) => { if (r.status === 'rejected') console.info(`feature not loaded: ${FEATURES[i]}`); });
}

function loadCategories() {
  try {
    const saved = JSON.parse(localStorage.getItem(CAT_KEY) || 'null');
    if (Array.isArray(saved)) return saved.filter((c) => CATEGORIES.includes(c));
  } catch {}
  return [];
}

function setupChips(feed, initial) {
  const bar = document.querySelector('.topbar__chips');
  let selected = new Set(initial);
  const paint = () => bar.querySelectorAll('.chip').forEach((chip) => {
    const c = chip.dataset.cat;
    const on = c === 'all' ? selected.size === 0 : selected.has(c);
    chip.classList.toggle('chip--active', on);
    chip.setAttribute('aria-pressed', String(on));
  });
  bar.innerHTML = ['all', ...CATEGORIES].map((c) =>
    `<button class="chip" type="button" data-cat="${c}">${c === 'all' ? 'All' : c}</button>`).join('');
  bar.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const c = chip.dataset.cat;
    if (c === 'all') selected.clear();
    else if (selected.has(c)) selected.delete(c);
    else selected.add(c);
    if (selected.size === CATEGORIES.length) selected.clear();
    paint();
    try { localStorage.setItem(CAT_KEY, JSON.stringify([...selected])); } catch {}
    feed.setCategories([...selected]);
  });
  paint();
}

async function boot() {
  const root = document.querySelector('.feed');
  const feed = new Feed(root, {
    onStatus: (state) => document.body.dataset.feedState = state,
  });
  window.App = Object.assign(window.App || {}, { feed, papers: feed.papers });

  await loadFeatures();
  const cats = loadCategories();
  setupChips(feed, cats);
  feed.categories = cats.length ? cats : [...CATEGORIES];
  // Last session's first page shows instantly (and offline); fresh papers
  // are fetched behind it and deduplicated.
  feed.restoreCache();
  feed.loadMore();
  window.dispatchEvent(new CustomEvent('app:ready', { detail: { feed } }));

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
