'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
require('./db-node'); // no-op when another engine (Cloudflare) is already plugged in
const { all, one } = require('./db');
const billing = require('./billing');
const jobs = require('./jobs');
const { router: publicRouter } = require('./routes/public');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Stripe needs the raw body to verify signatures, so mount before express.json().
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), billing.webhook);

// Photo and logo uploads arrive as base64 JSON (resized in the browser first).
app.use('/api/admin/images', express.json({ limit: '6mb' }));
app.use(express.json({ limit: '200kb' }));

// Uploaded restaurant photos and logos.
app.get('/img/:id', (req, res) => {
  const img = require('./db').one('SELECT mime, data FROM images WHERE id = ?', Number(req.params.id));
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.end(Buffer.from(img.data));
});

// The public booking API is called from restaurants' own websites by the widget.
app.use('/api/public', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Simple in-memory rate limit for public write endpoints.
const hits = new Map();
app.use(['/api/public', '/api/auth'], (req, res, next) => {
  if (req.method !== 'POST') return next();
  const key = req.ip;
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(key, arr);
  if (arr.length > 30) return res.status(429).json({ error: 'Too many requests, please slow down.' });
  next();
});

app.use('/api/public', publicRouter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));

// Restaurants embed /embed.html in an iframe on their own sites; everything else stays same-origin.
app.use((req, res, next) => {
  if (!req.path.startsWith('/embed')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Local-only email outbox viewer (when SMTP is not configured).
if (!config.isProduction) {
  app.get('/dev/outbox', (req, res) => {
    const rows = all('SELECT id, to_addr, subject, kind, status, created_at FROM email_log ORDER BY id DESC LIMIT 200');
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Email outbox</title>
      <style>body{font-family:system-ui;margin:24px;background:#faf7f2}table{border-collapse:collapse;width:100%;background:#fff}
      td,th{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;font-size:14px}</style>
      <h1>Email outbox <small style="font-weight:normal;color:#777">(dev only, newest first)</small></h1>
      <table><tr><th>When (UTC)</th><th>Kind</th><th>To</th><th>Subject</th><th>Status</th></tr>
      ${rows.map((r) => `<tr><td>${r.created_at}</td><td>${r.kind}</td><td>${r.to_addr.replace(/</g, '&lt;')}</td>
        <td><a href="/dev/outbox/${r.id}" target="_blank">${r.subject.replace(/</g, '&lt;')}</a></td><td>${r.status}</td></tr>`).join('')}
      </table>`);
  });
  app.get('/dev/outbox/:id', (req, res) => {
    const r = one('SELECT html FROM email_log WHERE id = ?', req.params.id);
    if (!r) return res.sendStatus(404);
    res.type('html').send(r.html);
  });
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

// On Cloudflare the same folder is served as static assets before requests reach the app.
app.use(express.static(path.join(typeof __dirname === 'string' ? __dirname : '.', '..', 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Rbooked running at ${config.baseUrl} (port ${config.port})`);
    console.log(`Email: ${config.resendApiKey ? 'Resend' : config.smtp.host ? `SMTP ${config.smtp.host}` : 'outbox mode, see /dev/outbox'}`);
    console.log(`Billing: ${billing.stripe() ? 'Stripe' : 'demo mode (no STRIPE_SECRET_KEY)'}`);
  });
  jobs.start();
}

module.exports = app;
