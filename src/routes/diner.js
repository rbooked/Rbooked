'use strict';
// Diner sign-in, no password: we email a one-time link. Signed-in diners see their bookings and reviews on /me.
const express = require('express');
const crypto = require('crypto');
const { one, all, run } = require('../db');
const config = require('../config');
const email = require('../email');
const { BookingError } = require('../reservations');
const { wrap } = require('./public');
const reviews = require('../reviews');

const router = express.Router();
const COOKIE = 'rb_diner';
const LINK_MIN = 30;
const SESSION_DAYS = 60;
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const cookies = (req) => require('../auth').parseCookies(req);

function dinerEmail(req) {
  const t = cookies(req)[COOKIE];
  if (!t) return null;
  const row = one("SELECT email, expires_at FROM diner_tokens WHERE token_hash = ? AND kind = 'session'", sha(t));
  return row && row.expires_at > new Date().toISOString() ? row.email : null;
}

router.post('/link', wrap(async (req, res) => {
  const em = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new BookingError('Please enter a valid email address.');
  // One link every 2 minutes per email, so the form can't be used to flood someone's inbox.
  const recent = one(`SELECT token_hash FROM diner_tokens WHERE email = ? AND kind = 'link' AND created_at > datetime('now', '-2 minutes')`, em);
  if (!recent) {
    run("DELETE FROM diner_tokens WHERE email = ? AND kind = 'link'", em);
    const token = crypto.randomBytes(24).toString('base64url');
    run("INSERT INTO diner_tokens (token_hash, email, kind, expires_at) VALUES (?, ?, 'link', ?)", sha(token), em, new Date(Date.now() + LINK_MIN * 60000).toISOString());
    const url = `${config.baseUrl}/me?login=${encodeURIComponent(token)}`;
    await email.send({
      to: em, kind: 'diner_login', subject: 'Your Rbooked login link',
      html: email.layout(null, 'Log in to Rbooked', `<p>Tap the button to see your bookings and reviews on Rbooked.</p>
        <p style="text-align:center"><a href="${email.esc(url)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">Log me in</a></p>
        <p style="font-size:13px;color:#7a6f63">The link works once, for ${LINK_MIN} minutes. If you didn't ask for it, just ignore this email.</p>`),
    });
  }
  res.json({ ok: true }); // same answer either way
}));

router.post('/login', wrap(async (req, res) => {
  const t = String(req.body.token || '');
  const row = t && one("SELECT * FROM diner_tokens WHERE token_hash = ? AND kind = 'link'", sha(t));
  if (!row || row.expires_at < new Date().toISOString()) throw new BookingError('This login link has expired or was already used. Ask for a new one.', 400);
  run('DELETE FROM diner_tokens WHERE token_hash = ?', row.token_hash); // one-time
  const session = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  run("INSERT INTO diner_tokens (token_hash, email, kind, expires_at) VALUES (?, ?, 'session', ?)", sha(session), row.email, expires.toISOString());
  run("DELETE FROM diner_tokens WHERE expires_at < ?", new Date().toISOString());
  res.setHeader('Set-Cookie', `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${config.baseUrl.startsWith('https') ? '; Secure' : ''}`);
  res.json({ ok: true, email: row.email });
}));

router.post('/logout', wrap(async (req, res) => {
  const t = cookies(req)[COOKIE];
  if (t) run('DELETE FROM diner_tokens WHERE token_hash = ?', sha(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}));

router.get('/me', wrap(async (req, res) => {
  const em = dinerEmail(req);
  if (!em) return res.json({ email: null });
  const rows = all(`SELECT v.*, r.name AS r_name, r.slug AS r_slug, r.city AS r_city, r.logo_url AS r_logo, r.accent_color AS r_color
    FROM reservations v JOIN restaurants r ON r.id = v.restaurant_id WHERE lower(v.guest_email) = ? ORDER BY v.starts_at_utc DESC LIMIT 100`, em);
  const mine = Object.fromEntries(all(`SELECT w.reservation_id, w.stars FROM reviews w JOIN reservations v ON v.id = w.reservation_id WHERE lower(v.guest_email) = ?`, em).map((x) => [x.reservation_id, x.stars]));
  const now = new Date();
  const item = (v) => ({
    restaurant: { name: v.r_name, slug: v.r_slug, city: v.r_city, logo_url: v.r_logo || '', accent_color: v.r_color || '' },
    code: v.code, date: v.date, time: v.time, party_size: v.party_size, status: v.status,
    manage_url: `/reservation?t=${encodeURIComponent(v.manage_token)}`,
    review_url: reviews.canReview(v, now) || mine[v.id] ? `/review?t=${encodeURIComponent(v.manage_token)}` : null,
    my_stars: mine[v.id] || null,
  });
  const upcoming = rows.filter((v) => ['confirmed', 'seated'].includes(v.status) && new Date(v.starts_at_utc).getTime() + (v.duration_minutes || 90) * 60000 > now.getTime()).reverse();
  const past = rows.filter((v) => !upcoming.includes(v));
  const name = (rows.find((v) => v.guest_name) || {}).guest_name || '';
  res.json({ email: em, first_name: String(name).split(' ')[0] || '', upcoming: upcoming.map(item), past: past.map(item),
    visits: rows.filter((v) => v.status === 'completed').length, reviews: Object.keys(mine).length });
}));

module.exports = router;
module.exports.dinerEmail = dinerEmail;
