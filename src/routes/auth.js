'use strict';
const express = require('express');
const { one, run, tx } = require('../db');
const auth = require('../auth');
const { lookupZip } = require('../geo');
const places = require('../../public/js/places');
const email = require('../email');
const config = require('../config');
const { BookingError } = require('../reservations');
const { wrap } = require('./public');

const router = express.Router();
const crypto = require('crypto');

// ---------- One-time email links (confirm email, reset password) ----------
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function newLink(userId, kind, hours) {
  const token = crypto.randomBytes(24).toString('base64url');
  run('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?', userId, kind); // only the newest link works
  run('INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)', sha(token), userId, kind, new Date(Date.now() + hours * 3600000).toISOString());
  return token;
}
function useLink(token, kind) {
  const row = token && one('SELECT * FROM auth_tokens WHERE token_hash = ? AND kind = ?', sha(token), kind);
  if (!row || row.expires_at < new Date().toISOString()) return null;
  return row;
}
const recentLink = (userId, kind) => one(`SELECT created_at FROM auth_tokens WHERE user_id = ? AND kind = ? AND created_at > datetime('now', '-2 minutes')`, userId, kind);
const verifyUrl = (t) => `${config.baseUrl}/api/auth/verify?t=${encodeURIComponent(t)}`;
function markVerified(userId) {
  const u = one('SELECT restaurant_id FROM users WHERE id = ?', userId);
  run('UPDATE users SET email_verified = 1 WHERE id = ?', userId);
  if (u) { run('UPDATE restaurants SET verified = 1 WHERE id = ?', u.restaurant_id); creditReferral(u.restaurant_id); }
  run("DELETE FROM auth_tokens WHERE user_id = ? AND kind = 'verify'", userId);
}

// ---------- Referrals: a restaurant that brings in another one gets a free month once the new one confirms its email ----------
const MONTH_MS = 30 * 86400000;
const MAX_FREE_MONTHS = 12; // per referring restaurant, to keep it fair
function creditReferral(rid) {
  const r = one('SELECT id, name, referred_by, referral_credited FROM restaurants WHERE id = ?', rid);
  if (!r || !r.referred_by || r.referral_credited) return;
  const ref = one('SELECT * FROM restaurants WHERE id = ?', r.referred_by);
  run('UPDATE restaurants SET referral_credited = 1 WHERE id = ?', rid);
  if (!ref || (ref.free_months || 0) >= MAX_FREE_MONTHS) return;
  run('UPDATE restaurants SET free_months = COALESCE(free_months, 0) + 1 WHERE id = ?', ref.id);
  // While billing isn't charging yet, the month is added to their free time right away.
  if (ref.subscription_status === 'trialing') {
    const from = Math.max(Date.now(), new Date(ref.trial_ends_at).getTime() || 0);
    run('UPDATE restaurants SET trial_ends_at = ? WHERE id = ?', new Date(from + MONTH_MS).toISOString(), ref.id);
  }
  const owner = one("SELECT email FROM users WHERE restaurant_id = ? ORDER BY id LIMIT 1", ref.id);
  if (owner) email.sendReferralEarned(ref, owner.email, r.name).catch(() => {});
}
const referrerFor = (code) => {
  const c = String(code || '').trim().toLowerCase();
  return c ? one('SELECT id, name, city, state, slug FROM restaurants WHERE slug = ?', c) : null;
};

// For the sign-up page: "Invited by …".
router.get('/referrer/:code', wrap(async (req, res) => {
  const r = referrerFor(req.params.code);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ name: r.name, city: r.city, state: r.state });
}));

function slugify(name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 50) || 'restaurant';
  let slug = base; let i = 2;
  while (one('SELECT id FROM restaurants WHERE slug = ?', slug)) slug = `${base}-${i++}`;
  return slug;
}

