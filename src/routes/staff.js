'use strict';
// Rbooked staff tools for support, used from a script, not the website. Off unless the STAFF_API_KEY secret
// (32+ characters) is set in Cloudflare. Calls send it as "Authorization: Bearer <key>".
const express = require('express');
const crypto = require('crypto');
const { one, all, run } = require('../db');
const { wrap } = require('./public');

const router = express.Router();
const fails = new Map(); // ip -> [times] of wrong keys

router.use((req, res, next) => {
  const key = process.env.STAFF_API_KEY || '';
  if (key.length < 32) return res.status(404).json({ error: 'Not found' });
  const ip = req.headers['cf-connecting-ip'] || req.ip || 'x'; const now = Date.now();
  const recent = (fails.get(ip) || []).filter((t) => now - t < 3600000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many attempts' });
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(got).digest(); const b = crypto.createHash('sha256').update(key).digest();
  if (!got || !crypto.timingSafeEqual(a, b)) { recent.push(now); fails.set(ip, recent); return res.status(401).json({ error: 'Wrong key' }); }
  next();
});

router.get('/restaurants', wrap(async (req, res) => {
  res.json(all(`SELECT r.id, r.name, r.slug, r.city, r.state, r.created_at, r.featured, r.verified, r.free_months, (SELECT COUNT(*) FROM restaurants x WHERE x.referred_by = r.id) AS referred, (SELECT name FROM restaurants y WHERE y.id = r.referred_by) AS referred_by_name, (SELECT COUNT(*) FROM menu_items m WHERE m.restaurant_id = r.id) AS dishes,
    (SELECT GROUP_CONCAT(u.email) FROM users u WHERE u.restaurant_id = r.id) AS logins FROM restaurants r ORDER BY r.id`));
}));

router.post('/restaurants/:id/reset', wrap(async (req, res) => {
  const r = one('SELECT id, name FROM restaurants WHERE id = ?', Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'No such restaurant' });
  require('./admin').resetRestaurant(r.id);
  res.json({ ok: true, reset: r.name, logins_kept: one('SELECT COUNT(*) AS n FROM users WHERE restaurant_id = ?', r.id).n });
}));

// Backups: download one now, or email one to support now.
router.get('/backup', wrap(async (req, res) => {
  const data = require('../ops').buildBackup();
  res.setHeader('Content-Disposition', `attachment; filename="rbooked-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.type('application/json').send(JSON.stringify(data));
}));
router.post('/backup/email', wrap(async (req, res) => {
  res.json({ status: await require('../ops').dailyBackup(new Date(), { force: true }) });
}));

// Diners' restaurant recommendations, most-asked first.
router.get('/suggestions', wrap(async (req, res) => {
  res.json(all(`SELECT lower(name) AS k, MAX(name) AS name, GROUP_CONCAT(DISTINCT NULLIF(zip, '')) AS zips, GROUP_CONCAT(DISTINCT NULLIF(city, '')) AS cities,
    MAX(website) AS website, GROUP_CONCAT(DISTINCT NULLIF(diner_email, '')) AS emails, GROUP_CONCAT(NULLIF(note, ''), ' | ') AS notes,
    COUNT(*) AS times, MAX(created_at) AS last_at, MAX(id) AS id, MAX(status) AS status FROM suggestions GROUP BY lower(name) ORDER BY times DESC, last_at DESC LIMIT 200`));
}));
router.put('/suggestions/:id', wrap(async (req, res) => {
  const st = ['new', 'contacted', 'joined', 'skip'].includes(req.body.status) ? req.body.status : 'new';
  const row = one('SELECT name FROM suggestions WHERE id = ?', Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  run('UPDATE suggestions SET status = ? WHERE lower(name) = lower(?)', st, row.name);
  res.json({ ok: true });
}));

// Guest reviews: support can hide abusive ones (restaurants can't delete).
router.get('/reviews', wrap(async (req, res) => {
  res.json(all(`SELECT v.id, v.stars, v.body, v.guest_label, v.hidden, v.created_at, v.image_id, v.reply, t.name AS restaurant, t.slug
    FROM reviews v JOIN restaurants t ON t.id = v.restaurant_id ORDER BY v.id DESC LIMIT 200`));
}));
router.put('/reviews/:id', wrap(async (req, res) => {
  const r = run('UPDATE reviews SET hidden = ? WHERE id = ?', req.body.hidden ? 1 : 0, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

// Show a restaurant first on the home page (or stop).
router.put('/restaurants/:id/featured', wrap(async (req, res) => {
  const r = one('SELECT id, name FROM restaurants WHERE id = ?', Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'No such restaurant' });
  run('UPDATE restaurants SET featured = ? WHERE id = ?', req.body.featured ? 1 : 0, r.id);
  res.json({ ok: true, name: r.name, featured: !!req.body.featured });
}));

// Change a login's email (support request from the owner).
router.put('/users/email', wrap(async (req, res) => {
  const from = String(req.body.from || '').trim().toLowerCase(); const to = String(req.body.to || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid new email.' });
  const u = one('SELECT id FROM users WHERE email = ?', from);
  if (!u) return res.status(404).json({ error: `No login uses ${from}.` });
  if (one('SELECT id FROM users WHERE email = ? AND id != ?', to, u.id)) return res.status(409).json({ error: 'Another login already uses that email.' });
  run('UPDATE users SET email = ? WHERE id = ?', to, u.id);
  res.json({ ok: true, from, to });
}));

module.exports = router;
