'use strict';
const express = require('express');
const { one, all, run } = require('../db');
const { getAvailability, findSlot } = require('../availability');
const { createReservation, cancelReservation, BookingError } = require('../reservations');
const { isBookable } = require('../billing');
const { lookupZip, milesBetween } = require('../geo');
const { nowInZone, toMin, zonedToUtc } = require('../time');
const email = require('../email');

const router = express.Router();

const PUBLIC_FIELDS = ['slug', 'name', 'cuisine', 'price_level', 'description', 'phone', 'address', 'city', 'state', 'zip',
  'lat', 'lng', 'timezone', 'image_url', 'max_party_size', 'booking_window_days', 'cancellation_policy', 'accent_color', 'tags', 'featured', 'website_url', 'logo_url', 'hours'];
const matcher = require('../../public/js/matcher');
const places = require('../../public/js/places');
// Diet tags also come from the menu: 3+ vegan dishes makes a restaurant show up for "vegan", and so on.
const MENU_DIET = ['vegan', 'vegetarian', 'gluten_free', 'halal'];
function menuStats(rid) {
  const counts = {};
  for (const m of all('SELECT tags FROM menu_items WHERE restaurant_id = ? AND available = 1', rid)) {
    for (const t of String(m.tags).split(',').filter(Boolean)) counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}
function publicRestaurant(r) {
  const out = Object.fromEntries(PUBLIC_FIELDS.map((k) => [k, r[k]]));
  const counts = menuStats(r.id);
  const tags = new Set(matcher.parseTags(r.tags));
  MENU_DIET.forEach((t) => { if ((counts[t] || 0) >= 3) tags.add(t); });
  out.tags = [...tags].join(',');
  out.menu_counts = counts;
  return out;
}

function getBookableRestaurant(slug) {
  const r = one('SELECT * FROM restaurants WHERE slug = ?', slug);
  if (!r) throw new BookingError('Restaurant not found.', 404);
  if (!isBookable(r)) throw new BookingError('This restaurant is not taking online reservations right now.', 403);
  return r;
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: status === 500 ? 'Something went wrong.' : e.message });
  }
};

/** Bookable restaurants near a ZIP, sorted by distance. */
async function nearby(zip, radius = 25) {
  const origin = await lookupZip(zip);
  let list = all('SELECT * FROM restaurants').filter(isBookable);
  if (origin) {
    list = list.map((r) => ({ r, miles: r.lat != null ? milesBetween(origin, r) : (r.zip === zip ? 0 : Infinity) }))
      .filter((x) => x.miles <= radius);
  } else {
    // Offline fallback: same 3-digit ZIP prefix.
    list = list.filter((r) => r.zip.slice(0, 3) === zip.slice(0, 3)).map((r) => ({ r, miles: r.zip === zip ? 0 : null }));
  }
  list.sort((a, b) => (a.miles ?? 999) - (b.miles ?? 999));
  return { origin, list: list.map((x) => ({ ...x, miles: x.miles == null ? null : Math.round(x.miles * 10) / 10 })) };
}
const dateFor = (q, r) => (/^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : nowInZone(r.timezone).date);
const openTimes = (r, date, party) => getAvailability(r, date, party).slots.filter((s) => s.available).map((s) => s.time);
function closest(times, wantTime, n = 5) {
  const target = toMin(wantTime);
  return times.slice().sort((a, b) => Math.abs(toMin(a) - target) - Math.abs(toMin(b) - target)).slice(0, n).sort();
}

router.get('/tags', (req, res) => res.json(matcher.TAGS));

