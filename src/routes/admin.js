'use strict';
const express = require('express');
const { one, all, run, tx } = require('../db');
const { requireAuth } = require('../auth');
const { getAvailability, isTableFree } = require('../availability');
const { createReservation, cancelReservation, markNoShow, BookingError } = require('../reservations');
const billing = require('../billing');
const email = require('../email');
const config = require('../config');
const { lookupZip } = require('../geo');
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
  'auto_no_show', 'send_no_show_email', 'cancellation_policy', 'accent_color'];

router.get('/restaurant', wrap(async (req, res) => {
  res.json({ restaurant: pick(req.restaurant, ['id', 'slug', ...SETTINGS]), user: req.user, billing: billing.billingSummary(req.restaurant), baseUrl: config.baseUrl });
}));

router.put('/restaurant', wrap(async (req, res) => {
  const f = pick(req.body, SETTINGS);
  for (const k of ['price_level', 'max_party_size', 'booking_window_days', 'min_notice_minutes', 'reminder_hours', 'no_show_grace_minutes']) {
    if (f[k] !== undefined) f[k] = Math.max(0, Number(f[k]) || 0);
  }
  for (const k of ['auto_no_show', 'send_no_show_email']) if (f[k] !== undefined) f[k] = f[k] ? 1 : 0;
  if (f.timezone) { try { new Intl.DateTimeFormat('en-US', { timeZone: f.timezone }); } catch { throw new BookingError('Unknown time zone.'); } }
  if (f.zip && f.zip !== req.restaurant.zip) {
    const g = await lookupZip(f.zip);
    if (g) { f.lat = g.lat; f.lng = g.lng; }
  }
  update('restaurants', req.restaurant.id, req.restaurant.id, f);
  res.json({ ok: true });
}));

// ---------- Reservations ----------
router.get('/reservations', wrap(async (req, res) => {
  const r = req.restaurant;
  const from = String(req.query.from || req.query.date || nowInZone(r.timezone).date);
  const to = String(req.query.to || from);
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows = all(`SELECT res.*, t.label AS table_label FROM reservations res LEFT JOIN tables t ON t.id = res.table_id
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
  const f = pick(req.body, ['guest_name', 'guest_email', 'guest_phone', 'notes', 'internal_notes', 'occasion', 'party_size', 'table_id', 'date', 'time', 'duration_minutes', 'status']);
  if (f.status && !['confirmed', 'seated', 'completed'].includes(f.status)) throw new BookingError('Use the cancel / no-show actions for that status.');
  const moved = ['table_id', 'date', 'time', 'duration_minutes'].some((k) => f[k] !== undefined && String(f[k]) !== String(rv[k]));
  const next = { ...rv, ...f };
  if (moved && next.table_id) {
    owned('tables', next.table_id, r.id);
    if (!req.body.force && !isTableFree(r.id, next.table_id, next.date, next.time, Number(next.duration_minutes), rv.id)) {
      throw new BookingError('That table is already booked around that time.', 409);
    }
  }
  if (f.date || f.time) { f.starts_at_utc = zonedToUtc(next.date, next.time, r.timezone).toISOString(); f.reminder_sent_at = null; }
  f.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  update('reservations', rv.id, r.id, f);
  const updated = one('SELECT * FROM reservations WHERE id = ?', rv.id);
  if ((f.date || f.time || f.party_size) && req.body.notify !== false && updated.status === 'confirmed') {
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
router.get('/guests', wrap(async (req, res) => {
  const q = `%${String(req.query.q || '').toLowerCase()}%`;
  res.json(all(`SELECT guest_email AS email, MAX(guest_name) AS name, MAX(guest_phone) AS phone, COUNT(*) AS reservations,
      SUM(status IN ('completed','seated')) AS visits, SUM(status='no_show') AS no_shows, SUM(status='cancelled') AS cancellations,
      MAX(date) AS last_date
    FROM reservations WHERE restaurant_id = ? AND guest_email != 'walkin@guest.local'
      AND (LOWER(guest_name) LIKE ? OR LOWER(guest_email) LIKE ? OR guest_phone LIKE ?)
    GROUP BY guest_email ORDER BY last_date DESC LIMIT 200`, req.restaurant.id, q, q, q));
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
  if (billing.stripe || config.isProduction) throw new BookingError('Only available in demo mode.', 403);
  const status = req.body.status === 'expired' ? 'trialing' : 'active';
  if (req.body.status === 'expired') run(`UPDATE restaurants SET subscription_status='trialing', trial_ends_at=? WHERE id=?`, new Date(Date.now() - 1000).toISOString(), req.restaurant.id);
  else run('UPDATE restaurants SET subscription_status = ? WHERE id = ?', status, req.restaurant.id);
  res.json(billing.billingSummary(one('SELECT * FROM restaurants WHERE id = ?', req.restaurant.id)));
}));

module.exports = router;
