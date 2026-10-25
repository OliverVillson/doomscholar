// Renders $...$ LaTeX in abstracts with the vendored KaTeX. Loaded lazily;
// if it fails to load the raw text stays as it is.

const KATEX = new URL('../vendor/katex', import.meta.url).href;
let ready = null;

function load() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${KATEX}/katex.min.css`;
    document.head.append(css);
    const add = (src) => new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src; s.defer = true; s.onload = ok; s.onerror = fail;
      document.head.append(s);
    });
    add(`${KATEX}/katex.min.js`)
      .then(() => add(`${KATEX}/contrib/auto-render.min.js`))
      .then(() => resolve(window.renderMathInElement), () => resolve(null));
  });
  return ready;
}

export function renderMath(el) {
  if (!el || !/\$[^$]+\$/.test(el.textContent)) return;
  load().then((render) => {
    if (!render) return;
    try {
      render(el, {
        delimiters: [{ left: '$$', right: '$$', display: false }, { left: '$', right: '$', display: false }],
        throwOnError: false,
      });
    } catch {}
  });
}