// ZIP code search: nearby restaurants with times around the requested time.
router.get('/search', wrap(async (req, res) => {
  const zip = String(req.query.zip || '').trim();
  const party = Math.max(1, Math.min(20, Number(req.query.party) || 2));
  const wantTime = /^\d{2}:\d{2}$/.test(req.query.time || '') ? req.query.time : '19:00';
  const radius = Math.min(100, Number(req.query.radius) || 25);
  const q = String(req.query.q || '').trim().toLowerCase();
  const tag = String(req.query.tag || '');
  const cuisine = places.cuisine(req.query.cuisine);
  if (!/^\d{5}$/.test(zip)) throw new BookingError('Please enter a 5-digit ZIP code.');
  const { origin, list: near } = await nearby(zip, radius);
  let list = near;
  // Search matches the name, cuisine, or any dish on the menu ("tacos", "ramen"…).
  if (q) list = list.filter(({ r }) => `${r.name} ${r.cuisine}`.toLowerCase().includes(q)
    || all('SELECT name, section FROM menu_items WHERE restaurant_id = ? AND available = 1', r.id).some((m) => `${m.name} ${m.section}`.toLowerCase().includes(q)));
  if (tag) list = list.filter(({ r }) => matcher.parseTags(publicRestaurant(r).tags).includes(tag));
  if (cuisine) list = list.filter(({ r }) => r.cuisine === cuisine);
  const results = list.slice(0, 40).map(({ r, miles }) => {
    const date = dateFor(req.query.date, r);
    const av = getAvailability(r, date, party);
    const slots = closest(av.slots.filter((s) => s.available).map((s) => s.time), wantTime);
    return { ...publicRestaurant(r), miles, date, slots, closed: av.closed };
  });
  res.json({ origin: origin ? { city: origin.city, state: origin.state } : null, party, time: wantTime, results });
}));

// Featured restaurants, near a ZIP when one is given, with tonight's open times.
router.get('/featured', wrap(async (req, res) => {
  const zip = String(req.query.zip || '').trim();
  const party = Math.max(1, Math.min(20, Number(req.query.party) || 2));
  const wantTime = /^\d{2}:\d{2}$/.test(req.query.time || '') ? req.query.time : '19:00';
  // Featured restaurants first; then the newest ones, so the home page is never empty.
  const pool = /^\d{5}$/.test(zip) ? (await nearby(zip, 50)).list
    : all('SELECT * FROM restaurants ORDER BY id DESC').filter(isBookable).map((r) => ({ r, miles: null }));
  const list = [...pool.filter((x) => x.r.featured), ...pool.filter((x) => !x.r.featured).sort((a, b) => b.r.id - a.r.id)].slice(0, 6);
  res.json(list.slice(0, 12).map(({ r, miles }) => {
    const date = dateFor(req.query.date, r);
    return { ...publicRestaurant(r), miles, date, slots: closest(openTimes(r, date, party), wantTime, 3) };
  }));
}));

// "Pick for me": choose restaurants from a few quick choices + time + live availability.
router.get('/pick', wrap(async (req, res) => {
  const zip = String(req.query.zip || '').trim();
  if (!/^\d{5}$/.test(zip)) throw new BookingError('Please enter a 5-digit ZIP code.');
  const party = Math.max(1, Math.min(20, Number(req.query.party) || 2));
  const wantTime = /^\d{2}:\d{2}$/.test(req.query.time || '') ? req.query.time : '19:00';
  const prefs = matcher.parseTags(req.query.prefs);
  const price = Math.max(0, Math.min(4, Number(req.query.price) || 0));
  const cuisine = places.cuisine(req.query.cuisine);
  const { origin, list } = await nearby(zip, Math.min(100, Number(req.query.radius) || 25));
  const candidates = list.filter(({ r }) => !cuisine || r.cuisine === cuisine).map(({ r, miles }) => ({ restaurant: { ...r, tags: publicRestaurant(r).tags }, miles, slots: openTimes(r, dateFor(req.query.date, r), party) }));
  const ranked = matcher.rank(candidates, { prefs, price, time: wantTime }).slice(0, 5).map((m) => ({
    ...m, restaurant: { ...publicRestaurant(one('SELECT * FROM restaurants WHERE id = ?', m.restaurant.id)), date: dateFor(req.query.date, m.restaurant) },
  }));
  res.json({ origin: origin ? { city: origin.city, state: origin.state } : null, party, time: wantTime, prefs, price, picks: ranked });
}));

router.get('/restaurants/:slug', wrap(async (req, res) => {
  const r = getBookableRestaurant(req.params.slug);
  const shifts = all('SELECT name, days, start_time, end_time FROM shifts WHERE restaurant_id = ? AND active = 1 ORDER BY start_time', r.id);
  const menu = all(`SELECT id, section, name, description, price_cents, tags FROM menu_items
    WHERE restaurant_id = ? AND available = 1 ORDER BY sort_order, id`, r.id);
  res.json({ restaurant: publicRestaurant(r), shifts, menu, today: nowInZone(r.timezone).date });
}));

