# Doomscholar

A TikTok-style feed of the newest ML papers from arXiv (cs.LG, cs.AI, cs.CL,
cs.CV, stat.ML). One abstract per full-screen card, swipe up for the next one,
endless. Built as a no-build PWA (plain ES modules), so it runs on iPhone
Safari and can be added to the home screen.

## Run locally

```sh
node server.js          # http://localhost:5173, no npm install needed
```

To try it on an iPhone, run that on a computer on the same Wi-Fi and open
`http://<computer-ip>:5173` in Safari. (The service worker only registers on
HTTPS, so offline mode needs a real deploy.)

Smoke test (headless iPhone 13 viewport, arXiv responses mocked):

```sh
node server.js & node test/smoke.mjs
```

## Deploy

Any static host works because the browser talks to arXiv itself. Vercel is
the recommended one because it also runs `api/arxiv.js` as a same-origin
proxy, which the app falls back to when a direct request fails.

- **Vercel:** `npx vercel` in this folder (or import it in the dashboard).
  No build command, output directory is the folder root.
- **Netlify / GitHub Pages / Cloudflare Pages:** upload the folder as is.
  `/api/arxiv` won't exist there, so the app uses the public CORS proxies.

After deploying, open the URL in Safari, tap Share, then "Add to Home Screen".

## Structure

```
index.html            app shell; loads design/tokens+components, src/app.css, features/reader.css, design/overrides.css (last)
manifest.webmanifest  PWA manifest (icons from design/icons/)
sw.js                 service worker: network-first, cached fallback offline. Bump VERSION on shell changes
server.js             zero-dependency dev server + /api/arxiv proxy
api/arxiv.js          proxy: ?search_query=… (arXiv API) or ?url=… (arxiv.org/ar5iv html|pdf|abs only)
src/main.js           boot: loads features/, category chips, starts the feed, registers SW
src/feed.js           snap feed, infinite loading, card markup, events
src/arxiv.js          query builder, CORS fallback chain, Atom parser
src/math.js           renders $…$ LaTeX with vendor/katex (lazy)
src/app.css           structural layout only (colors/type come from design/)
design/               UI/UX: tokens.css, components.css, icons/  (owned by the design work)
features/             likes + full-paper reader modules (owned by that work)
vendor/katex/         KaTeX 0.16.11 (MIT), woff2 fonts only
test/smoke.mjs        Playwright smoke test
```

## Contracts for features and design

**Paper object** (also in `window.App.papers`, a `Map` of id to paper, in feed order):

```js
{ id: '2410.12345',          // no version suffix
  title, authors: [..], summary, published, updated,
  categories: ['cs.LG', ..], primary: 'cs.LG',
  link: 'https://arxiv.org/abs/2410.12345', pdf: 'https://arxiv.org/pdf/2410.12345v1' }
```

**Events on `window`:**

- `feed:render` `{ card, paper }`: fired once per card right after it is
  inserted. Attach buttons into `card.querySelector('.card__actions')`.
- `feed:view` `{ card, paper }`: a card became the one on screen (60% visible).
- `app:ready` `{ feed }`: boot finished.

**Card markup** (`src/feed.js` `renderCard`):

```html
<article class="card" data-id="…">
  <div class="card__inner">
    <div class="card__meta"><span class="tag tag--primary">cs.LG</span><time>…</time><span class="card__id">2410.12345</span></div>
    <h2 class="card__title">…</h2>
    <p class="card__authors">…</p>
    <div class="card__abstract">…</div>
    <button class="card__more">Show more</button>   <!-- shown only if the abstract overflows -->
    <div class="card__tags"><span class="tag">…</span></div>
    <div class="card__actions"><a class="action-btn action-btn--link">arXiv</a></div>
  </div>
</article>
```

Other hooks: `.feed` (scroller), `.feed__status[data-state=loading|idle|error|end]`,
`.topbar`, `.topbar__chips`, `.chip`, `.chip--active`, `.card--expanded`,
`body[data-feed-state]`.

Feature modules listed in `FEATURES` in `src/main.js` are imported before the
first card renders; a missing file is skipped.

## arXiv access

`src/arxiv.js` tries, in order: arXiv directly, `/api/arxiv` (same origin),
corsproxy.io, allorigins. The first one that works is remembered in
`localStorage` (`arxiv:source`) and tried first next time. Requests are spaced
at least 3 s apart, as arXiv asks. The first page per category set is cached
in `localStorage` so the app opens instantly, also offline.
