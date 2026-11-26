'use strict';
// Keeping Rbooked healthy: a daily backup emailed to support, and an email when something breaks.
const config = require('./config');
const { one, all, run } = require('./db');

const kvGet = (k) => { try { const r = one('SELECT value FROM ops_kv WHERE key = ?', k); return r ? r.value : null; } catch { return null; } };
const kvSet = (k, v) => { try { run('INSERT OR REPLACE INTO ops_kv (key, value) VALUES (?, ?)', k, String(v)); } catch { /* */ } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Everything needed to rebuild Rbooked. Logins' sessions and one-time links are left out on purpose.
const BACKUP_TABLES = ['restaurants', 'users', 'areas', 'tables', 'table_combos', 'shifts', 'closures', 'reservations', 'guests',
  'menu_items', 'gallery_photos', 'images', 'likes', 'email_log'];
const IMAGE_BUDGET = 20 * 1024 * 1024; // photos are included while the file stays under ~20 MB

function toBase64(v) {
  if (v == null) return null;
  if (typeof v === 'string') return Buffer.from(v, 'binary').toString('base64');
  return Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : v).toString('base64');
}

function buildBackup() {
  const data = { app: 'Rbooked', made_at: new Date().toISOString(), tables: {} };
  let imageBytes = 0; let skipped = 0;
  for (const t of BACKUP_TABLES) {
    let rows;
    try { rows = all(`SELECT * FROM ${t}`); } catch { continue; }
    if (t === 'email_log') rows = rows.map(({ html, ...r }) => r); // the email bodies are large and can be re-sent
    if (t === 'images') {
      rows = rows.map((r) => {
        const size = r.data ? (r.data.byteLength ?? r.data.length ?? 0) : 0;
        if (imageBytes + size > IMAGE_BUDGET) { skipped++; return { ...r, data: null, skipped: true }; }
        imageBytes += size;
        return { ...r, data: toBase64(r.data), encoding: 'base64' };
      });
    }
    data.tables[t] = rows;
  }
  data.counts = Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length]));
  data.photos_left_out = skipped;
  return data;
}

function nyNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Once a day, after 3 AM New York time, email a full backup file to support. Retries hourly if sending fails. */
async function dailyBackup(now = new Date(), { force = false } = {}) {
  const ny = nyNow(now);
  if (!force) {
    if (ny.hour < 3 || kvGet('backup_date') === ny.date) return false;
    const lastTry = Number(kvGet('backup_try') || 0);
    if (now.getTime() - lastTry < 3600000) return false;
  }
  kvSet('backup_try', now.getTime());
  const data = buildBackup();
  const json = JSON.stringify(data);
  const c = data.counts;
  const email = require('./email');
  const status = await email.send({
    to: config.supportEmail, kind: 'backup',
    subject: `Rbooked daily backup ${ny.date}: ${c.restaurants || 0} restaurants, ${c.reservations || 0} reservations`,
    html: email.layout(null, 'Daily backup', `<p>Attached is today's full copy of Rbooked's data (${(json.length / 1048576).toFixed(1)} MB).
      Keep these emails: if anything ever goes wrong, support can restore the site from the newest one.</p>
      <p style="font-size:14px">${Object.entries(c).map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: <b>${v}</b>`).join(' · ')}</p>
      ${data.photos_left_out ? `<p style="font-size:13px;color:#7a6f63">${data.photos_left_out} photos were too big to fit and were left out of today's file.</p>` : ''}
      <p style="font-size:13px;color:#7a6f63">This email also tells you the site and its daily jobs are running. If it ever stops arriving, something is wrong.</p>`),
    attachments: [{ filename: `rbooked-backup-${ny.date}.json`, content: json, contentType: 'application/json' }],
  });
  if (status === 'sent' || status === 'outbox') kvSet('backup_date', ny.date);
  return status;
}

/**
 * Email support when something breaks (a page or job error). The same problem is emailed at most once an hour,
 * and never more than 20 alerts a day, so a bad night can't flood the inbox.
 */
async function alertError(where, err, req) {
  try {
    const msg = String((err && (err.stack || err.message)) || err).slice(0, 3000);
    const firstLine = msg.split('\n')[0].slice(0, 200);
    const key = `alert:${where}:${firstLine}`.slice(0, 250);
    const now = Date.now();
    if (now - Number(kvGet(key) || 0) < 3600000) return false;
    const day = new Date().toISOString().slice(0, 10);
    const n = kvGet(`alerts:${day}`) === null ? 0 : Number(kvGet(`alerts:${day}`));
    if (n >= 20) return false;
    kvSet(key, now); kvSet(`alerts:${day}`, n + 1);
    const email = require('./email');
    await email.send({
      to: config.supportEmail, kind: 'alert',
      subject: `Rbooked problem: ${firstLine}`.slice(0, 150),
      html: email.layout(null, 'Something went wrong on Rbooked', `<p>Where: <b>${esc(where)}</b>${req ? ` (${esc(req.method)} ${esc(String(req.originalUrl || req.url || '').split('?')[0])})` : ''}</p>
        <p>When: ${esc(new Date().toUTCString())}</p>
        <pre style="white-space:pre-wrap;font-size:12px;background:#f5f0e8;padding:12px;border-radius:8px">${esc(msg)}</pre>
        <p style="font-size:13px;color:#7a6f63">You'll get at most one email an hour about the same problem. Forward this to whoever fixes the site.</p>`),
    });
    return true;
  } catch (e) {
    console.error('[alert] could not send', e);
    return false;
  }
}

module.exports = { dailyBackup, buildBackup, alertError };
