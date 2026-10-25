// Optional same-origin proxy for arXiv (Vercel serverless function at
// /api/arxiv; also used by server.js). Only needed when the browser can't
// reach arXiv directly because of CORS.
//   /api/arxiv?search_query=...      -> export.arxiv.org/api/query (Atom feed)
//   /api/arxiv?url=<encoded URL>     -> passthrough for full-paper HTML/PDF,
//                                       limited to the hosts and paths below
const ALLOWED_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org', 'ar5iv.labs.arxiv.org', 'ar5iv.org']);
const ALLOWED_PATHS = /^\/(html|pdf|abs)\//;

function target(req) {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
  const raw = new URLSearchParams(query).get('url');
  if (!raw) return { url: `https://export.arxiv.org/api/query?${query}`, feed: true };
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!ALLOWED_HOSTS.has(u.hostname) || !ALLOWED_PATHS.test(u.pathname)) return null;
  u.protocol = 'https:';
  return { url: u.toString(), feed: false };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const t = target(req);
  if (!t) {
    res.statusCode = 400;
    return res.end('url not allowed');
  }
  try {
    const upstream = await fetch(t.url, { headers: { 'User-Agent': 'doomscholar/1.0' }, redirect: 'follow' });
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', t.feed
      ? 'application/atom+xml; charset=utf-8'
      : upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', t.feed ? 's-maxage=300, stale-while-revalidate=600' : 's-maxage=86400');
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.statusCode = 502;
    res.end(`arXiv unreachable: ${err.message}`);
  }
}
