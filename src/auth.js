'use strict';
const crypto = require('crypto');
const { one, run } = require('./db');
const config = require('./config');

const COOKIE = 'tb_session';
const SESSION_DAYS = 14;

// Passwords: PBKDF2-SHA256 (works on Node.js and Cloudflare). Older scrypt hashes still verify on Node.js.
const ITER = 100000;
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `pbkdf2$${ITER}$${salt}$${crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256').toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const s = String(stored);
  let test; let ref;
  if (s.startsWith('pbkdf2$')) {
    const [, iter, salt, hash] = s.split('$');
    if (!salt || !hash) return false;
    test = crypto.pbkdf2Sync(pw, salt, Number(iter), 32, 'sha256'); ref = Buffer.from(hash, 'hex');
  } else {
    const [salt, hash] = s.split(':');
    if (!salt || !hash || !crypto.scryptSync) return false;
    test = crypto.scryptSync(pw, salt, 64); ref = Buffer.from(hash, 'hex');
  }
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

const sign = (v) => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('hex').slice(0, 32);

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', token, userId, expires.toISOString());
  res.setHeader('Set-Cookie', `${COOKIE}=${token}.${sign(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${config.baseUrl.startsWith('https') ? '; Secure' : ''}`);
}

function destroySession(req, res) {
  const raw = parseCookies(req)[COOKIE];
  if (raw) run('DELETE FROM sessions WHERE token = ?', raw.split('.')[0]);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function loadUser(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [token, sig] = raw.split('.');
  if (!token || sig !== sign(token)) return null;
  const row = one(`SELECT u.id, u.name, u.email, u.role, u.restaurant_id FROM sessions s JOIN users u ON u.id = s.user_id
                   WHERE s.token = ? AND s.expires_at > ?`, token, new Date().toISOString());
  return row || null;
}

function requireAuth(req, res, next) {
  const user = loadUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in.' });
  req.user = user;
  req.restaurant = one('SELECT * FROM restaurants WHERE id = ?', user.restaurant_id);
  next();
}

module.exports = { parseCookies, hashPassword, verifyPassword, createSession, destroySession, requireAuth, loadUser };