/** Starter floor plan and dinner service so a new restaurant is bookable right away; all editable. */
function starterSetup(rid) {
  const area = run('INSERT INTO areas (restaurant_id, name) VALUES (?, ?)', rid, 'Main dining room').lastInsertRowid;
  const starter = [['T1', 1, 2, 'square', 60, 60], ['T2', 1, 2, 'square', 180, 60], ['T3', 2, 4, 'square', 300, 60],
    ['T4', 2, 4, 'square', 60, 200], ['T5', 2, 4, 'round', 180, 200], ['T6', 4, 6, 'rect', 300, 200]];
  for (const [label, mn, mx, shape, x, y] of starter) {
    run('INSERT INTO tables (restaurant_id, area_id, label, min_seats, max_seats, shape, x, y) VALUES (?,?,?,?,?,?,?,?)', rid, area, label, mn, mx, shape, x, y);
  }
  run(`INSERT INTO shifts (restaurant_id, name, days, start_time, end_time, slot_interval, turn_minutes) VALUES (?, 'Dinner', '0,1,2,3,4,5,6', '17:00', '21:30', 15, 90)`, rid);
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
  const cuisine = places.cuisine(b.cuisine);
  if (!cuisine) throw new BookingError('Pick your cuisine from the list.');
  const st = String(b.state).trim().toUpperCase();
  if (!places.STATE_CODES.has(st)) throw new BookingError('Pick your state from the list.');
  b.state = st;
  const tz = places.timezoneFor(String(b.zip).trim(), st); // automatic from the ZIP code

  const geo = await lookupZip(b.zip);
  const referrer = referrerFor(b.ref);
  // Signing up with a referral link adds a free month to the new restaurant's trial too.
  const trialEnds = new Date(Date.now() + config.plan.trialDays * 86400000 + (referrer ? MONTH_MS : 0)).toISOString();

  const { restaurant, user } = tx(() => {
    const r = run(`INSERT INTO restaurants (slug, name, cuisine, phone, email, address, city, state, zip, lat, lng, timezone, description, trial_ends_at, subscription_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'trialing')`,
    slugify(b.restaurant_name), String(b.restaurant_name).trim(), cuisine, String(b.phone).trim(), em,
    String(b.address).trim(), String(b.city).trim(), String(b.state).trim().toUpperCase().slice(0, 2), String(b.zip).trim(),
    geo ? geo.lat : null, geo ? geo.lng : null, tz, String(b.description || ''), trialEnds);
    const rid = r.lastInsertRowid;
    run('UPDATE restaurants SET verified = 0 WHERE id = ?', rid); // goes live once the owner confirms their email
    if (referrer) run('UPDATE restaurants SET referred_by = ? WHERE id = ?', referrer.id, rid);
    const u = run('INSERT INTO users (restaurant_id, name, email, password_hash, role, email_verified) VALUES (?,?,?,?,?,0)',
      rid, String(b.owner_name).trim(), em, auth.hashPassword(String(b.password)), 'owner');
    starterSetup(rid);
    return { restaurant: one('SELECT * FROM restaurants WHERE id = ?', rid), user: one('SELECT * FROM users WHERE id = ?', u.lastInsertRowid) };
  });

  email.sendWelcome(restaurant, user, verifyUrl(newLink(user.id, 'verify', 24 * 7))).catch(() => {});
  auth.createSession(res, user.id);
  res.status(201).json({ ok: true, slug: restaurant.slug });
}));

// Password guessing guard: after 8 wrong tries for one email (or 20 from one connection) in 15 minutes, wait.
const loginFails = new Map();
const recentFails = (k, now) => (loginFails.get(k) || []).filter((t) => now - t < 15 * 60000);
router.post('/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const now = Date.now(); const ipKey = `ip:${req.ip}`; const emKey = `em:${email}`;
  if (recentFails(emKey, now).length >= 8 || recentFails(ipKey, now).length >= 20) {
    throw new BookingError('Too many wrong tries. Please wait 15 minutes, or email rbookedsupport@gmail.com for help.', 429);
  }
  const user = one('SELECT * FROM users WHERE email = ?', email);
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
    for (const k of [emKey, ipKey]) loginFails.set(k, [...recentFails(k, now), now]);
    if (loginFails.size > 5000) loginFails.clear();
    throw new BookingError('Wrong email or password.', 401);
  }
  loginFails.delete(emKey);
  auth.createSession(res, user.id);
  res.json({ ok: true });
}));

// Confirm email: the link in the welcome email lands here, then opens the dashboard.
router.get('/verify', wrap(async (req, res) => {
  const row = useLink(String(req.query.t || ''), 'verify');
  if (!row) return res.redirect('/login?verify=expired');
  markVerified(row.user_id);
  res.redirect('/admin/?verified=1');
}));
router.post('/resend-verify', wrap(async (req, res) => {
  const u = auth.loadUser(req);
  if (!u) throw new BookingError('Please log in.', 401);
  const user = one('SELECT * FROM users WHERE id = ?', u.id);
  if (user.email_verified) return res.json({ ok: true, already: true });
  if (recentLink(user.id, 'verify')) throw new BookingError('We just sent one. Please check your inbox and spam folder, or try again in 2 minutes.', 429);
  await email.sendVerify(user, verifyUrl(newLink(user.id, 'verify', 24 * 7)));
  res.json({ ok: true, to: user.email });
}));

// Forgot password: always answers the same way, so nobody can test which emails have accounts.
router.post('/forgot', wrap(async (req, res) => {
  const em = String(req.body.email || '').trim().toLowerCase();
  const user = em && one('SELECT * FROM users WHERE email = ?', em);
  if (user && !recentLink(user.id, 'reset')) {
    const t = newLink(user.id, 'reset', 1);
    await email.sendPasswordReset(user, `${config.baseUrl}/reset-password?t=${encodeURIComponent(t)}`);
  }
  res.json({ ok: true });
}));
router.post('/reset', wrap(async (req, res) => {
  const row = useLink(String(req.body.token || ''), 'reset');
  if (!row) throw new BookingError('This reset link has expired or was already used. Ask for a new one.', 400);
  const pw = String(req.body.password || '');
  if (pw.length < 8) throw new BookingError('Password must be at least 8 characters.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(pw), row.user_id);
  run('DELETE FROM sessions WHERE user_id = ?', row.user_id); // log out everywhere else
  run("DELETE FROM auth_tokens WHERE user_id = ? AND kind = 'reset'", row.user_id);
  markVerified(row.user_id); // they got the email, so it's theirs
  auth.createSession(res, row.user_id);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => { auth.destroySession(req, res); res.json({ ok: true }); });

router.get('/me', (req, res) => {
  const u = auth.loadUser(req);
  res.json({ user: u ? { name: u.name, email: u.email } : null, demo: !config.isProduction });
});

module.exports = router;
module.exports.starterSetup = starterSetup;
