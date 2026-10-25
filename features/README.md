# Likes + full-paper reader

Plain ES modules, no build. Loaded by `src/main.js` (`FEATURES`).

| File | What it does |
| --- | --- |
| `likes.js` | Like store in `localStorage` (`mlscroll.likes.v1`, newest first, synced across tabs), heart button, double-tap-to-like with burst, Liked page. Fires `likes:change` `{paper, liked}` on `window`. |
| `reader.js` | Full-screen reader. `Reader.open(paperOrId)` for one paper, `Reader.openFeed(papers, {start, title, more})` to doom-scroll full papers back to back. |
| `hooks.js` | Wires it into the app: heart + "Read paper" on every card (`feed:render`), double-tap on cards, bottom tab bar (Feed / Liked), Liked page, "Saved to Liked" toast, prefetch of the card on screen. |
| `reader.css` | Layout for paper sections, arXiv HTML (LaTeXML) content, PDF pages, states. Look comes from `design/`. |
| `demo.html` | Standalone playground with three real arXiv papers (needs network). |

## Where the full text comes from

Per paper, in order: arXiv's own HTML (`arxiv.org/html/{id}`, most papers since late 2023), ar5iv (`ar5iv.labs.arxiv.org`, older papers), then the PDF rendered with pdf.js 3.11.174 from cdnjs, and finally an "Open the PDF" button (Safari's own viewer).

arxiv.org sends no CORS headers, so each fetch goes direct, then `/api/arxiv?url=…` (same-origin proxy), then corsproxy.io, then allorigins. The one that works is remembered (`reader:proxy`). Fetched HTML is sanitized (no scripts, styles, iframes, event handlers or `javascript:` links); images and links are made absolute, in-paper anchors scroll inside the reader. Equations are arXiv's MathML, which iOS Safari renders natively.

## iPhone details

- Double-tap uses pointer events with `touch-action: manipulation`, because iOS doesn't fire `dblclick` reliably and would zoom otherwise.
- The reader pushes a history entry, so the iOS back swipe / back button closes it.
- PDF pages render lazily at up to 2x DPR and far-away canvases are freed; in feed mode, papers more than two behind are collapsed to placeholders. iOS kills tabs that hold too much canvas/DOM memory.
- Reading position of single papers is saved (`mlscroll.readpos.v1`).

## Test

`node server.js & node test/features.mjs` (mocked arXiv, iPhone 13 viewport). Set `PDFJS_DIR=<pdfjs-dist@3.11.174>/build` to also render the PDF fallback offline.
