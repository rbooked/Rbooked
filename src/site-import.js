'use strict';
// "Import from your website": reads a restaurant's own website and pulls out its name, address, phone, hours,
// cuisine, photos and menu, for the owner to review. Uses schema.org data (JSON-LD) when the site has it,
// then falls back to page meta tags and plain text.
const places = require('../public/js/places');

const CUISINE_MAP = {
  american: 'American', burger: 'Burgers', burgers: 'Burgers', bbq: 'Barbecue', barbecue: 'Barbecue', brazilian: 'Brazilian',
  breakfast: 'Breakfast & Brunch', brunch: 'Breakfast & Brunch', coffee_shop: 'Cafe', cafe: 'Cafe', cajun: 'Cajun & Creole', creole: 'Cajun & Creole',
  caribbean: 'Caribbean', jamaican: 'Caribbean', chinese: 'Chinese', cantonese: 'Chinese', szechuan: 'Chinese', sichuan: 'Chinese', dim_sum: 'Chinese',
  cuban: 'Cuban', ethiopian: 'Ethiopian', french: 'French', german: 'German', greek: 'Greek', halal: 'Halal', hawaiian: 'Hawaiian & Poke', poke: 'Hawaiian & Poke',
  indian: 'Indian', irish: 'Irish', italian: 'Italian', pasta: 'Italian', japanese: 'Japanese', korean: 'Korean', latin_american: 'Latin American',
  colombian: 'Latin American', salvadoran: 'Latin American', venezuelan: 'Latin American', lebanese: 'Lebanese', mediterranean: 'Mediterranean',
  mexican: 'Mexican', tex_mex: 'Mexican', tacos: 'Mexican', taco: 'Mexican', middle_eastern: 'Middle Eastern', falafel: 'Middle Eastern', kebab: 'Turkish',
  moroccan: 'Moroccan', peruvian: 'Peruvian', pizza: 'Pizza', ramen: 'Ramen & Noodles', noodle: 'Ramen & Noodles', noodles: 'Ramen & Noodles',
  seafood: 'Seafood', fish: 'Seafood', soul_food: 'Soul Food', southern: 'Southern', spanish: 'Spanish & Tapas', tapas: 'Spanish & Tapas',
  steak_house: 'Steakhouse', steakhouse: 'Steakhouse', sushi: 'Sushi', thai: 'Thai', turkish: 'Turkish', vegan: 'Vegan', vegetarian: 'Vegetarian',
  vietnamese: 'Vietnamese', pho: 'Vietnamese', wine_bar: 'Wine Bar', regional: 'American', diner: 'American', sandwich: 'American', chicken: 'American',
};
function mapCuisine(osm, type) {
  for (const c of String(osm || '').toLowerCase().split(/[;,]/).map((x) => x.trim().replace(/\s+/g, '_'))) if (CUISINE_MAP[c]) return CUISINE_MAP[c];
  if (type === 'cafe') return 'Cafe';
  if (type === 'pub' || type === 'bar') return 'Gastropub';
  return '';
}

// schema.org / OSM opening hours like "Mo-Fr 11:00-22:00; Sa,Su 12:00-23:00" → 7 days, Sunday first.
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function parseOsmHours(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  if (s === '24/7') return DAYS.map(() => ({ closed: false, open: '00:00', close: '23:59' }));
  const week = DAYS.map(() => ({ closed: true, open: '11:00', close: '22:00' }));
  let any = false;
  for (const rule of s.split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?\s*)+)?\s*(off|closed|(?:\d{1,2}:\d{2}-\d{1,2}:\d{2}\+?,?\s*)+)$/i.exec(rule);
    if (!m) continue; // public holidays, months, etc. are skipped
    const days = new Set();
    if (!m[1]) DAYS.forEach((_, i) => days.add(i));
    else for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const [a, b] = part.split('-').map((d) => DAYS.indexOf(d.slice(0, 2)));
      if (a < 0) continue;
      if (b === undefined || b < 0) days.add(a); else for (let i = a; ; i = (i + 1) % 7) { days.add(i); if (i === b) break; }
    }
    const spans = /off|closed/i.test(m[2]) ? [] : m[2].split(',').map((x) => x.trim().replace('+', '')).filter(Boolean).map((x) => x.split('-'));
    for (const d of days) {
      if (!spans.length) { week[d] = { closed: true, open: '11:00', close: '22:00' }; continue; }
      const pad = (t) => { const [h, mi] = t.split(':'); const hh = Number(h) % 24; return `${String(hh).padStart(2, '0')}:${mi}`; };
      const close = pad(spans[spans.length - 1][1]);
      week[d] = { closed: false, open: pad(spans[0][0]), close: close === '00:00' ? '23:59' : close };
      any = true;
    }
  }
  return any ? week : null;
}


