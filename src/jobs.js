'use strict';
const { all, one, run } = require('./db');
const email = require('./email');
const { markNoShow } = require('./reservations');
const config = require('./config');

async function sendReminders(now = new Date()) {
  const rows = all(`SELECT r.*, x.reminder_hours FROM reservations r JOIN restaurants x ON x.id = r.restaurant_id
    WHERE r.status = 'confirmed' AND r.reminder_sent_at IS NULL AND r.starts_at_utc > ? AND x.reminder_hours > 0`, now.toISOString());
  let n = 0;
  for (const res of rows) {
    const start = new Date(res.starts_at_utc);
    const hoursUntil = (start - now) / 3600000;
    // Skip bookings made inside the reminder window less than 2h ago (they just got a confirmation).
    const ageH = (now - new Date(res.created_at.replace(' ', 'T') + 'Z')) / 3600000;
    if (hoursUntil <= res.reminder_hours && ageH >= 2) {
      const restaurant = one('SELECT * FROM restaurants WHERE id = ?', res.restaurant_id);
      run(`UPDATE reservations SET reminder_sent_at = datetime('now') WHERE id = ?`, res.id);
      await email.sendReservationEmail('reminder', restaurant, res);
      n++;
    }
  }
  return n;
}

function autoNoShows(now = new Date()) {
  const rows = all(`SELECT r.* FROM reservations r JOIN restaurants x ON x.id = r.restaurant_id
    WHERE r.status = 'confirmed' AND COALESCE(r.keep_late, 0) = 0 AND x.auto_no_show = 1 AND r.starts_at_utc < ?`, now.toISOString());
  let n = 0;
  for (const res of rows) {
    const restaurant = one('SELECT * FROM restaurants WHERE id = ?', res.restaurant_id);
    const deadline = new Date(res.starts_at_utc).getTime() + restaurant.no_show_grace_minutes * 60000;
    // No email when it happens on its own: staff often bring late guests back.
    if (now.getTime() >= deadline) { markNoShow(restaurant, res, false); n++; }
  }
  return n;
}

function autoComplete(now = new Date()) {
  // Seated tables whose turn ended over an hour ago are closed out as completed.
  const rows = all(`SELECT id, starts_at_utc, duration_minutes FROM reservations WHERE status = 'seated'`);
  for (const r of rows) {
    if (new Date(r.starts_at_utc).getTime() + (r.duration_minutes + 60) * 60000 < now.getTime()) {
      run(`UPDATE reservations SET status='completed', updated_at=datetime('now') WHERE id = ?`, r.id);
    }
  }
}

async function trialNotices(now = new Date()) {
  if (require('./billing').billingOff()) return; // no "trial ending" emails until billing is turned on
  const rows = all(`SELECT * FROM restaurants WHERE subscription_status = 'trialing'`);
  for (const r of rows) {
    const daysLeft = Math.ceil((new Date(r.trial_ends_at) - now) / 86400000);
    const marker = daysLeft <= 1 ? 1 : daysLeft <= 7 ? 7 : 0;
    if (marker && daysLeft > 0 && r.trial_notice_sent !== marker) {
      const owner = one(`SELECT email FROM users WHERE restaurant_id = ? AND role = 'owner' ORDER BY id LIMIT 1`, r.id);
      if (owner) await email.sendTrialEnding(r, owner.email, daysLeft);
      run('UPDATE restaurants SET trial_notice_sent = ? WHERE id = ?', marker, r.id);
    }
  }
}

async function runAll() {
  try {
    await sendReminders();
    autoNoShows();
    autoComplete();
    await trialNotices();
    run(`DELETE FROM sessions WHERE expires_at < ?`, new Date().toISOString());
  } catch (e) {
    console.error('[jobs]', e);
    await require('./ops').alertError('scheduled jobs (reminders, no-shows)', e);
  }
  try { await require('./ops').dailyBackup(); } catch (e) { console.error('[backup]', e); await require('./ops').alertError('daily backup', e); }
}

function start() {
  setTimeout(runAll, 5000);
  return setInterval(runAll, config.jobIntervalSeconds * 1000);
}

module.exports = { start, runAll, sendReminders, autoNoShows };