router.get('/restaurants/:slug/availability', wrap(async (req, res) => {
  const r = getBookableRestaurant(req.params.slug);
  const date = String(req.query.date || nowInZone(r.timezone).date);
  const av = getAvailability(r, date, Number(req.query.party) || 2);
  av.slots = av.slots.map(({ time, shiftName, available }) => ({ time, shiftName, available }));
  res.json(av);
}));

router.post('/restaurants/:slug/reservations', wrap(async (req, res) => {
  const r = getBookableRestaurant(req.params.slug);
  if (req.body.website) throw new BookingError('Invalid submission.'); // honeypot
  const source = req.body.source === 'widget' ? 'widget' : 'online';
  const created = createReservation(r, req.body, { source });
  res.status(201).json({ code: created.code, token: created.manage_token, date: created.date, time: created.time, party_size: created.party_size });
}));

// ---------- Guest manage-reservation endpoints (by secret token) ----------
function byToken(token) {
  const res = one('SELECT * FROM reservations WHERE manage_token = ?', String(token || ''));
  if (!res) throw new BookingError('Reservation not found.', 404);
  const r = one('SELECT * FROM restaurants WHERE id = ?', res.restaurant_id);
  return { res, r };
}
const guestView = (res, r) => ({
  code: res.code, status: res.status, date: res.date, time: res.time, party_size: res.party_size,
  guest_name: res.guest_name, guest_email: res.guest_email, guest_phone: res.guest_phone, notes: res.notes, occasion: res.occasion,
  restaurant: publicRestaurant(r),
  canChange: res.status === 'confirmed' && new Date(res.starts_at_utc) > new Date(),
});

router.get('/reservations/:token', wrap(async (req, res) => {
  const { res: rv, r } = byToken(req.params.token);
  res.json(guestView(rv, r));
}));

router.post('/reservations/:token/cancel', wrap(async (req, res) => {
  const { res: rv, r } = byToken(req.params.token);
  if (new Date(rv.starts_at_utc) < new Date()) throw new BookingError('This reservation has already started. Please call the restaurant.');
  const updated = cancelReservation(r, rv, 'guest');
  res.json(guestView(updated, r));
}));

router.post('/reservations/:token/modify', wrap(async (req, res) => {
  const { res: rv, r } = byToken(req.params.token);
  if (rv.status !== 'confirmed' || new Date(rv.starts_at_utc) < new Date()) throw new BookingError('This reservation can no longer be changed online.');
  const date = String(req.body.date || rv.date);
  const time = String(req.body.time || rv.time);
  const party = Number(req.body.party_size || rv.party_size);
  if (party > r.max_party_size) throw new BookingError(`For parties over ${r.max_party_size}, please call ${r.phone}.`);
  const slot = findSlot(r, date, time, party, { ignoreReservationId: rv.id });
  if (!slot) throw new BookingError('That time is not available. Please pick another.', 409);
  run(`UPDATE reservations SET date=?, time=?, party_size=?, table_id=?, combo_id=?, shift_id=?, duration_minutes=?, starts_at_utc=?,
       reminder_sent_at=NULL, updated_at=datetime('now') WHERE id=?`,
  date, time, party, slot.tableId, slot.comboId || null, slot.shiftId, slot.duration, zonedToUtc(date, time, r.timezone).toISOString(), rv.id);
  const updated = one('SELECT * FROM reservations WHERE id = ?', rv.id);
  email.sendReservationEmail('updated', r, updated).catch(() => {});
  res.json(guestView(updated, r));
}));

router.get('/reservations/:token/availability', wrap(async (req, res) => {
  const { res: rv, r } = byToken(req.params.token);
  const av = getAvailability(r, String(req.query.date || rv.date), Number(req.query.party) || rv.party_size, { ignoreReservationId: rv.id });
  av.slots = av.slots.map(({ time, shiftName, available }) => ({ time, shiftName, available }));
  res.json(av);
}));

module.exports = { router, wrap, publicRestaurant };
