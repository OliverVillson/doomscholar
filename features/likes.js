// Likes: persisted locally (localStorage), double-tap + heart button, Liked list view.
// ES module. Also exposed as window.Likes for convenience.
//
// Paper shape: {id, title, authors[], summary, published, categories[], link, pdf?, primary?}

const KEY = 'mlscroll.likes.v1';
const listeners = new Set();

export function normalizeId(id) {
  return String(id || '')
    .replace(/^https?:\/\/(export\.)?arxiv\.org\/(abs|pdf|html)\//, '')
    .replace(/\.pdf$/, '')
    .replace(/v\d+$/, '')
    .trim();
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

let items = load(); // newest first: [{...paper, likedAt}]

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch (e) {
    console.warn('[likes] could not persist', e);
  }
  emit();
}

function emit() {
  for (const fn of listeners) {
    try { fn(all()); } catch (e) { console.error(e); }
  }
}

// Keep tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key === KEY) { items = load(); emit(); }
});

function slim(paper) {
  const { id, title, authors, summary, published, categories, link, pdf, primary } = paper;
  return { id: normalizeId(id), title, authors, summary, published, categories, link, pdf, primary };
}

export function isLiked(id) {
  const n = normalizeId(id);
  return items.some((p) => p.id === n);
}

export function like(paper) {
  if (!paper || !paper.id || isLiked(paper.id)) return;
  const entry = { ...slim(paper), likedAt: Date.now() };
  items.unshift(entry);
  save();
  window.dispatchEvent(new CustomEvent('likes:change', { detail: { paper: entry, liked: true } }));
}

export function unlike(id) {
  const n = normalizeId(id);
  const removed = items.find((p) => p.id === n);
  if (!removed) return;
  items = items.filter((p) => p !== removed);
  save();
  window.dispatchEvent(new CustomEvent('likes:change', { detail: { paper: removed, liked: false } }));
}

/** Toggle like; returns the new liked state. */
export function toggle(paper) {
  if (isLiked(paper.id)) { unlike(paper.id); return false; }
  like(paper);
  return true;
}

export function all() { return items.slice(); }
export function count() { return items.length; }
export function get(id) { return items.find((p) => p.id === normalizeId(id)) || null; }

/** Subscribe to changes; returns an unsubscribe function. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function haptic() {
  try { navigator.vibrate?.(10); } catch { /* iOS ignores */ }
}

// ---------- UI helpers ----------
// Markup and class names follow design/components.css.

const HEART_PATH = 'M12 21s-6.7-4.35-9.33-8.36C.73 9.5 2.3 5 6.3 5c2.3 0 3.9 1.3 5.7 3.4C13.8 6.3 15.4 5 17.7 5c4 0 5.57 4.5 3.63 7.64C18.7 16.65 12 21 12 21z';
const HEART = `<svg class="icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="${HEART_PATH}"/></svg>`;

/** Heart button (.action-btn.like-btn, aria-pressed) that stays in sync with the store. */
export function heartButton(paper, { className = '' } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `action-btn like-btn ${className}`.trim();
  btn.innerHTML = HEART;
  const sync = () => {
    const liked = isLiked(paper.id);
    btn.setAttribute('aria-pressed', String(liked));
    btn.setAttribute('aria-label', liked ? 'Unlike' : 'Like');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (toggle(paper)) haptic();
  });
  sync();
  const off = onChange(sync);
  // Drop the listener when the button leaves the DOM (feed resets, list redraws).
  queueMicrotask(() => watchRemoval(btn, off));
  return btn;
}

const removalWatch = new Map();
let removalObserver = null;
function watchRemoval(el, cleanup) {
  removalWatch.set(el, cleanup);
  if (removalObserver) return;
  removalObserver = new MutationObserver(() => {
    for (const [node, fn] of removalWatch) {
      if (!node.isConnected) { fn(); removalWatch.delete(node); }
    }
  });
  removalObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Double-tap anywhere on `el` to like (never unlikes, like Instagram).
 * Works with touch on iOS (where dblclick is unreliable) and mouse on desktop.
 * Ignores taps on buttons/links and taps that turned into scrolls.
 */
export function attachDoubleTap(el, paper, { onLike } = {}) {
  el.style.touchAction = 'manipulation'; // no double-tap zoom, so both taps reach us
  let last = { t: 0, x: 0, y: 0 };
  let down = null;

  const interactive = (t) => t.closest?.('button, a, input, textarea, select, summary, [data-no-doubletap]');

  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => {
    if (!down || interactive(e.target)) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12;
    down = null;
    if (moved) { last.t = 0; return; }
    const now = performance.now();
    const close = Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40;
    if (now - last.t < 320 && close) {
      last.t = 0;
      e.preventDefault();
      if (!isLiked(paper.id)) { like(paper); haptic(); }
      burst(el, e.clientX, e.clientY);
      onLike?.(paper);
    } else {
      last = { t: now, x: e.clientX, y: e.clientY };
    }
  });
  el.addEventListener('pointercancel', () => { down = null; last.t = 0; });
}