// ---------- Fetching (public websites only) ----------
const MAX_PAGE = 3 * 1024 * 1024;
function safeUrl(u) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(String(u).trim()) ? String(u).trim() : `https://${String(u).trim()}`); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const h = url.hostname.toLowerCase();
  // Never fetch our own machine or private networks.
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') || /^(\d+\.){3}\d+$/.test(h) || h.includes(':')) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  return url;
}
async function fetchPublic(u, { accept = 'text/html,application/xhtml+xml', max = MAX_PAGE, timeout = 9000 } = {}) {
  let url = safeUrl(u); if (!url) throw new Error('That doesn’t look like a website address.');
  for (let hop = 0; hop < 4; hop++) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeout);
    let r;
    try {
      r = await fetch(url.href, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RbookedImporter/1.0; +https://rbooked.com)', Accept: accept } });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location')) { url = safeUrl(new URL(r.headers.get('location'), url).href); if (!url) throw new Error('That website redirects somewhere we can’t open.'); continue; }
    if (!r.ok) throw new Error(`The website answered with an error (${r.status}).`);
    const len = Number(r.headers.get('content-length') || 0); if (len > max) throw new Error('That page is too large to read.');
    const buf = new Uint8Array(await r.arrayBuffer()); if (buf.length > max) throw new Error('That page is too large to read.');
    return { url: url.href, type: (r.headers.get('content-type') || '').toLowerCase(), buf };
  }
  throw new Error('That website redirects too many times.');
}

// ---------- HTML helpers (no DOM on the server: small, careful regexes) ----------
const decode = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }[k] || m;
}).trim();
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? decode(m[2] ?? m[3] ?? m[4]) : ''; };
function meta(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0]; const k = (attr(t, 'property') || attr(t, 'name') || attr(t, 'itemprop')).toLowerCase();
    if (k === key) return attr(t, 'content');
  }
  return '';
}
/** Visible text with line breaks kept, for menus and addresses. */
function pageText(html) {
  return decode(html.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer|\/dt|\/dd|hr)\b[^>]*>/gi, '\n').replace(/<(td|th)\b[^>]*>/gi, '  ')
    .replace(/<(p|div|li|h[1-6]|tr|section|article|header|footer|dt|dd|ul|ol|table)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}
function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); out.push(...(Array.isArray(j) ? j : [j])); } catch { /* skip broken blocks */ }
  }
  const flat = [];
  const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(walk); return; } flat.push(o); if (o['@graph']) walk(o['@graph']); };
  out.forEach(walk);
  return flat;
}
const types = (o) => [].concat(o['@type'] || []).map((t) => String(t).toLowerCase());
const BIZ = /restaurant|foodestablishment|cafeorcoffeeshop|barorpub|bakery|fastfoodrestaurant|winery|brewery|localbusiness|icecreamshop/;
const first = (v) => (Array.isArray(v) ? v[0] : v);
const imgUrl = (v) => { v = first(v); return typeof v === 'string' ? v : v && (v.url || v.contentUrl) ? String(v.url || v.contentUrl) : ''; };

// schema.org openingHoursSpecification → 7 days.
const LONG_DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
function specHours(spec) {
  const list = [].concat(spec || []); if (!list.length) return null;
  const week = DAYS.map(() => ({ closed: true, open: '11:00', close: '22:00' })); let any = false;
  const hm = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
  for (const s of list) {
    const o = hm(s.opens); let c = hm(s.closes); if (!o || !c) continue;
    if (c === '00:00' || c === '24:00') c = '23:59';
    for (const d of [].concat(s.dayOfWeek || [])) {
      const i = LONG_DAYS[String(d).split('/').pop().toLowerCase()]; if (i === undefined) continue;
      week[i] = week[i].closed ? { closed: false, open: o, close: c } : { closed: false, open: week[i].open < o ? week[i].open : o, close: c };
      any = true;
    }
  }
  return any ? week : null;
}

