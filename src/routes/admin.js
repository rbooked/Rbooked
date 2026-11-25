'use strict';
const express = require('express');
const { one, all, run, tx } = require('../db');
const { requireAuth } = require('../auth');
const { getAvailability, isSeatingFree } = require('../availability');
const { createReservation, cancelReservation, markNoShow, BookingError } = require('../reservations');
const billing = require('../billing');
const email = require('../email');
const config = require('../config');
const { lookupZip } = require('../geo');
const places = require('../../public/js/places');
const { nowInZone, zonedToUtc } = require('../time');
const { wrap } = require('./public');

const router = express.Router();
router.use(requireAuth);

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
function update(table, id, restaurantId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND restaurant_id = ?`,
    ...keys.map((k) => fields[k]), id, restaurantId);
}
const owned = (table, id, rid) => {
  const row = one(`SELECT * FROM ${table} WHERE id = ? AND restaurant_id = ?`, id, rid);
  if (!row) throw new BookingError('Not found.', 404);
  return row;
};

// ---------- Restaurant profile & settings ----------
const SETTINGS = ['name', 'cuisine', 'price_level', 'description', 'phone', 'email', 'address', 'city', 'state', 'zip', 'timezone',
  'image_url', 'max_party_size', 'booking_window_days', 'min_notice_minutes', 'reminder_hours', 'no_show_grace_minutes',
  'auto_no_show', 'send_no_show_email', 'cancellation_policy', 'accent_color', 'tags', 'turn_times', 'website_url', 'logo_url', 'hours'];
const { parseTags, parseTurns, formatTurns, parseMenuTags, parseHours } = require('../../public/js/matcher');

const isPlatformAdmin = (req) => config.platformAdmins.includes(String(req.user.email || '').toLowerCase());

// ---------- Rbooked staff: choose featured restaurants ----------
router.get('/platform/restaurants', wrap(async (req, res) => {
  if (!isPlatformAdmin(req)) throw new BookingError('Not allowed.', 403);
  res.json(all(`SELECT r.id, r.slug, r.name, r.cuisine, r.city, r.state, r.featured, r.created_at,
    (SELECT COUNT(*) FROM reservations x WHERE x.restaurant_id = r.id) AS reservations FROM restaurants r ORDER BY r.id DESC`));
}));
router.put('/platform/restaurants/:id', wrap(async (req, res) => {
  if (!isPlatformAdmin(req)) throw new BookingError('Not allowed.', 403);
  run('UPDATE restaurants SET featured = ? WHERE id = ?', req.body.featured ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
}));

// Owner starts over: everything about the restaurant is wiped and set up fresh. The login stays the same.
router.post('/account/reset', wrap(async (req, res) => {
  if (req.user.role !== 'owner') throw new BookingError('Only the owner can start over.', 403);
  const u = one('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!u || !require('../auth').verifyPassword(String(req.body.password || ''), u.password_hash)) throw new BookingError('That password is not right.', 401);
  const rid = req.restaurant.id;
  tx(() => {
    run('DELETE FROM email_log WHERE reservation_id IN (SELECT id FROM reservations WHERE restaurant_id = ?)', rid);
    for (const t of ['reservations', 'table_combos', 'guests', 'menu_items', 'gallery_photos', 'likes', 'images', 'closures', 'shifts', 'tables', 'areas']) run(`DELETE FROM ${t} WHERE restaurant_id = ?`, rid);
    run(`UPDATE restaurants SET name = 'My restaurant', cuisine = '', price_level = 2, description = '', phone = '', address = '', city = '',
      image_url = '', logo_url = '', website_url = '', hours = '', tags = '', accent_color = '#c2410c', featured = 0, trial_notice_sent = 0,
      turn_times = '2:90,4:120,6:180,99:210', trial_ends_at = ?, subscription_status = 'trialing' WHERE id = ?`,
    new Date(Date.now() + config.plan.trialDays * 86400000).toISOString(), rid);
    require('./auth').starterSetup(rid);
  });
  res.json({ ok: true });
}));

router.get('/restaurant', wrap(async (req, res) => {
  res.json({ restaurant: pick(req.restaurant, ['id', 'slug', 'featured', ...SETTINGS]), user: { ...req.user, platformAdmin: isPlatformAdmin(req) }, billing: billing.billingSummary(req.restaurant), baseUrl: config.baseUrl });
}));

router.put('/restaurant', wrap(async (req, res) => {
  const f = pick(req.body, SETTINGS);
  for (const k of ['price_level', 'max_party_size', 'booking_window_days', 'min_notice_minutes', 'reminder_hours', 'no_show_grace_minutes']) {
    if (f[k] !== undefined) f[k] = Math.max(0, Number(f[k]) || 0);
  }
  for (const k of ['auto_no_show', 'send_no_show_email']) if (f[k] !== undefined) f[k] = f[k] ? 1 : 0;
  if (f.tags !== undefined) f.tags = parseTags(Array.isArray(f.tags) ? f.tags.join(',') : f.tags).join(',');
  if (f.website_url !== undefined) {
    f.website_url = String(f.website_url).trim().slice(0, 300);
    if (f.website_url && !/^https?:\/\//i.test(f.website_url)) f.website_url = `https://${f.website_url}`;
    if (f.website_url && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(f.website_url)) throw new BookingError('Enter a valid website address.');
  }
  for (const k of ['image_url', 'logo_url']) {
    if (f[k] === undefined) continue;
    f[k] = String(f[k]).trim();
    // Photos come from the upload endpoint (/img/…) or an https link.
    if (f[k] && !/^(\/img\/\d+|https:\/\/[^\s"'()]+)$/.test(f[k]) && f[k] !== req.restaurant[k]) throw new BookingError('Upload a photo, or paste an https:// image link.');
  }
  if (f.hours !== undefined) { const h = f.hours ? parseHours(f.hours) : null; f.hours = h ? JSON.stringify(h) : ''; }
  if (f.turn_times !== undefined) f.turn_times = Array.isArray(f.turn_times) ? formatTurns(f.turn_times) : formatTurns(parseTurns(f.turn_times));
  if (f.cuisine !== undefined && f.cuisine !== req.restaurant.cuisine) {
    f.cuisine = places.cuisine(f.cuisine);
    if (!f.cuisine) throw new BookingError('Pick your cuisine from the list.');
  }
  if (f.state !== undefined) {
    f.state = String(f.state).trim().toUpperCase();
    if (!places.STATE_CODES.has(f.state)) throw new BookingError('Pick your state from the list.');
  }
  if (f.zip !== undefined && !/^\d{5}$/.test(String(f.zip).trim())) throw new BookingError('Enter a 5-digit ZIP code.');
  // The time zone follows the ZIP code; it isn't picked by hand.
  delete f.timezone;
  if ((f.zip && f.zip !== req.restaurant.zip) || (f.state && f.state !== req.restaurant.state)) {
    f.timezone = places.timezoneFor(f.zip || req.restaurant.zip, f.state || req.restaurant.state);
  }
  if (f.zip && f.zip !== req.restaurant.zip) {
    const g = await lookupZip(f.zip);
    if (g) { f.lat = g.lat; f.lng = g.lng; }
  }
  const keys = Object.keys(f);
  if (keys.length) run(`UPDATE restaurants SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), req.restaurant.id);
  res.json({ ok: true });
}));

// ---------- Reservations ----------
router.get('/reservations', wrap(async (req, res) => {
  const r = req.restaurant;
  const from = String(req.query.from || req.query.date || nowInZone(r.timezone).date);
  const to = String(req.query.to || from);
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows = all(`SELECT res.*, COALESCE(t.label, c.name) AS table_label, g.tags AS guest_tags, g.notes AS guest_notes
                  FROM reservations res LEFT JOIN tables t ON t.id = res.table_id LEFT JOIN table_combos c ON c.id = res.combo_id
                  LEFT JOIN guests g ON g.id = res.guest_id
                  WHERE res.restaurant_id = ? AND res.date BETWEEN ? AND ? ORDER BY res.date, res.time`, r.id, from, to);
  if (q) rows = rows.filter((x) => `${x.guest_name} ${x.guest_email} ${x.guest_phone} ${x.code}`.toLowerCase().includes(q));
  // Guest history: visits & no-shows by email
  const history = {};
  for (const e of new Set(rows.map((x) => x.guest_email))) {
    history[e] = one(`SELECT SUM(status='completed' OR status='seated') AS visits, SUM(status='no_show') AS no_shows
                      FROM reservations WHERE restaurant_id = ? AND guest_email = ?`, r.id, e);
  }
  rows.forEach((x) => { x.history = history[x.guest_email]; });
  res.json({ from, to, reservations: rows });
}));

router.get('/stats', wrap(async (req, res) => {
  const r = req.restaurant;
  const date = String(req.query.date || nowInZone(r.timezone).date);
  const s = one(`SELECT COUNT(*) AS bookings,
      SUM(CASE WHEN status IN ('confirmed','seated','completed') THEN party_size ELSE 0 END) AS covers,
      SUM(status='confirmed') AS upcoming, SUM(status='seated') AS seated, SUM(status='completed') AS completed,
      SUM(status='cancelled') AS cancelled, SUM(status='no_show') AS no_shows
    FROM reservations WHERE restaurant_id = ? AND date = ?`, r.id, date);
  const seats = one('SELECT COUNT(*) AS tables, COALESCE(SUM(max_seats),0) AS seats FROM tables WHERE restaurant_id = ? AND active = 1', r.id);
  res.json({ date, ...s, ...seats });
}));

router.get('/availability', wrap(async (req, res) => {
  const date = String(req.query.date || nowInZone(req.restaurant.timezone).date);
  res.json(getAvailability(req.restaurant, date, Number(req.query.party) || 2, { admin: true, ignoreReservationId: Number(req.query.ignore) || 0 }));
}));

router.post('/reservations', wrap(async (req, res) => {
  const source = ['phone', 'walk_in', 'admin'].includes(req.body.source) ? req.body.source : 'phone';
  const body = { ...req.body };
  if (source === 'walk_in') {
    const now = nowInZone(req.restaurant.timezone);
    body.date = body.date || now.date;
    body.time = body.time || `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`;
    body.email = body.email || 'walkin@guest.local';
    body.phone = body.phone || '0000000';
    body.name = body.name || 'Walk-in';
  }
  body.send_email = req.body.send_email !== false && source !== 'walk_in';
  const created = createReservation(req.restaurant, body, { source, admin: true });
  res.status(201).json(created);
}));

router.patch('/reservations/:id', wrap(async (req, res) => {
  const r = req.restaurant;
  const rv = owned('reservations', req.params.id, r.id);
  const f = pick(req.body, ['guest_name', 'guest_email', 'guest_phone', 'notes', 'internal_notes', 'occasion', 'party_size', 'table_id', 'combo_id', 'date', 'time', 'duration_minutes', 'status']);
  if (f.status && !['confirmed', 'seated', 'completed'].includes(f.status)) throw new BookingError('Use the cancel / no-show actions for that status.');
  // A reservation sits at one table OR one combination.
  if (f.combo_id) f.table_id = null; else if (f.table_id !== undefined) f.combo_id = null;
  const moved = ['table_id', 'combo_id', 'date', 'time', 'duration_minutes'].some((k) => f[k] !== undefined && String(f[k]) !== String(rv[k]));
  const next = { ...rv, ...f };
  if (moved && (next.table_id || next.combo_id)) {
    if (next.combo_id) owned('table_combos', next.combo_id, r.id); else owned('tables', next.table_id, r.id);
    if (!req.body.force && !isSeatingFree(r.id, { tableId: next.table_id, comboId: next.combo_id }, next.date, next.time, Number(next.duration_minutes), rv.id)) {
      throw new BookingError('That table is already booked around that time.', 409);
    }
  }
  if (f.date || f.time) { f.starts_at_utc = zonedToUtc(next.date, next.time, r.timezone).toISOString(); f.reminder_sent_at = null; }
  f.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  update('reservations', rv.id, r.id, f);
  const updated = one('SELECT * FROM reservations WHERE id = ?', rv.id);
  const changed = (f.date && f.date !== rv.date) || (f.time && f.time !== rv.time) || (f.party_size && Number(f.party_size) !== rv.party_size);
  if (changed && req.body.notify !== false && updated.status === 'confirmed') {
    email.sendReservationEmail('updated', r, updated).catch(() => {});
  }
  res.json(updated);
}));

router.post('/reservations/:id/cancel', wrap(async (req, res) => {
  const rv = owned('reservations', req.params.id, req.restaurant.id);
  res.json(cancelReservation(req.restaurant, rv, 'restaurant', req.body.notify !== false));
}));

router.post('/reservations/:id/no-show', wrap(async (req, res) => {
  const rv = owned('reservations', req.params.id, req.restaurant.id);
  res.json(markNoShow(req.restaurant, rv, req.body.notify !== false && !!req.restaurant.send_no_show_email));
}));

router.post('/reservations/:id/resend', wrap(async (req, res) => {
  const rv = owned('reservations', req.params.id, req.restaurant.id);
  const kind = rv.status === 'cancelled' ? 'cancellation' : 'confirmation';
  res.json({ status: await email.sendReservationEmail(kind, req.restaurant, rv) });
}));

// ---------- Floor plan: areas & tables ----------
router.get('/floor', wrap(async (req, res) => {
  const rid = req.restaurant.id;
  res.json({
    areas: all('SELECT * FROM areas WHERE restaurant_id = ? ORDER BY sort_order, id', rid),
    tables: all('SELECT * FROM tables WHERE restaurant_id = ? ORDER BY label', rid),
    combos: all('SELECT * FROM table_combos WHERE restaurant_id = ? ORDER BY max_seats, name', rid),
  });
}));

router.post('/areas', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new BookingError('Area name required.');
  const info = run('INSERT INTO areas (restaurant_id, name, sort_order) VALUES (?,?,?)', req.restaurant.id, name, Number(req.body.sort_order) || 0);
  res.status(201).json(one('SELECT * FROM areas WHERE id = ?', info.lastInsertRowid));
}));
router.put('/areas/:id', wrap(async (req, res) => {
  owned('areas', req.params.id, req.restaurant.id);
  update('areas', req.params.id, req.restaurant.id, pick(req.body, ['name', 'sort_order']));
  res.json(one('SELECT * FROM areas WHERE id = ?', req.params.id));
}));
router.delete('/areas/:id', wrap(async (req, res) => {
  owned('areas', req.params.id, req.restaurant.id);
  run('DELETE FROM areas WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

const TABLE_FIELDS = ['area_id', 'label', 'min_seats', 'max_seats', 'shape', 'x', 'y', 'rotation', 'online_bookable', 'active'];
function cleanTable(b) {
  const f = pick(b, TABLE_FIELDS);
  for (const k of ['min_seats', 'max_seats', 'x', 'y', 'rotation']) if (f[k] !== undefined) f[k] = Math.round(Number(f[k]) || 0);
  for (const k of ['online_bookable', 'active']) if (f[k] !== undefined) f[k] = f[k] ? 1 : 0;
  if (f.shape && !['square', 'round', 'rect', 'booth', 'bar'].includes(f.shape)) f.shape = 'square';
  if (f.area_id === '' || f.area_id === 0) f.area_id = null;
  if (f.min_seats !== undefined && f.min_seats < 1) f.min_seats = 1;
  return f;
}
router.post('/tables', wrap(async (req, res) => {
  const f = { min_seats: 1, max_seats: 4, shape: 'square', x: 40, y: 40, ...cleanTable(req.body) };
  if (!f.label) throw new BookingError('Table label required.');
  if (f.max_seats < f.min_seats) throw new BookingError('Max seats must be at least min seats.');
  const keys = Object.keys(f);
  const info = run(`INSERT INTO tables (restaurant_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`, req.restaurant.id, ...keys.map((k) => f[k]));
  res.status(201).json(one('SELECT * FROM tables WHERE id = ?', info.lastInsertRowid));
}));
router.put('/tables/:id', wrap(async (req, res) => {
  const t = owned('tables', req.params.id, req.restaurant.id);
  const f = cleanTable(req.body);
  if ((f.max_seats ?? t.max_seats) < (f.min_seats ?? t.min_seats)) throw new BookingError('Max seats must be at least min seats.');
  update('tables', t.id, req.restaurant.id, f);
  res.json(one('SELECT * FROM tables WHERE id = ?', t.id));
}));
router.put('/floor/layout', wrap(async (req, res) => {
  const items = Array.isArray(req.body.tables) ? req.body.tables : [];
  tx(() => items.forEach((t) => update('tables', t.id, req.restaurant.id, pick(cleanTable(t), ['x', 'y', 'rotation']))));
  res.json({ ok: true });
}));
router.delete('/tables/:id', wrap(async (req, res) => {
  owned('tables', req.params.id, req.restaurant.id);
  run('DELETE FROM tables WHERE id = ?', req.params.id);
  // Drop combinations that used this table.
  for (const c of all('SELECT id, table_ids FROM table_combos WHERE restaurant_id = ?', req.restaurant.id)) {
    if (c.table_ids.split(',').map(Number).includes(Number(req.params.id))) run('DELETE FROM table_combos WHERE id = ?', c.id);
  }
  res.json({ ok: true });
}));

// ---------- Table combinations ----------
function cleanCombo(b, rid) {
  const f = pick(b, ['name', 'table_ids', 'min_seats', 'max_seats', 'online_bookable', 'active']);
  if (f.table_ids !== undefined) {
    const ids = [...new Set((Array.isArray(f.table_ids) ? f.table_ids : String(f.table_ids).split(',')).map(Number).filter(Boolean))];
    const mine = new Set(all('SELECT id FROM tables WHERE restaurant_id = ?', rid).map((t) => t.id));
    if (ids.length < 2) throw new BookingError('Pick at least two tables to combine.');
    if (!ids.every((id) => mine.has(id))) throw new BookingError('Table not found.');
    f.table_ids = ids.join(',');
  }
  for (const k of ['min_seats', 'max_seats']) if (f[k] !== undefined) f[k] = Math.max(1, Math.round(Number(f[k]) || 1));
  for (const k of ['online_bookable', 'active']) if (f[k] !== undefined) f[k] = f[k] ? 1 : 0;
  return f;
}
router.post('/combos', wrap(async (req, res) => {
  const rid = req.restaurant.id;
  const f = { online_bookable: 1, active: 1, ...cleanCombo(req.body, rid) };
  if (!f.table_ids) throw new BookingError('Pick at least two tables to combine.');
  const key = (ids) => String(ids).split(',').map(Number).sort((a, b) => a - b).join(',');
  const dupe = all('SELECT name, table_ids FROM table_combos WHERE restaurant_id = ?', rid).find((c) => key(c.table_ids) === key(f.table_ids));
  if (dupe) throw new BookingError(`Those tables are already combined as ${dupe.name}.`, 409);
  const members = all(`SELECT label, min_seats, max_seats FROM tables WHERE id IN (${f.table_ids})`);
  f.name = String(f.name || members.map((t) => t.label).join(' + '));
  if (f.max_seats === undefined) f.max_seats = members.reduce((a, t) => a + t.max_seats, 0);
  if (f.min_seats === undefined) f.min_seats = Math.max(1, Math.max(...members.map((t) => t.max_seats)) + 1);
  if (f.max_seats < f.min_seats) throw new BookingError('Max seats must be at least min seats.');
  const keys = Object.keys(f);
  const info = run(`INSERT INTO table_combos (restaurant_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`, rid, ...keys.map((k) => f[k]));
  res.status(201).json(one('SELECT * FROM table_combos WHERE id = ?', info.lastInsertRowid));
}));
router.put('/combos/:id', wrap(async (req, res) => {
  const c = owned('table_combos', req.params.id, req.restaurant.id);
  const f = cleanCombo(req.body, req.restaurant.id);
  if ((f.max_seats ?? c.max_seats) < (f.min_seats ?? c.min_seats)) throw new BookingError('Max seats must be at least min seats.');
  update('table_combos', c.id, req.restaurant.id, f);
  res.json(one('SELECT * FROM table_combos WHERE id = ?', c.id));
}));
router.delete('/combos/:id', wrap(async (req, res) => {
  owned('table_combos', req.params.id, req.restaurant.id);
  run('DELETE FROM table_combos WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// ---------- Services / shifts ----------
const SHIFT_FIELDS = ['name', 'days', 'start_time', 'end_time', 'slot_interval', 'turn_minutes', 'max_covers_per_slot', 'active'];
function cleanShift(b) {
  const f = pick(b, SHIFT_FIELDS);
  if (Array.isArray(f.days)) f.days = f.days.join(',');
  for (const k of ['start_time', 'end_time']) if (f[k] !== undefined && !/^\d{2}:\d{2}$/.test(f[k])) throw new BookingError('Times must be HH:MM.');
  for (const k of ['slot_interval', 'turn_minutes', 'max_covers_per_slot']) if (f[k] !== undefined) f[k] = Math.max(0, Number(f[k]) || 0);
  if (f.slot_interval !== undefined && f.slot_interval < 5) f.slot_interval = 15;
  if (f.turn_minutes !== undefined && f.turn_minutes < 15) f.turn_minutes = 90;
  if (f.active !== undefined) f.active = f.active ? 1 : 0;
  return f;
}
router.get('/shifts', wrap(async (req, res) => {
  res.json({
    shifts: all('SELECT * FROM shifts WHERE restaurant_id = ? ORDER BY start_time', req.restaurant.id),
    closures: all('SELECT * FROM closures WHERE restaurant_id = ? ORDER BY date', req.restaurant.id),
  });
}));
router.post('/shifts', wrap(async (req, res) => {
  const f = { slot_interval: 15, turn_minutes: 90, max_covers_per_slot: 0, days: '0,1,2,3,4,5,6', ...cleanShift(req.body) };
  if (!f.name || !f.start_time || !f.end_time) throw new BookingError('Name, first and last seating are required.');
  const keys = Object.keys(f);
  const info = run(`INSERT INTO shifts (restaurant_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`, req.restaurant.id, ...keys.map((k) => f[k]));
  res.status(201).json(one('SELECT * FROM shifts WHERE id = ?', info.lastInsertRowid));
}));
router.put('/shifts/:id', wrap(async (req, res) => {
  owned('shifts', req.params.id, req.restaurant.id);
  update('shifts', req.params.id, req.restaurant.id, cleanShift(req.body));
  res.json(one('SELECT * FROM shifts WHERE id = ?', req.params.id));
}));
router.delete('/shifts/:id', wrap(async (req, res) => {
  owned('shifts', req.params.id, req.restaurant.id);
  run('DELETE FROM shifts WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));
router.post('/closures', wrap(async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '')) throw new BookingError('Pick a date.');
  const info = run('INSERT INTO closures (restaurant_id, date, reason) VALUES (?,?,?)', req.restaurant.id, req.body.date, String(req.body.reason || ''));
  res.status(201).json(one('SELECT * FROM closures WHERE id = ?', info.lastInsertRowid));
}));
router.delete('/closures/:id', wrap(async (req, res) => {
  owned('closures', req.params.id, req.restaurant.id);
  run('DELETE FROM closures WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// ---------- Guests & email log ----------
const GUEST_FIELDS = ['name', 'email', 'phone', 'birthday', 'tags', 'notes', 'marketing_opt_in'];
function cleanGuestRow(b) {
  const f = pick(b, GUEST_FIELDS);
  for (const k of ['name', 'email', 'phone', 'birthday', 'notes']) if (f[k] !== undefined) f[k] = String(f[k]).trim().slice(0, k === 'notes' ? 2000 : 200);
  if (f.email) f.email = f.email.toLowerCase();
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) throw new BookingError('Enter a valid email or leave it blank.');
  if (f.tags !== undefined) f.tags = (Array.isArray(f.tags) ? f.tags : String(f.tags).split(',')).map((t) => String(t).trim()).filter(Boolean).slice(0, 12).join(',');
  if (f.marketing_opt_in !== undefined) f.marketing_opt_in = f.marketing_opt_in ? 1 : 0;
  return f;
}
const GUEST_STATS = `SELECT g.*, COUNT(r.id) AS reservations,
    COALESCE(SUM(r.status IN ('completed','seated')),0) AS visits, COALESCE(SUM(r.status='no_show'),0) AS no_shows,
    COALESCE(SUM(r.status='cancelled'),0) AS cancellations, MAX(CASE WHEN r.status != 'cancelled' THEN r.date END) AS last_date,
    MIN(CASE WHEN r.status IN ('confirmed') AND r.date >= ? THEN r.date || ' ' || r.time END) AS next_visit
  FROM guests g LEFT JOIN reservations r ON r.guest_id = g.id`;

// Address book: every guest who booked, plus contacts staff added by hand.
router.get('/guests', wrap(async (req, res) => {
  const rid = req.restaurant.id;
  const today = nowInZone(req.restaurant.timezone).date;
  const q = String(req.query.q || '').toLowerCase().trim();
  const tag = String(req.query.tag || '').trim();
  let rows = all(`${GUEST_STATS} WHERE g.restaurant_id = ? GROUP BY g.id ORDER BY g.name COLLATE NOCASE`, today, rid);
  if (q) rows = rows.filter((g) => `${g.name} ${g.email} ${g.phone} ${g.tags} ${g.notes}`.toLowerCase().includes(q));
  if (tag) rows = rows.filter((g) => g.tags.split(',').includes(tag));
  const tags = [...new Set(all('SELECT tags FROM guests WHERE restaurant_id = ?', rid).flatMap((g) => g.tags.split(',').filter(Boolean)))].sort();
  res.json({ guests: rows, tags });
}));
router.get('/guests/:id', wrap(async (req, res) => {
  const rid = req.restaurant.id;
  owned('guests', req.params.id, rid);
  const g = one(`${GUEST_STATS} WHERE g.id = ? GROUP BY g.id`, nowInZone(req.restaurant.timezone).date, req.params.id);
  const reservations = all(`SELECT r.id, r.code, r.date, r.time, r.party_size, r.status, r.source, r.notes, COALESCE(t.label, c.name) AS table_label
    FROM reservations r LEFT JOIN tables t ON t.id = r.table_id LEFT JOIN table_combos c ON c.id = r.combo_id
    WHERE r.guest_id = ? ORDER BY r.date DESC, r.time DESC`, g.id);
  res.json({ guest: g, reservations });
}));
router.post('/guests', wrap(async (req, res) => {
  const f = cleanGuestRow(req.body);
  if (!f.name) throw new BookingError('Name is required.');
  if (f.email && one('SELECT id FROM guests WHERE restaurant_id = ? AND email = ?', req.restaurant.id, f.email)) throw new BookingError('A guest with that email is already in your address book.', 409);
  const keys = Object.keys(f);
  const info = run(`INSERT INTO guests (restaurant_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`, req.restaurant.id, ...keys.map((k) => f[k]));
  res.status(201).json(one('SELECT * FROM guests WHERE id = ?', info.lastInsertRowid));
}));
router.put('/guests/:id', wrap(async (req, res) => {
  const g = owned('guests', req.params.id, req.restaurant.id);
  const f = cleanGuestRow(req.body);
  if (f.name === '') throw new BookingError('Name is required.');
  f.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  update('guests', g.id, req.restaurant.id, f);
  res.json(one('SELECT * FROM guests WHERE id = ?', g.id));
}));
router.delete('/guests/:id', wrap(async (req, res) => {
  owned('guests', req.params.id, req.restaurant.id);
  run('UPDATE reservations SET guest_id = NULL WHERE guest_id = ?', req.params.id);
  run('DELETE FROM guests WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

router.get('/emails', wrap(async (req, res) => {
  res.json(all(`SELECT e.id, e.to_addr, e.subject, e.kind, e.status, e.error, e.created_at FROM email_log e
    JOIN reservations r ON r.id = e.reservation_id WHERE r.restaurant_id = ? ORDER BY e.id DESC LIMIT 100`, req.restaurant.id));
}));
router.get('/emails/:id', wrap(async (req, res) => {
  const e = one(`SELECT e.* FROM email_log e JOIN reservations r ON r.id = e.reservation_id WHERE e.id = ? AND r.restaurant_id = ?`, req.params.id, req.restaurant.id);
  if (!e) throw new BookingError('Not found.', 404);
  res.type('html').send(e.html);
}));

// ---------- Billing ----------
router.get('/billing', wrap(async (req, res) => res.json(billing.billingSummary(req.restaurant))));
router.post('/billing/checkout', wrap(async (req, res) => res.json({ url: await billing.createCheckout(req.restaurant, req.user) })));
router.post('/billing/portal', wrap(async (req, res) => res.json({ url: await billing.createPortal(req.restaurant) })));
router.post('/billing/simulate', wrap(async (req, res) => {
  if (billing.stripe() || config.isProduction) throw new BookingError('Only available in demo mode.', 403);
  const status = req.body.status === 'expired' ? 'trialing' : 'active';
  if (req.body.status === 'expired') run(`UPDATE restaurants SET subscription_status='trialing', trial_ends_at=? WHERE id=?`, new Date(Date.now() - 1000).toISOString(), req.restaurant.id);
  else run('UPDATE restaurants SET subscription_status = ? WHERE id = ?', status, req.restaurant.id);
  res.json(billing.billingSummary(one('SELECT * FROM restaurants WHERE id = ?', req.restaurant.id)));
}));

// ---------- Menu ----------
function cleanMenuItem(b) {
  const f = pick(b, ['section', 'name', 'description', 'price', 'price_cents', 'tags', 'sort_order', 'available']);
  if (f.section !== undefined) f.section = String(f.section).trim().slice(0, 60) || 'Menu';
  if (f.name !== undefined) f.name = String(f.name).trim().slice(0, 120);
  if (f.description !== undefined) f.description = String(f.description).trim().slice(0, 500);
  if (f.price !== undefined) {
    const p = String(f.price).replace(/[^0-9.]/g, '');
    f.price_cents = p === '' ? null : Math.round(Number(p) * 100);
    delete f.price;
  }
  if (f.price_cents !== undefined && f.price_cents !== null) f.price_cents = Math.max(0, Math.round(Number(f.price_cents) || 0));
  if (f.tags !== undefined) {
    const t = new Set(parseMenuTags(f.tags));
    if (t.has('vegan')) { t.add('vegetarian'); t.add('dairy_free'); }
    f.tags = [...t].join(',');
  }
  if (f.sort_order !== undefined) f.sort_order = Math.round(Number(f.sort_order) || 0);
  if (f.available !== undefined) f.available = f.available ? 1 : 0;
  return f;
}
router.get('/menu', wrap(async (req, res) => {
  res.json(all('SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY sort_order, id', req.restaurant.id));
}));
router.post('/menu', wrap(async (req, res) => {
  const rid = req.restaurant.id;
  const f = { section: 'Menu', ...cleanMenuItem(req.body) };
  if (!f.name) throw new BookingError('Give the dish a name.');
  if (f.sort_order === undefined) f.sort_order = (one('SELECT MAX(sort_order) AS m FROM menu_items WHERE restaurant_id = ?', rid).m ?? -1) + 1;
  const keys = Object.keys(f);
  const info = run(`INSERT INTO menu_items (restaurant_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`, rid, ...keys.map((k) => f[k]));
  res.status(201).json(one('SELECT * FROM menu_items WHERE id = ?', info.lastInsertRowid));
}));
// Import many dishes at once (from a pasted menu, spreadsheet, PDF or photo, read in the browser).
router.post('/menu/import', wrap(async (req, res) => {
  const rid = req.restaurant.id;
  const list = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 500).map((b) => ({ section: 'Menu', ...cleanMenuItem(b) })).filter((f) => f.name);
  if (!list.length) throw new BookingError('No dishes to import.');
  tx(() => {
    if (req.body.replace) run('DELETE FROM menu_items WHERE restaurant_id = ?', rid);
    let order = (one('SELECT MAX(sort_order) AS m FROM menu_items WHERE restaurant_id = ?', rid).m ?? -1) + 1;
    for (const f of list) {
      delete f.sort_order; f.sort_order = order++;
      const keys = Object.keys(f);
      run(`INSERT INTO menu_items (restaurant_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`, rid, ...keys.map((k) => f[k]));
    }
  });
  res.status(201).json({ imported: list.length });
}));
router.put('/menu/order', wrap(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number);
  tx(() => ids.forEach((id, i) => run('UPDATE menu_items SET sort_order = ? WHERE id = ? AND restaurant_id = ?', i, id, req.restaurant.id)));
  res.json({ ok: true });
}));
router.put('/menu/:id', wrap(async (req, res) => {
  const m = owned('menu_items', req.params.id, req.restaurant.id);
  const f = cleanMenuItem(req.body);
  if (f.name === '') throw new BookingError('Give the dish a name.');
  update('menu_items', m.id, req.restaurant.id, f);
  res.json(one('SELECT * FROM menu_items WHERE id = ?', m.id));
}));
router.delete('/menu/:id', wrap(async (req, res) => {
  owned('menu_items', req.params.id, req.restaurant.id);
  run('DELETE FROM menu_items WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// ---------- Photo & logo upload ----------
router.post('/images', wrap(async (req, res) => {
  const kind = ['logo', 'gallery'].includes(req.body.kind) ? req.body.kind : 'cover';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.data || ''));
  if (!m) throw new BookingError('Upload a JPG, PNG or WebP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) throw new BookingError('That image is too large (4 MB max).');
  const rid = req.restaurant.id;
  if (kind === 'gallery') {
    if (one('SELECT COUNT(*) AS n FROM gallery_photos WHERE restaurant_id = ?', rid).n >= 60) throw new BookingError('Your gallery is full (60 photos). Remove some first.');
    const img = run('INSERT INTO images (restaurant_id, kind, mime, data) VALUES (?,?,?,?)', rid, kind, m[1], buf).lastInsertRowid;
    const dish = Number(req.body.menu_item_id) || null;
    if (dish) owned('menu_items', dish, rid);
    const order = (one('SELECT MIN(sort_order) AS m FROM gallery_photos WHERE restaurant_id = ?', rid).m ?? 1) - 1; // newest first
    const g = run('INSERT INTO gallery_photos (restaurant_id, image_id, caption, menu_item_id, sort_order) VALUES (?,?,?,?,?)', rid, img, String(req.body.caption || '').trim().slice(0, 200), dish, order).lastInsertRowid;
    return res.status(201).json({ id: g, url: `/img/${img}`, kind });
  }
  const col = kind === 'logo' ? 'logo_url' : 'image_url';
  const info = run('INSERT INTO images (restaurant_id, kind, mime, data) VALUES (?,?,?,?)', rid, kind, m[1], buf);
  const url = `/img/${info.lastInsertRowid}`;
  run(`UPDATE restaurants SET ${col} = ? WHERE id = ?`, url, rid);
  run('DELETE FROM images WHERE restaurant_id = ? AND kind = ? AND id != ?', rid, kind, info.lastInsertRowid);
  res.status(201).json({ url, kind });
}));

// ---------- Gallery (food photos diners can like) ----------
router.get('/gallery', wrap(async (req, res) => {
  res.json(all(`SELECT g.id, '/img/' || g.image_id AS url, g.caption, g.menu_item_id, m.name AS dish, g.created_at,
    (SELECT COUNT(*) FROM likes l WHERE l.kind = 'photo' AND l.target_id = g.id) AS likes
    FROM gallery_photos g LEFT JOIN menu_items m ON m.id = g.menu_item_id WHERE g.restaurant_id = ? ORDER BY g.sort_order, g.id DESC`, req.restaurant.id));
}));
router.put('/gallery/:id', wrap(async (req, res) => {
  const g = owned('gallery_photos', req.params.id, req.restaurant.id);
  const f = {};
  if (req.body.caption !== undefined) f.caption = String(req.body.caption).trim().slice(0, 200);
  if (req.body.menu_item_id !== undefined) { const d = Number(req.body.menu_item_id) || null; if (d) owned('menu_items', d, req.restaurant.id); f.menu_item_id = d; }
  if (Object.keys(f).length) update('gallery_photos', g.id, req.restaurant.id, f);
  res.json({ ok: true });
}));
router.delete('/gallery/:id', wrap(async (req, res) => {
  const g = owned('gallery_photos', req.params.id, req.restaurant.id);
  tx(() => {
    run('DELETE FROM gallery_photos WHERE id = ?', g.id);
    run('DELETE FROM images WHERE id = ? AND restaurant_id = ?', g.image_id, req.restaurant.id);
    run("DELETE FROM likes WHERE kind = 'photo' AND target_id = ?", g.id);
  });
  res.json({ ok: true });
}));

module.exports = router;
