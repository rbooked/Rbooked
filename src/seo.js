'use strict';
// Search-engine pages: /r/<slug> (a restaurant's page with its title, description and Google "Restaurant"
// details built in) and /sitemap.xml (every page Google should know about).
const express = require('express');
const config = require('./config');
const { one, all } = require('./db');
const { isBookable } = require('./billing');
const { parseHours, hashtag } = require('../public/js/matcher');
const OG_DEFAULT = '/img/og-rbooked.png';

const router = express.Router();

let template = null;
function restaurantTemplate() {
  if (template) return template;
  template = globalThis.__rbRestaurantHtml // Cloudflare: bundled into the worker as text
    || require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'restaurant.html'), 'utf8');
  return template;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abs = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `${config.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`);
const HEAD = '<title>Book a table · Rbooked</title>\n<meta name="description" content="Book a table online with Rbooked.">';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function jsonLd(r, url) {
  const ld = {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: r.name, url,
    description: r.description || undefined, telephone: r.phone || undefined, servesCuisine: r.cuisine || undefined,
    priceRange: r.price_level ? '$'.repeat(r.price_level) : undefined,
    image: r.image_url ? [abs(r.image_url)] : undefined, logo: r.logo_url ? abs(r.logo_url) : undefined,
    address: { '@type': 'PostalAddress', streetAddress: r.address, addressLocality: r.city, addressRegion: r.state, postalCode: r.zip, addressCountry: 'US' },
    acceptsReservations: 'True', keywords: hashtag(r.name) || undefined,
    potentialAction: { '@type': 'ReserveAction', target: { '@type': 'EntryPoint', urlTemplate: url, actionPlatform: ['http://schema.org/DesktopWebPlatform', 'http://schema.org/MobileWebPlatform'] }, result: { '@type': 'FoodEstablishmentReservation', name: 'Reserve a table' } },
  };
  if (r.lat && r.lng) ld.geo = { '@type': 'GeoCoordinates', latitude: r.lat, longitude: r.lng };
  const h = parseHours(r.hours);
  if (h) ld.openingHoursSpecification = h.map((d, i) => (d.closed ? null : { '@type': 'OpeningHoursSpecification', dayOfWeek: DAYS[i], opens: d.open, closes: d.close })).filter(Boolean);
  if (one('SELECT id FROM menu_items WHERE restaurant_id = ? AND available = 1 LIMIT 1', r.id)) ld.hasMenu = `${url}#menu`;
  return JSON.stringify(ld).replace(/</g, '\\u003c');
}

router.get('/r/:slug', (req, res) => {
  const r = one('SELECT * FROM restaurants WHERE slug = ?', String(req.params.slug));
  const html = restaurantTemplate();
  if (!r || !isBookable(r)) {
    return res.status(404).type('html').send(html.replace(HEAD, '<title>Restaurant not found · Rbooked</title>\n<meta name="robots" content="noindex">'));
  }
  const url = `${config.baseUrl}/r/${encodeURIComponent(r.slug)}`;
  const tag = hashtag(r.name);
  const title = `${r.name} · Book a table in ${r.city}, ${r.state} · Rbooked`;
  const desc = (r.description || `Book a table at ${r.name}, ${r.cuisine ? `${r.cuisine} ` : ''}restaurant in ${r.city}, ${r.state}. See the menu, photos and open times, and reserve online in seconds.`).replace(/\s+/g, ' ').slice(0, 150 - tag.length) + (tag ? ` ${tag}` : '');
  const img = abs(r.image_url) || abs(OG_DEFAULT);
  const head = `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="restaurant.restaurant"><meta property="og:site_name" content="Rbooked">
<meta property="og:title" content="${esc(r.name)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<script type="application/ld+json">${jsonLd(r, url)}</script>`;
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(html.replace(HEAD, head)
    .replace('<h1 id="r-name">Loading…</h1>', `<h1 id="r-name">${esc(r.name)}</h1>`));
});

// rbooked.com/tag/QueenMamasKitchen (or #QueenMamasKitchen typed on the home page) opens that restaurant.
router.get('/tag/:tag', (req, res) => {
  const want = String(req.params.tag || '').replace(/^#/, '').toLowerCase();
  const r = want && all('SELECT * FROM restaurants ORDER BY id').find((x) => isBookable(x) && hashtag(x.name).slice(1).toLowerCase() === want);
  res.redirect(r ? `/r/${encodeURIComponent(r.slug)}` : `/?tag=${encodeURIComponent(want)}`);
});

router.get('/sitemap.xml', (req, res) => {
  const pages = [{ loc: '/', freq: 'daily', pri: '1.0' }, { loc: '/for-restaurants', freq: 'weekly', pri: '0.6' }, { loc: '/terms', freq: 'yearly', pri: '0.2' }, { loc: '/privacy', freq: 'yearly', pri: '0.2' }];
  for (const r of all('SELECT * FROM restaurants ORDER BY id')) {
    if (isBookable(r)) pages.push({ loc: `/r/${encodeURIComponent(r.slug)}`, freq: 'daily', pri: '0.8', mod: String(r.created_at || '').slice(0, 10) });
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${esc(config.baseUrl + p.loc)}</loc><changefreq>${p.freq}</changefreq><priority>${p.pri}</priority></url>`).join('\n')}
</urlset>
`);
});

module.exports = router;