// schema.org Menu (hasMenuSection / hasMenuItem) → menu items.
function ldMenu(menu) {
  const items = [];
  const price = (it) => { const o = first(it.offers) || {}; const p = o.price ?? o.lowPrice ?? it.price; return p === undefined || p === null ? '' : String(p).replace(/[^0-9.]/g, ''); };
  const diet = (it) => [].concat(it.suitableForDiet || []).map((d) => String(d).split('/').pop().toLowerCase())
    .map((d) => ({ vegandiet: 'vegan', vegetariandiet: 'vegetarian', glutenfreediet: 'gluten_free', halaldiet: 'halal' }[d])).filter(Boolean);
  const walk = (node, section) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, section)); return; }
    const t = types(node);
    if (t.includes('menuitem')) { if (node.name) items.push({ section: section || 'Menu', name: decode(node.name), description: decode(node.description || ''), price: price(node), tags: diet(node) }); return; }
    const sec = t.includes('menusection') && node.name ? decode(node.name) : section;
    walk(node.hasMenuSection, sec); walk(node.hasMenuItem, sec); walk(node.hasPart, sec);
  };
  walk(menu, '');
  return items;
}

/** Read a restaurant's website. Returns what we found; nothing is saved here. */
/** AI reading of a menu page's text when it's available; null means use the built-in reader. */
async function smartMenu(text) {
  const ai = require('./ai-menu'); if (!ai.available()) return null;
  const items = await ai.aiParseMenu(text);
  return items && items.length ? items : null;
}

