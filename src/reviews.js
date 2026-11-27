'use strict';
// Verified reviews: only guests who booked on Rbooked and were seated (status "completed") can review,
// once per reservation, using the private link from their "How was it?" email.
const { one, all, run } = require('./db');
const config = require('./config');

const REVIEW_DAYS = 30; // how long after the visit the link works
const EDIT_DAYS = 7; // a guest can change their review for a week
const ASK_AFTER_H = 2; // email goes out ~2 hours after the table was finished
const ASK_WITHIN_H = 72; // don't ask about old visits

/** "Maria Lopez" -> "Maria L." so reviews stay friendly but private. */
const shortName = (n) => {
  const parts = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Rbooked guest';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};

const visitEnd = (res) => new Date(new Date(res.starts_at_utc).getTime() + (res.duration_minutes || 90) * 60000);

function canReview(res, now = new Date()) {
  if (!res || res.status !== 'completed') return false;
  if (!res.guest_email || res.guest_email === 'walkin@guest.local') return false;
  return now - visitEnd(res) < REVIEW_DAYS * 86400000;
}

function publicReview(x) {
  return {
    id: x.id, name: x.guest_label, stars: x.stars, body: x.body, photo: x.image_id ? `/img/${x.image_id}` : null,
    date: String(x.created_at || '').slice(0, 10), party: x.party_size || null,
    reply: x.reply || null, reply_date: x.reply_at ? String(x.reply_at).slice(0, 10) : null, verified: true,
  };
}

/** Rating summary + newest visible reviews for a restaurant page. */
function forRestaurant(rid, limit = 20) {
  const s = one('SELECT COUNT(*) AS n, AVG(stars) AS avg FROM reviews WHERE restaurant_id = ? AND hidden = 0', rid);
  const dist = Object.fromEntries([5, 4, 3, 2, 1].map((k) => [k, 0]));
  for (const r of all('SELECT stars, COUNT(*) AS n FROM reviews WHERE restaurant_id = ? AND hidden = 0 GROUP BY stars', rid)) dist[r.stars] = r.n;
  const rows = all(`SELECT v.*, r.party_size FROM reviews v LEFT JOIN reservations r ON r.id = v.reservation_id
    WHERE v.restaurant_id = ? AND v.hidden = 0 ORDER BY v.id DESC LIMIT ?`, rid, limit);
  return { count: s.n, avg: s.n ? Math.round(s.avg * 10) / 10 : null, dist, list: rows.map(publicReview) };
}

/** Background job: send "How was it?" a couple of hours after guests finish their meal. */
async function askForReviews(now = new Date()) {
  const email = require('./email');
  const since = new Date(now - ASK_WITHIN_H * 3600000).toISOString();
  const rows = all(`SELECT r.* FROM reservations r WHERE r.status = 'completed' AND r.review_asked_at IS NULL
    AND r.starts_at_utc > ? AND r.guest_email != 'walkin@guest.local' LIMIT 40`, since);
  let n = 0;
  for (const res of rows) {
    if (now - visitEnd(res) < ASK_AFTER_H * 3600000) continue;
    if (one('SELECT id FROM reviews WHERE reservation_id = ?', res.id)) { run("UPDATE reservations SET review_asked_at = datetime('now') WHERE id = ?", res.id); continue; }
    const restaurant = one('SELECT * FROM restaurants WHERE id = ?', res.restaurant_id);
    run("UPDATE reservations SET review_asked_at = datetime('now') WHERE id = ?", res.id);
    await email.sendReviewAsk(restaurant, res, `${config.baseUrl}/review?t=${encodeURIComponent(res.manage_token)}`);
    n++;
  }
  return n;
}

module.exports = { shortName, canReview, publicReview, forRestaurant, askForReviews, REVIEW_DAYS, EDIT_DAYS, visitEnd };
