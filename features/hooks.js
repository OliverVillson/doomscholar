// Wires likes + the full-paper reader into the app shell:
// heart / double-tap / "Read paper" on each feed card, the bottom tab bar
// (Feed, Liked), the Liked page and the "Saved to Liked" toast.
// Loaded by src/main.js (FEATURES) after likes.js and reader.js.

import * as Likes from './likes.js';
import * as Reader from './reader.js';

const ICONS = './design/icons/icons.svg';
const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#${name}"/></svg>`;

// ---------- feed cards ----------

/** Feed papers from `paper` onward, so "Read paper" doom-scrolls into the next ones. */
function feedFrom(paper) {
  const all = window.App?.papers ? [...window.App.papers.values()] : [paper];
  const i = all.findIndex((p) => p.id === paper.id);
  return i >= 0 ? all.slice(i, i + 10) : [paper];
}

// When the queue runs out, take later feed papers, asking the feed for more if needed.
function moreFromFeed(queued) {
  return async () => {
    const seen = new Set(queued.map((p) => p.id));
    const next = () => [...(window.App?.papers?.values() || [])].filter((p) => !seen.has(p.id)).slice(0, 10);
    let more = next();
    if (!more.length && window.App?.feed?.loadMore) {
      await window.App.feed.loadMore();
      more = next();
    }
    more.forEach((p) => { seen.add(p.id); queued.push(p); });
    return more;
  };
}

function openFromFeed(paper) {
  const list = feedFrom(paper);
  Reader.openFeed(list, { title: 'Full papers', more: moreFromFeed([...list]) });
}

function wireCard(card, paper) {
  const actions = card.querySelector('.card__actions');
  if (!actions || actions.querySelector('.like-btn')) return;
  actions.prepend(Likes.heartButton(paper));
  const read = document.createElement('button');
  read.type = 'button';
  read.className = 'btn btn--primary card__read';
  read.innerHTML = `${icon('read')}Read paper`;
  read.addEventListener('click', (e) => { e.stopPropagation(); openFromFeed(paper); });
  actions.append(read);
  Likes.attachDoubleTap(card, paper);
}

window.addEventListener('feed:render', (e) => wireCard(e.detail.card, e.detail.paper));
// Cards rendered before this module loaded (shouldn't happen, but cheap to cover).
document.querySelectorAll('.feed .card').forEach((card) => {
  const paper = window.App?.papers?.get(card.dataset.id);
  if (paper) wireCard(card, paper);
});

// Warm the full text of the card on screen, so "Read paper" opens fast.
let warmTimer = null;
window.addEventListener('feed:view', (e) => {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => Reader.prefetch(e.detail.paper), 1500); // only if the user lingers
});

// ---------- tab bar + Liked page ----------

const page = document.createElement('section');
page.className = 'page liked-page';
page.hidden = true;
page.setAttribute('aria-label', 'Liked papers');
document.body.appendChild(page);

Likes.renderList(page, {
  onRead: (p, i, list) => Reader.openFeed(list, { start: i, title: 'Liked' }),
  onReadAll: (list) => Reader.openFeed(list, { title: 'Liked' }),
});

const tabbar = document.createElement('nav');
tabbar.className = 'tabbar';
tabbar.setAttribute('role', 'tablist');
tabbar.setAttribute('aria-label', 'Sections');
tabbar.innerHTML = `
  <button class="tab" role="tab" type="button" data-tab="feed" aria-selected="true">${icon('feed')}Feed</button>
  <button class="tab tab--liked" role="tab" type="button" data-tab="liked" aria-selected="false">${icon('heart')}Liked</button>`;
document.body.appendChild(tabbar);

function show(tab) {
  const liked = tab === 'liked';
  page.hidden = !liked;
  document.body.dataset.tab = tab;
  tabbar.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  if (liked) page.scrollTop = 0;
}

tabbar.addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  // Tapping Feed while on Feed jumps back to the top, like native apps.
  if (t.dataset.tab === 'feed' && document.body.dataset.tab === 'feed') {
    document.querySelector('.feed')?.scrollTo({ top: 0, behavior: 'smooth' });
  }
  show(t.dataset.tab);
});
show('feed');

// ---------- toast ----------

let toastEl = null;
let toastTimer = null;
function toast(text) {
  toastEl?.remove();
  toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  toastEl.textContent = text;
  document.body.appendChild(toastEl);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl?.remove(); toastEl = null; }, 1600);
}

window.addEventListener('likes:change', (e) => {
  // The reader has its own heart in view; skip the toast there.
  if (e.detail.liked && !Reader.isOpen()) toast('Saved to Liked');
});
