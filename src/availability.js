'use strict';
const { one, all } = require('./db');
const { toMin, toHHMM, weekday, nowInZone, addDays } = require('./time');

const ACTIVE = "('confirmed','seated')";

function shiftsForDate(restaurantId, date) {
  const wd = String(weekday(date));
  return all('SELECT * FROM shifts WHERE restaurant_id = ? AND active = 1 ORDER BY start_time', restaurantId)
    .filter((s) => s.days.split(',').map((x) => x.trim()).includes(wd));
}

function isClosed(restaurantId, date) {
  return !!one('SELECT id FROM closures WHERE restaurant_id = ? AND date = ?', restaurantId, date);
}

/**
 * Compute bookable slots for a date and party size.
 * opts.admin: include tables not bookable online, ignore notice/window rules.
 * opts.ignoreReservationId: skip one reservation (when moving/editing it).
 */
function getAvailability(restaurant, date, partySize, opts = {}) {
  const party = Number(partySize);
  const result = { date, partySize: party, closed: false, slots: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(party >= 1)) return result;
  if (!opts.admin && party > restaurant.max_party_size) return { ...result, tooLarge: true };
  if (isClosed(restaurant.id, date)) return { ...result, closed: true };

  const now = nowInZone(restaurant.timezone);
  if (!opts.admin) {
    if (date < now.date) return result;
    if (date > addDays(now.date, restaurant.booking_window_days)) return { ...result, outsideWindow: true };
  }

  const tables = all(
    `SELECT * FROM tables WHERE restaurant_id = ? AND active = 1 AND min_seats <= ? AND max_seats >= ?
     ${opts.admin ? '' : 'AND online_bookable = 1'} ORDER BY max_seats, id`,
    restaurant.id, party, party,
  );
  const reservations = all(
    `SELECT id, table_id, time, duration_minutes, party_size, shift_id FROM reservations
     WHERE restaurant_id = ? AND date = ? AND status IN ${ACTIVE} AND id != ?`,
    restaurant.id, date, opts.ignoreReservationId || 0,
  );

  for (const shift of shiftsForDate(restaurant.id, date)) {
    const start = toMin(shift.start_time);
    const end = toMin(shift.end_time);
    for (let t = start; t <= end; t += shift.slot_interval) {
      const time = toHHMM(t);
      let available = true;
      if (!opts.admin && date === now.date && t < now.minutes + restaurant.min_notice_minutes) available = false;

      if (available && shift.max_covers_per_slot > 0) {
        const covers = reservations.filter((r) => r.time === time).reduce((s, r) => s + r.party_size, 0);
        if (covers + party > shift.max_covers_per_slot) available = false;
      }
      let tableId = null;
      if (available) {
        tableId = pickTable(tables, reservations, t, shift.turn_minutes);
        if (!tableId) available = false;
      }
      result.slots.push({ time, shiftId: shift.id, shiftName: shift.name, available, tableId, duration: shift.turn_minutes });
    }
  }
  return result;
}

function tableIsFree(tableId, reservations, startMin, duration) {
  return !reservations.some((r) => {
    if (r.table_id !== tableId) return false;
    const rs = toMin(r.time);
    return rs < startMin + duration && rs + r.duration_minutes > startMin;
  });
}

function pickTable(tables, reservations, startMin, duration) {
  const t = tables.find((tb) => tableIsFree(tb.id, reservations, startMin, duration));
  return t ? t.id : null;
}

/** Re-check a specific time right before booking (inside a transaction). */
function findSlot(restaurant, date, time, partySize, opts = {}) {
  const av = getAvailability(restaurant, date, partySize, opts);
  return av.slots.find((s) => s.time === time && s.available) || null;
}

/** Is a specific table free for an admin-chosen time? */
function isTableFree(restaurantId, tableId, date, time, duration, ignoreId = 0) {
  const reservations = all(
    `SELECT id, table_id, time, duration_minutes FROM reservations
     WHERE restaurant_id = ? AND date = ? AND table_id = ? AND status IN ${ACTIVE} AND id != ?`,
    restaurantId, date, tableId, ignoreId,
  );
  return tableIsFree(Number(tableId), reservations, toMin(time), duration);
}

module.exports = { getAvailability, findSlot, isTableFree, shiftsForDate };
