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

const memberIds = (combo) => String(combo.table_ids || '').split(',').map(Number).filter(Boolean);

/** Map of combo id -> member table ids for a restaurant. */
function comboMap(restaurantId) {
  const m = new Map();
  for (const c of all('SELECT id, table_ids FROM table_combos WHERE restaurant_id = ?', restaurantId)) m.set(c.id, memberIds(c));
  return m;
}

/** Tables a reservation physically occupies (one table, or every table in its combination). */
function occupiedTables(res, combos) {
  if (res.combo_id && combos.has(res.combo_id)) return combos.get(res.combo_id);
  return res.table_id ? [res.table_id] : [];
}

function activeReservations(restaurantId, date, ignoreId = 0) {
  return all(`SELECT id, table_id, combo_id, time, duration_minutes, party_size, shift_id FROM reservations
     WHERE restaurant_id = ? AND date = ? AND status IN ${ACTIVE} AND id != ?`, restaurantId, date, ignoreId);
}

/** Are all of these tables free between start and start+duration? */
function tablesFree(tableIds, reservations, combos, startMin, duration) {
  return !reservations.some((r) => {
    const rs = toMin(r.time);
    if (!(rs < startMin + duration && rs + r.duration_minutes > startMin)) return false;
    const occ = occupiedTables(r, combos);
    return occ.some((t) => tableIds.includes(t));
  });
}

/**
 * Seating options for a party: single tables first (smallest that fits), then
 * table combinations, so tables are only joined when no single table works.
 */
function seatingOptions(restaurantId, party, admin) {
  const tables = all(
    `SELECT * FROM tables WHERE restaurant_id = ? AND active = 1 AND min_seats <= ? AND max_seats >= ?
     ${admin ? '' : 'AND online_bookable = 1'} ORDER BY max_seats, id`, restaurantId, party, party,
  ).map((t) => ({ tableId: t.id, comboId: null, tableIds: [t.id], max: t.max_seats }));
  const activeTables = new Map(all('SELECT id, active FROM tables WHERE restaurant_id = ?', restaurantId).map((t) => [t.id, t.active]));
  const combos = all(
    `SELECT * FROM table_combos WHERE restaurant_id = ? AND active = 1 AND min_seats <= ? AND max_seats >= ?
     ${admin ? '' : 'AND online_bookable = 1'} ORDER BY max_seats, id`, restaurantId, party, party,
  ).map((c) => ({ tableId: null, comboId: c.id, tableIds: memberIds(c), max: c.max_seats }))
    .filter((c) => c.tableIds.length && c.tableIds.every((id) => activeTables.get(id)));
  return [...tables, ...combos];
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

  const options = seatingOptions(restaurant.id, party, opts.admin);
  const reservations = activeReservations(restaurant.id, date, opts.ignoreReservationId || 0);
  const combos = comboMap(restaurant.id);

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
      let pick = null;
      if (available) {
        pick = options.find((o) => tablesFree(o.tableIds, reservations, combos, t, shift.turn_minutes)) || null;
        if (!pick) available = false;
      }
      result.slots.push({
        time, shiftId: shift.id, shiftName: shift.name, available,
        tableId: pick ? pick.tableId : null, comboId: pick ? pick.comboId : null, duration: shift.turn_minutes,
      });
    }
  }
  return result;
}

/** Re-check a specific time right before booking (inside a transaction). */
function findSlot(restaurant, date, time, partySize, opts = {}) {
  const av = getAvailability(restaurant, date, partySize, opts);
  return av.slots.find((s) => s.time === time && s.available) || null;
}

/** Is a specific table (tableId) or combination (comboId) free at a given time? */
function isSeatingFree(restaurantId, { tableId, comboId }, date, time, duration, ignoreId = 0) {
  const combos = comboMap(restaurantId);
  const ids = comboId ? (combos.get(Number(comboId)) || []) : [Number(tableId)];
  return tablesFree(ids, activeReservations(restaurantId, date, ignoreId), combos, toMin(time), duration);
}
const isTableFree = (restaurantId, tableId, date, time, duration, ignoreId = 0) =>
  isSeatingFree(restaurantId, { tableId }, date, time, duration, ignoreId);

/** First free single table or combination that fits, for staff bookings at any time. */
function anyFreeSeating(restaurantId, party, date, time, duration) {
  return seatingOptions(restaurantId, party, true).find((o) =>
    isSeatingFree(restaurantId, o, date, time, duration)) || null;
}

module.exports = { getAvailability, findSlot, isTableFree, isSeatingFree, anyFreeSeating, shiftsForDate, comboMap, occupiedTables };