async function importSite(input) {
  const menuParse = require('../public/js/menu-import');
  const page = await fetchPublic(input);
  if (!page.type.includes('html')) throw new Error('That link isn’t a web page. Paste your restaurant’s home page.');
  const html = new TextDecoder('utf-8').decode(page.buf);
  const base = new URL(page.url);
  const abs = (u) => { if (!u) return ''; try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
  const ld = jsonLd(html);
  const biz = ld.find((o) => types(o).some((t) => /restaurant|foodestablishment|cafeorcoffeeshop|barorpub|bakery|fastfoodrestaurant/.test(t))) || ld.find((o) => types(o).some((t) => BIZ.test(t))) || {};
  const addr = first(biz.address) || {};
  const out = { website_url: page.url, found: [] };

  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  out.name = decode(biz.name || '') || meta(html, 'og:site_name') || title.split(/\s[|–—-]\s/)[0].trim();
  out.description = (decode(biz.description || '') || meta(html, 'og:description') || meta(html, 'description')).slice(0, 600);
  if (typeof addr === 'object') {
    out.address = decode(addr.streetAddress || ''); out.city = decode(addr.addressLocality || '');
    out.state = decode(addr.addressRegion || '').toUpperCase(); out.zip = String(addr.postalCode || '').slice(0, 5);
  } else if (typeof addr === 'string') out.addressText = decode(addr);
  out.phone = decode(biz.telephone || '');
  const text = pageText(html);
  if (!out.phone) { const tel = /href\s*=\s*["']tel:([^"']+)["']/i.exec(html); out.phone = tel ? decode(tel[1]).replace(/^\+?1(?=\d{10}$)/, '') : ((/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.exec(text) || [])[0] || ''); }
  if (!out.address) {
    // "123 Main St, Springfield, IL 62701" written on the page.
    const m = /(\d{1,6}\s+[A-Za-z0-9.'\- ]{2,40}?\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pl|place|ct|court|hwy|highway|pkwy|parkway|sq|square|ter|terrace)\.?(?:\s*(?:#|suite|ste\.?|unit)\s*[\w-]+)?)[,\s]+([A-Za-z .'-]{2,30}),\s*([A-Z]{2})\s+(\d{5})/i.exec(`${out.addressText || ''}\n${text}`);
    if (m) { out.address = m[1].trim(); out.city = m[2].trim(); out.state = m[3].toUpperCase(); out.zip = m[4]; }
  }
  if (!places.STATE_CODES.has(out.state)) out.state = places.stateForZip(out.zip) || '';
  out.cuisine = places.cuisine(first(biz.servesCuisine)) || mapCuisine([].concat(biz.servesCuisine || []).join(';'), '');
  out.hours = specHours(biz.openingHoursSpecification) || parseOsmHours([].concat(biz.openingHours || []).join('; '));
  const pr = String(biz.priceRange || ''); out.price_level = /^\$+$/.test(pr) ? Math.min(4, pr.length) : null;

  // Photos: schema.org images, the share image, then large images on the page.
  const imgs = [];
  const add = (u) => { if (!u || !String(u).trim()) return; const a = abs(u); if (a && !/\.svg(\?|$)|sprite|icon|pixel|spacer|1x1|favicon/i.test(a) && !imgs.includes(a)) imgs.push(a); };
  [].concat(biz.image || []).forEach((x) => add(imgUrl(x)));
  add(meta(html, 'og:image')); add(meta(html, 'twitter:image'));
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (imgs.length >= 16) break;
    const t = m[0]; const w = Number(attr(t, 'width')) || 0;
    if (w && w < 200) continue;
    const src = attr(t, 'data-src') || attr(t, 'src') || (attr(t, 'srcset').split(',').pop() || '').trim().split(/\s+/)[0];
    if (src && !/^data:/.test(src)) add(src);
  }
  out.images = imgs.slice(0, 12);
  const logo = imgUrl(biz.logo) || (() => { for (const m of html.matchAll(/<img\b[^>]*>/gi)) { const t = m[0]; if (/logo/i.test(`${attr(t, 'class')} ${attr(t, 'alt')} ${attr(t, 'src')} ${attr(t, 'id')}`)) return attr(t, 'src'); } return ''; })();
  out.logo = abs(logo) || '';

  // Menu: schema.org menu on this page, then a "Menu" link (a page or a PDF).
  let menu = ldMenu(ld.filter((o) => types(o).includes('menu')).concat(biz.hasMenu && typeof biz.hasMenu === 'object' ? [biz.hasMenu] : []));
  out.menu_source = menu.length ? page.url : '';
  if (!menu.length) {
    const links = [];
    if (typeof biz.hasMenu === 'string') links.push(abs(biz.hasMenu)); if (typeof biz.menu === 'string') links.push(abs(biz.menu));
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(m[1], 'href'); const label = decode(m[2].replace(/<[^>]+>/g, ' '));
      if (href && (/\bmenus?\b/i.test(label) || /menu/i.test(href))) links.push(abs(href));
    }
    const seen = new Set();
    for (const link of links.filter(Boolean)) {
      if (seen.has(link) || seen.size >= 3) continue; seen.add(link);
      if (/\.pdf(\?|#|$)/i.test(link)) { out.menu_pdf = link; break; }
      if (new URL(link).hostname !== base.hostname) continue;
      try {
        const mp = await fetchPublic(link);
        if (mp.type.includes('pdf')) { out.menu_pdf = mp.url; break; }
        if (!mp.type.includes('html')) continue;
        const mh = new TextDecoder('utf-8').decode(mp.buf);
        menu = ldMenu(jsonLd(mh).filter((o) => types(o).includes('menu') || o.hasMenuSection));
        if (!menu.length) { const t = pageText(mh); menu = (await smartMenu(t)) || menuParse.parseText(t).filter((it) => it.price); }
        if (menu.length >= 3) { out.menu_source = mp.url; break; }
        const pdf = /href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i.exec(mh); if (pdf) { out.menu_pdf = abs(new URL(pdf[1], mp.url).href); break; }
      } catch { /* try the next link */ }
    }
  }
  if (!menu.length) { const here = menuParse.parseText(text).filter((it) => it.price); if (here.length >= 5) { menu = (await smartMenu(text)) || here; out.menu_source = page.url; } }
  out.menu = menu.slice(0, 300).map((it) => ({ ...it, tags: [...new Set([...(it.tags || []), ...menuParse.tagsFor(`${it.name} ${it.description}`)])] }));

  out.found = [out.name && 'name', out.address && 'address', out.phone && 'phone', out.hours && 'hours', out.cuisine && 'cuisine',
    out.description && 'description', out.images.length && `${out.images.length} photos`, out.menu.length && `${out.menu.length} dishes`, out.menu_pdf && 'a PDF menu'].filter(Boolean);
  delete out.addressText;
  return out;
}

/** Download a picture or PDF from a public site, for the owner's own import. */
async function fetchAsset(u, kind) {
  const isPdf = kind === 'pdf';
  const r = await fetchPublic(u, { accept: isPdf ? 'application/pdf' : 'image/*', max: isPdf ? 12 * 1024 * 1024 : 6 * 1024 * 1024, timeout: 12000 });
  const type = r.type.split(';')[0];
  if (isPdf ? !type.includes('pdf') && !(r.buf[0] === 0x25 && r.buf[1] === 0x50) : !/^image\/(jpeg|png|webp)$/.test(type)) throw new Error(isPdf ? 'That link isn’t a PDF.' : 'That picture isn’t a JPG, PNG or WebP.');
  return { type: isPdf ? 'application/pdf' : type, buf: r.buf };
}

module.exports = { importSite, fetchAsset, safeUrl, pageText, jsonLd, specHours, ldMenu, parseOsmHours, mapCuisine };