/** Heart burst at a viewport point (centre if omitted): .heart-burst inside el + .is-bursting on el. */
export function burst(el, x, y) {
  el.querySelector(':scope > .heart-burst')?.remove();
  el.classList.remove('is-bursting');
  const rect = el.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'heart-burst';
  b.setAttribute('aria-hidden', 'true');
  b.innerHTML =
    `<svg class="heart-burst__heart" viewBox="0 0 24 24"><path d="${HEART_PATH}"/></svg>` +
    '<span class="heart-burst__ring"></span>' +
    '<span class="heart-burst__spark"></span>'.repeat(6);
  b.style.setProperty('--x', `${(x ?? rect.left + rect.width / 2) - rect.left}px`);
  b.style.setProperty('--y', `${(y ?? rect.top + rect.height / 2) - rect.top}px`);
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(b);
  void b.offsetWidth; // restart the animation on rapid repeats
  el.classList.add('is-bursting');
  clearTimeout(el._burstTimer);
  el._burstTimer = setTimeout(() => { b.remove(); el.classList.remove('is-bursting'); }, 750);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function authorLine(authors = []) {
  if (!authors.length) return '';
  return authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ');
}

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return isNaN(date) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Render the Liked page into `container` and keep it live.
 * opts.onRead(paper, index, list)  open a paper (the app opens a full-paper feed starting there)
 * opts.onReadAll(list)             doom-scroll every liked paper in full
 * Returns a function that stops live updates.
 */
export function renderList(container, { onRead, onReadAll } = {}) {
  container.classList.add('page', 'liked-page');

  const draw = () => {
    const list = all();
    container.innerHTML = `
      <h1 class="page__title">Liked</h1>
      <p class="page__sub">${list.length ? `${list.length} paper${list.length === 1 ? '' : 's'}` : ''}</p>`;

    if (!list.length) {
      container.insertAdjacentHTML('beforeend', `
        <div class="empty-state">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${HEART_PATH}"/></svg>
          <h2>Nothing liked yet</h2>
          <p>Double-tap an abstract or tap the heart to save it here. Then doom-scroll the full papers.</p>
        </div>`);
      return;
    }

    if (onReadAll) {
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = 'btn btn--primary liked-page__readall';
      allBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h11a3 3 0 013 3v12H7a3 3 0 01-3-3z"/><path d="M8 9h6M8 13h6"/></svg>Doom-scroll full papers';
      allBtn.addEventListener('click', () => onReadAll(all()));
      container.appendChild(allBtn);
    }

    const ul = document.createElement('ul');
    ul.className = 'liked-list';
    list.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'liked-item';
      li.dataset.id = p.id;
      li.innerHTML = `
        <button type="button" class="liked-item__body">
          <span class="liked-item__meta"><span class="tag tag--primary">${esc(p.primary || p.categories?.[0] || '')}</span>${p.published ? `<time>${esc(fmtDate(p.published))}</time>` : ''}</span>
          <span class="liked-item__title">${esc(p.title)}</span>
          <span class="liked-item__authors">${esc(authorLine(p.authors))}</span>
        </button>`;
      li.querySelector('.liked-item__body').addEventListener('click', () => onRead?.(p, i, list));
      li.appendChild(heartButton(p));
      ul.appendChild(li);
    });
    container.appendChild(ul);
  };

  draw();
  return onChange(draw);
}

const Likes = { normalizeId, isLiked, like, unlike, toggle, all, count, get, onChange, heartButton, attachDoubleTap, burst, renderList };
window.Likes = Likes;
export default Likes;
