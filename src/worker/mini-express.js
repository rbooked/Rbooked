'use strict';
// A small Express-compatible router for Cloudflare Workers. On Cloudflare, `require('express')`
// resolves here (see wrangler.jsonc "alias"), so the same route files run unchanged.
// It covers what Rbooked uses: app/Router .use/.get/.post/.put/.patch/.delete, path params,
// express.json/raw/static, and res.status/json/send/end/set/setHeader/type/sendStatus.

const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large', 429: 'Too Many Requests', 500: 'Internal Server Error' };

function compile(pattern) {
  const keys = [];
  const src = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:(\w+)/g, (m, k) => { keys.push(k); return '/([^/]+)'; });
  return { re: new RegExp(`^${src}/?$`), keys };
}

function Router() {
  const stack = [];
  const router = (req, res, next) => dispatch(stack, req, res, next);
  router.use = (...args) => {
    const paths = typeof args[0] === 'string' || Array.isArray(args[0]) ? [].concat(args.shift()) : ['/'];
    for (const p of paths) for (const fn of args) stack.push({ prefix: p === '/' ? '' : p.replace(/\/$/, ''), fn });
    return router;
  };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    router[m] = (path, ...fns) => { stack.push({ method: m.toUpperCase(), route: compile(path), fns }); return router; };
  }
  router.disable = () => router;
  router.set = () => router;
  return router;
}

function dispatch(stack, req, res, done) {
  let i = 0;
  const next = (err) => {
    if (err) { res.status(500).json({ error: 'Something went wrong.' }); console.error(err); return; }
    if (res.finished) return;
    const layer = stack[i++];
    if (!layer) { done(); return; }
    const path = req.path;
    try {
      if (layer.route) {
        if (layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) { next(); return; }
        const m = layer.route.re.exec(path);
        if (!m) { next(); return; }
        req.params = Object.fromEntries(layer.route.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]));
        let f = 0;
        const step = (e) => { if (e) { next(e); return; } const fn = layer.fns[f++]; if (!fn) { next(); return; } Promise.resolve(fn(req, res, step)).catch(next); };
        step();
        return;
      }
      if (layer.prefix && path !== layer.prefix && !path.startsWith(`${layer.prefix}/`)) { next(); return; }
      const saved = req.path;
      req.path = layer.prefix ? (path.slice(layer.prefix.length) || '/') : path;
      Promise.resolve(layer.fn(req, res, (e) => { req.path = saved; next(e); })).catch((e) => { req.path = saved; next(e); });
    } catch (e) { next(e); }
  };
  next();
}

class Res {
  constructor(onDone) { this.statusCode = 200; this.headers = new Headers(); this.body = null; this.finished = false; this.onDone = onDone; }
  status(c) { this.statusCode = c; return this; }
  setHeader(k, v) { if (k.toLowerCase() === 'set-cookie') this.headers.append(k, v); else this.headers.set(k, v); return this; }
  getHeader(k) { return this.headers.get(k); }
  set(obj) { for (const [k, v] of Object.entries(obj)) this.setHeader(k, v); return this; }
  type(t) { this.headers.set('Content-Type', t.includes('/') ? t : t === 'html' ? 'text/html; charset=utf-8' : `text/${t}`); return this; }
  json(o) { if (!this.headers.has('Content-Type')) this.headers.set('Content-Type', 'application/json; charset=utf-8'); return this.end(JSON.stringify(o)); }
  send(b) { if (typeof b === 'object' && b !== null && !(b instanceof Uint8Array)) return this.json(b); if (!this.headers.has('Content-Type')) this.headers.set('Content-Type', 'text/html; charset=utf-8'); return this.end(b); }
  redirect(a, b) { const [code, loc] = typeof a === 'number' ? [a, b] : [302, a]; this.statusCode = code; this.headers.set('Location', loc); return this.end(''); }
  sendStatus(c) { this.statusCode = c; return this.end(STATUS_TEXT[c] || String(c)); }
  end(b) { if (this.finished) return this; this.body = b ?? null; this.finished = true; this.onDone(); return this; }
}

const LIMIT = (l) => { const m = /^(\d+)(kb|mb)?$/i.exec(String(l || '100kb')); return m ? Number(m[1]) * (m[2] && m[2].toLowerCase() === 'mb' ? 1048576 : 1024) : 102400; };
// Bodies are read before routing (see handle); these keep Express's per-route size limits and raw bodies.
function json(opts = {}) {
  const max = LIMIT(opts.limit);
  return (req, res, next) => {
    if (req._bodyChecked) { next(); return; }
    req._bodyChecked = true;
    if (req.rawBody.length > max) { res.status(413).json({ error: 'That upload is too large.' }); return; }
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json') && req.rawBody.length) {
      try { req.body = JSON.parse(req.rawBody); } catch { res.status(400).json({ error: 'Invalid JSON.' }); return; }
    }
    next();
  };
}
const raw = () => (req, res, next) => { req._bodyChecked = true; req.body = Buffer.from(req.rawBody); next(); };
const serveStatic = () => (req, res, next) => next(); // Cloudflare serves /public as static assets

/** Run an Express-style app for one fetch Request and return a Response. */
async function handle(app, request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  const rawBody = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text();
  const req = {
    method: request.method, url: url.pathname + url.search, path: url.pathname, originalUrl: url.pathname + url.search,
    query: Object.fromEntries(url.searchParams), headers, rawBody, body: {}, params: {},
    ip: headers['cf-connecting-ip'] || headers['x-forwarded-for'] || '0.0.0.0', protocol: url.protocol.replace(':', ''),
    get: (k) => headers[k.toLowerCase()],
  };
  let resolve;
  const finished = new Promise((r) => { resolve = r; });
  const res = new Res(() => resolve(true));
  app(req, res, () => resolve(false));
  const handled = await finished;
  if (!handled) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  const body = request.method === 'HEAD' || [204, 304].includes(res.statusCode) ? null : res.body;
  return new Response(body, { status: res.statusCode, headers: res.headers });
}

function express() { return Router(); }
express.Router = Router;
express.json = json;
express.raw = raw;
express.static = serveStatic;
express.handle = handle;
module.exports = express;
