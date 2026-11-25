'use strict';
const crypto = require('crypto');
const { one, all, run, tx } = require('./db');
const { findSlot, isTableFree } = require('./availability');
const { zonedToUtc } = require('./time');
const email = require('./email');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}

class BookingError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

function cleanGuest(d) {
  const guest_name = String(d.name || d.guest_name || '').trim().slice(0, 120);
  const guest_email = String(d.email || d.guest_email || '').trim().toLowerCase().slice(0, 200);
  const guest_phone = String(d.phone || d.guest_phone || '').trim().slice(0, 40);
  if (!guest_name) throw new BookingError('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email)) throw new BookingError('Please enter a valid email address.');
  if (guest_phone.replace(/\D/g, '').length < 7) throw new BookingError('Please enter a valid phone number.');
  return {
    guest_name, guest_email, guest_phone,
    notes: String(d.notes || '').slice(0, 500),
    occasion: String(d.occasion || '').slice(0, 60),
  };
}

/**
 * Create a reservation. For guests (online/widget), the slot is re-validated
 * inside a transaction so two people can't grab the same table.
 * opts.admin: staff booking (phone/walk-in); may pick table and bypass online rules.
 */
function createReservation(restaurant, data, opts = {}) {
  const guest = cleanGuest(data);
  const date = String(data.date || '');
  const time = String(data.time || '');
  const party = Number(data.party_size || data.partySize);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new BookingError('Invalid date or time.');
  if (!(party >= 1 && party <= 50)) throw new BookingError('Invalid party size.');
  const source = opts.source || 'online';

  const res = tx(() => {
    let tableId = null;
    let shiftId = null;
    let duration = 90;
    if (opts.admin && data.table_id) {
      const table = one('SELECT * FROM tables WHERE id = ? AND restaurant_id = ?', data.table_id, restaurant.id);
      if (!table) throw new BookingError('Table not found.');
      duration = Number(data.duration_minutes) || 90;
      if (!data.force && !isTableFree(restaurant.id, table.id, date, time, duration)) {
        throw new BookingError(`Table ${table.label} is already booked around that time.`, 409);
      }
      tableId = table.id;
      const slot = findSlot(restaurant, date, time, party, { admin: true });
      shiftId = slot ? slot.shiftId : null;
    } else {
      let slot = findSlot(restaurant, date, time, party, { admin: !!opts.admin });
      if (!slot && opts.admin) {
        // Staff bookings (walk-ins, off-grid times): take any free table that fits.
        const dur = Number(data.duration_minutes) || 90;
        const t = all(`SELECT id FROM tables WHERE restaurant_id = ? AND active = 1 AND min_seats <= ? AND max_seats >= ? ORDER BY max_seats, id`,
          restaurant.id, party, party).find((tb) => isTableFree(restaurant.id, tb.id, date, time, dur));
        if (t) slot = { tableId: t.id, shiftId: null, duration: dur };
      }
      if (!slot) throw new BookingError('Sorry, that time was just taken. Please pick another time.', 409);
      tableId = slot.tableId; shiftId = slot.shiftId; duration = slot.duration;
    }
    const code = newCode();
    const token = crypto.randomBytes(20).toString('hex');
    const startsUtc = zonedToUtc(date, time, restaurant.timezone).toISOString();
    const info = run(
      `INSERT INTO reservations (code, manage_token, restaurant_id, table_id, shift_id, date, time, starts_at_utc,
        duration_minutes, party_size, guest_name, guest_email, guest_phone, notes, occasion, internal_notes, source, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      code, token, restaurant.id, tableId, shiftId, date, time, startsUtc, duration, party,
      guest.guest_name, guest.guest_email, guest.guest_phone, guest.notes, guest.occasion,
      String(data.internal_notes || ''), source, source === 'walk_in' ? 'seated' : 'confirmed',
    );
    return one('SELECT * FROM reservations WHERE id = ?', info.lastInsertRowid);
  });

  if (source !== 'walk_in' && data.send_email !== false) {
    email.sendReservationEmail('confirmation', restaurant, res).catch(() => {});
  }
  if (!opts.admin) email.sendReservationEmail('staff_new', restaurant, res).catch(() => {});
  return res;
}

function cancelReservation(restaurant, reservation, by, notify = true) {
  if (['cancelled', 'completed', 'no_show'].includes(reservation.status)) {
    throw new BookingError(`This reservation is already ${reservation.status.replace('_', '-')}.`);
  }
  run(`UPDATE reservations SET status='cancelled', cancelled_at=datetime('now'), cancelled_by=?, updated_at=datetime('now') WHERE id=?`,
    by, reservation.id);
  const updated = one('SELECT * FROM reservations WHERE id = ?', reservation.id);
  if (notify) email.sendReservationEmail('cancellation', restaurant, updated).catch(() => {});
  if (by === 'guest') email.sendReservationEmail('staff_cancel', restaurant, updated).catch(() => {});
  return updated;
}

function markNoShow(restaurant, reservation, notify = true) {
  run(`UPDATE reservations SET status='no_show', updated_at=datetime('now') WHERE id=?`, reservation.id);
  const updated = one('SELECT * FROM reservations WHERE id = ?', reservation.id);
  if (notify) email.sendReservationEmail('no_show', restaurant, updated).catch(() => {});
  return updated;
}

module.exports = { createReservation, cancelReservation, markNoShow, BookingError };
