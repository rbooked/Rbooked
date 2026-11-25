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

module.exports = { lookupZip, milesBetween };
