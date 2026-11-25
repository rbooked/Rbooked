'use strict';
// "Find your restaurant" at signup: looks the name up on OpenStreetMap (Nominatim), which is free and
// needs no API key or card. Returns address, phone, website, hours and cuisine when OSM has them.
const places = require('../public/js/places');

const FOOD = new Set(['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court', 'biergarten', 'ice_cream', 'bakery']);
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

// OSM opening_hours like "Mo-Fr 11:00-22:00; Sa,Su 12:00-23:00" → 7 days, Sunday first.
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

const pickTag = (t, ...keys) => { for (const k of keys) if (t && t[k]) return String(t[k]).split(';')[0].trim(); return ''; };
function fromNominatim(it) {
  const a = it.address || {}; const t = it.extratags || {};
  const iso = a['ISO3166-2-lvl4'] || '';
  const zip = String(a.postcode || '').slice(0, 5);
  const state = /^US-[A-Z]{2}$/.test(iso) ? iso.slice(3) : (places.stateForZip(zip) || '');
  let website = pickTag(t, 'website', 'contact:website', 'url');
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  return {
    osm: `${it.osm_type || ''}/${it.osm_id || ''}`,
    name: it.name || (it.display_name || '').split(',')[0],
    type: it.type || '',
    address: [a.house_number, a.road].filter(Boolean).join(' '),
    city: a.city || a.town || a.village || a.hamlet || a.suburb || '',
    state, zip,
    phone: pickTag(t, 'phone', 'contact:phone'),
    website_url: website,
    cuisine: mapCuisine(t.cuisine, it.type),
    hours: parseOsmHours(t.opening_hours),
    lat: Number(it.lat) || null, lng: Number(it.lon) || null,
    label: it.display_name || '',
  };
}

let lastCall = 0;
async function searchPlaces(name, near) {
  const q = `${String(name).trim()}${near ? ` ${String(near).trim()}` : ''}`.slice(0, 200);
  // Nominatim's free service allows about one request per second; space calls out.
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', extratags: '1', limit: '10', countrycodes: 'us' })}`;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Rbooked/1.0 (+https://rbooked.com)', 'Accept-Language': 'en' } });
    if (!r.ok) throw new Error(`lookup ${r.status}`);
    const rows = await r.json();
    return rows.filter((x) => FOOD.has(x.type) || x.category === 'amenity').map(fromNominatim).filter((x) => x.name).slice(0, 8);
  } finally { clearTimeout(timer); }
}

module.exports = { searchPlaces, fromNominatim, parseOsmHours, mapCuisine };
