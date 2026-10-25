# Doomscholar design layer

Owned by the UI/UX thread. Mockup: https://claude.ai/artifact/MZen6Zb3uC7CZmFnhg6nEu

## Files and load order (in index.html)

```html
<link rel="stylesheet" href="./design/tokens.css">     <!-- variables, dark + light -->
<link rel="stylesheet" href="./src/app.css">           <!-- structure (foundation) -->
<link rel="stylesheet" href="./design/components.css"> <!-- look of shell + feed -->
<link rel="stylesheet" href="./features/reader.css">   <!-- likes + reader behaviour -->
<link rel="stylesheet" href="./design/overrides.css">  <!-- look of likes + reader, LAST -->
```

- `icons/icon.svg` master app icon; `icon-192.png`, `icon-512.png` (also maskable), `apple-touch-icon.png` (180), `favicon-32.png`
- `icons/splash/` iOS launch images, see `splash-links.html` for the `<link>` tags
- `icons/icons.svg` UI icon sprite (24px, stroke). Inline: `<svg class="icon"><use href="./design/icons/icons.svg#heart"/></svg>`

## Look

- Dark by default (`#0A0A0C`), light follows the iOS setting. Force with `<html data-theme="light|dark">`.
- One loud color: `--like` (coral) for the heart, progress and Liked tab. `--accent` (periwinkle) for categories and links.
- UI type is SF Pro (`--font-sans`); abstracts and papers are New York (`--font-serif`, via `ui-serif`), 19px / 1.58. arXiv ids in `--font-mono`.
- 4-pt spacing (`--space-*`), 20px gutter, 44px minimum tap targets, safe-area insets on every edge (`--safe-*`).

## Component hooks

- Feed card: markup from `src/feed.js`. Actions row: icon buttons (`.action-btn`, label hidden) on the left, then `.btn.btn--primary` "Read paper" which is pushed right.
- Bottom nav: `<nav class="tabbar">` with `<button class="tab" aria-selected="true">` (Feed) and `<button class="tab tab--liked">` (Liked), each an icon (`#feed`, `#heart`) plus a label.
- Liked view: `.liked-list` inside a `.page` scroller.
- Like button: `.action-btn.like-btn[aria-pressed]`, `.is-popping` while animating. Double-tap: `.heart-burst.is-on` from likes.js.
- Reader: classes from features/reader.js; looks in overrides.css.
- Toast: `<div class="toast" role="status">Saved to Liked</div>`.

## Motion

Press = scale 0.94 (120 ms) as a stand-in for haptics, which iOS web apps can't trigger. Heart pop 320 ms spring. Double-tap burst 700 ms (heart, ring, six sparks). Reader slides up 320 ms. `prefers-reduced-motion` turns pops into fades.
