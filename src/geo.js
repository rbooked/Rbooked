'use strict';
const { one, run } = require('./db');

/**
 * Look up a US ZIP's coordinates. Uses a local cache table, then the free
 * zippopotam.us API. Returns null if the ZIP cannot be resolved (callers fall
 * back to ZIP-prefix matching).
 */
async function lookupZip(zip) {
  zip = String(zip || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip)) return null;
  const cached = one('SELECT * FROM zip_cache WHERE zip = ?', zip);
  if (cached) return cached;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const place = data.places && data.places[0];
    if (!place) return null;
    const row = { zip, lat: Number(place.latitude), lng: Number(place.longitude), city: place['place name'], state: place['state abbreviation'] };
    run('INSERT OR REPLACE INTO zip_cache (zip, lat, lng, city, state) VALUES (?,?,?,?,?)', row.zip, row.lat, row.lng, row.city, row.state);
    return row;
  } catch {
    return null;
  }
}

function milesBetween(a, b) {
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Put a restaurant's pin on its street address (not just the middle of its ZIP code), using the free
 * US Census geocoder (no key, no account). geo_addr remembers which address was looked up, so each
 * address is only looked up once; if the lookup fails the ZIP-code location stays in place.
 */
const addrLine = (r) => [r.address, r.city, `${r.state || ''} ${r.zip || ''}`.trim()].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
async function geocodeAddress(line, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(line)}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Rbooked/1.0' } });
    if (!res.ok) return undefined; // try again another time
    const data = await res.json();
    const m = data && data.result && data.result.addressMatches && data.result.addressMatches[0];
    if (!m || !m.coordinates) return null; // the address isn't known: don't keep asking
    const lat = Number(m.coordinates.y); const lng = Number(m.coordinates.x);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch { return undefined; } finally { clearTimeout(timer); }
}
async function ensureGeo(r) {
  const line = addrLine(r);
  if (!r || !r.address || !line || r.geo_addr === line) return r;
  const g = await geocodeAddress(line);
  if (g === undefined) return r;
  if (g) { r.lat = g.lat; r.lng = g.lng; run('UPDATE restaurants SET lat = ?, lng = ?, geo_addr = ? WHERE id = ?', g.lat, g.lng, line, r.id); }
  else run('UPDATE restaurants SET geo_addr = ? WHERE id = ?', line, r.id);
  r.geo_addr = line;
  return r;
}

module.exports = { lookupZip, milesBetween, geocodeAddress, ensureGeo, addrLine };
