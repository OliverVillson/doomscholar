// arXiv API client: builds queries, fetches through a chain of CORS-safe
// sources, and parses the Atom feed into plain paper objects.
//
// Paper shape (shared with features/ and design/):
//   { id, title, authors[], summary, published, updated, categories[],
//     primary, link, pdf }

export const CATEGORIES = ['cs.LG', 'cs.AI', 'cs.CL', 'cs.CV', 'stat.ML'];

const ARXIV = 'https://export.arxiv.org/api/query';
const SOURCE_KEY = 'arxiv:source';
const TIMEOUT_MS = 12000;

// Tried in order; the first one that works is remembered for next time.
const SOURCES = [
  { name: 'direct', url: (qs) => `${ARXIV}?${qs}` },
  // Same-origin proxy (api/arxiv.js on Vercel, or the Vite/dev server).
  { name: 'proxy', url: (qs) => `/api/arxiv?${qs}` },
  { name: 'corsproxy', url: (qs) => `https://corsproxy.io/?url=${encodeURIComponent(`${ARXIV}?${qs}`)}` },
  { name: 'allorigins', url: (qs) => `https://api.allorigins.win/raw?url=${encodeURIComponent(`${ARXIV}?${qs}`)}` },
];

export function buildQuery({ categories = CATEGORIES, start = 0, max = 20, search = '' } = {}) {
  const cats = categories.map((c) => `cat:${c}`).join(' OR ');
  let q = categories.length > 1 ? `(${cats})` : cats;
  if (search.trim()) q = `${q} AND all:${JSON.stringify(search.trim())}`;
  const params = new URLSearchParams({
    search_query: q,
    start: String(start),
    max_results: String(max),
    sortBy: 'submittedDate',
    sortOrder: 'descending',
  });
  return params.toString();
}

function orderedSources() {
  let preferred = null;
  try { preferred = localStorage.getItem(SOURCE_KEY); } catch {}
  if (!preferred) return SOURCES;
  return [...SOURCES].sort((a, b) => (b.name === preferred) - (a.name === preferred));
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('<feed')) throw new Error('not an Atom feed');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPapers(opts = {}) {
  const qs = buildQuery(opts);
  const errors = [];
  for (const source of orderedSources()) {
    try {
      const xml = await fetchText(source.url(qs));
      try { localStorage.setItem(SOURCE_KEY, source.name); } catch {}
      return parseFeed(xml);
    } catch (err) {
      errors.push(`${source.name}: ${err.message || err}`);
    }
  }
  throw new Error(`Could not reach arXiv (${errors.join('; ')})`);
}

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

// "http://arxiv.org/abs/2401.12345v2" -> "2401.12345"; old-style ids keep their slash.
export function parseId(absUrl) {
  return clean(absUrl).replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
}

export function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entries = [...doc.getElementsByTagName('entry')];
  const total = Number(doc.getElementsByTagName('opensearch:totalResults')[0]?.textContent
    ?? doc.getElementsByTagNameNS('*', 'totalResults')[0]?.textContent ?? 0);
  const papers = entries.map((e) => {
    const text = (tag) => e.getElementsByTagName(tag)[0]?.textContent ?? '';
    const id = parseId(text('id'));
    const links = [...e.getElementsByTagName('link')];
    const pdf = links.find((l) => l.getAttribute('title') === 'pdf')?.getAttribute('href')
      || `https://arxiv.org/pdf/${id}`;
    const primaryEl = e.getElementsByTagName('arxiv:primary_category')[0]
      || e.getElementsByTagNameNS('*', 'primary_category')[0];
    const categories = [...e.getElementsByTagName('category')].map((c) => c.getAttribute('term')).filter(Boolean);
    return {
      id,
      title: clean(text('title')),
      authors: [...e.getElementsByTagName('author')].map((a) => clean(a.getElementsByTagName('name')[0]?.textContent)),
      summary: clean(text('summary')),
      published: clean(text('published')),
      updated: clean(text('updated')),
      categories,
      primary: primaryEl?.getAttribute('term') || categories[0] || '',
      link: `https://arxiv.org/abs/${id}`,
      pdf: pdf.replace(/^http:/, 'https:'),
    };
  }).filter((p) => p.id && p.title && !/^Error$/i.test(p.title));
  return { papers, total };
}
