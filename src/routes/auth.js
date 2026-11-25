'use strict';
const express = require('express');
const { one, run, tx } = require('../db');
const auth = require('../auth');
const { lookupZip } = require('../geo');
const email = require('../email');
const config = require('../config');
const { BookingError } = require('../reservations');
const { wrap } = require('./public');

const router = express.Router();

function slugify(name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 50) || 'restaurant';
  let slug = base; let i = 2;
  while (one('SELECT id FROM restaurants WHERE slug = ?', slug)) slug = `${base}-${i++}`;
  return slug;
}

// Restaurant signup: creates the restaurant, its owner, and a starter floor + services.
router.post('/signup', wrap(async (req, res) => {
  const b = req.body;
  const need = { restaurant_name: 'Restaurant name', owner_name: 'Your name', email: 'Email', password: 'Password', phone: 'Phone', address: 'Street address', city: 'City', state: 'State', zip: 'ZIP code' };
  for (const [k, label] of Object.entries(need)) if (!String(b[k] || '').trim()) throw new BookingError(`${label} is required.`);
  const em = String(b.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new BookingError('Enter a valid email.');
  if (String(b.password).length < 8) throw new BookingError('Password must be at least 8 characters.');
  if (!/^\d{5}$/.test(String(b.zip).trim())) throw new BookingError('Enter a 5-digit ZIP code.');
  if (one('SELECT id FROM users WHERE email = ?', em)) throw new BookingError('An account with that email already exists. Please log in.');
  let tz = String(b.timezone || 'America/New_York');
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'America/New_York'; }

  const geo = await lookupZip(b.zip);
  const trialEnds = new Date(Date.now() + config.plan.trialDays * 86400000).toISOString();

  const { restaurant, user } = tx(() => {
    const r = run(`INSERT INTO restaurants (slug, name, cuisine, phone, email, address, city, state, zip, lat, lng, timezone, description, trial_ends_at, subscription_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'trialing')`,
    slugify(b.restaurant_name), String(b.restaurant_name).trim(), String(b.cuisine || ''), String(b.phone).trim(), em,
    String(b.address).trim(), String(b.city).trim(), String(b.state).trim().toUpperCase().slice(0, 2), String(b.zip).trim(),
    geo ? geo.lat : null, geo ? geo.lng : null, tz, String(b.description || ''), trialEnds);
    const rid = r.lastInsertRowid;
    const u = run('INSERT INTO users (restaurant_id, name, email, password_hash, role) VALUES (?,?,?,?,?)',
      rid, String(b.owner_name).trim(), em, auth.hashPassword(String(b.password)), 'owner');
    // Starter configuration so the restaurant is bookable immediately; editable in the dashboard.
    const area = run('INSERT INTO areas (restaurant_id, name) VALUES (?, ?)', rid, 'Main dining room').lastInsertRowid;
    const starter = [['T1', 1, 2, 'square', 60, 60], ['T2', 1, 2, 'square', 180, 60], ['T3', 2, 4, 'square', 300, 60],
      ['T4', 2, 4, 'square', 60, 200], ['T5', 2, 4, 'round', 180, 200], ['T6', 4, 6, 'rect', 300, 200]];
    for (const [label, mn, mx, shape, x, y] of starter) {
      run('INSERT INTO tables (restaurant_id, area_id, label, min_seats, max_seats, shape, x, y) VALUES (?,?,?,?,?,?,?,?)', rid, area, label, mn, mx, shape, x, y);
    }
    run(`INSERT INTO shifts (restaurant_id, name, days, start_time, end_time, slot_interval, turn_minutes) VALUES (?, 'Dinner', '0,1,2,3,4,5,6', '17:00', '21:30', 15, 90)`, rid);
    return { restaurant: one('SELECT * FROM restaurants WHERE id = ?', rid), user: one('SELECT * FROM users WHERE id = ?', u.lastInsertRowid) };
  });

  email.sendWelcome(restaurant, user).catch(() => {});
  auth.createSession(res, user.id);
  res.status(201).json({ ok: true, slug: restaurant.slug });
}));

router.post('/login', wrap(async (req, res) => {
  const user = one('SELECT * FROM users WHERE email = ?', String(req.body.email || '').trim().toLowerCase());
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
    throw new BookingError('Wrong email or password.', 401);
  }
  auth.createSession(res, user.id);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => { auth.destroySession(req, res); res.json({ ok: true }); });

router.get('/me', (req, res) => {
  const u = auth.loadUser(req);
  res.json({ user: u ? { name: u.name, email: u.email } : null, demo: !config.isProduction });
});

module.exports = router;
