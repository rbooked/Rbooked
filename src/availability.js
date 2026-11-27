'use strict';
const { one, all } = require('./db');
const { toMin, toHHMM, weekday, nowInZone, addDays } = require('./time');
const { turnFor } = require('../public/js/matcher');

const ACTIVE = "('confirmed','seated')";

/** A special day: closed (no times) or special hours that replace the usual services for that date only. */
function specialDay(restaurantId, date) {
  return one('SELECT * FROM closures WHERE restaurant_id = ? AND date = ? ORDER BY id DESC LIMIT 1', restaurantId, date) || null;
}

function shiftsForDate(restaurantId, date) {
  const all_ = all('SELECT * FROM shifts WHERE restaurant_id = ? AND active = 1 ORDER BY start_time', restaurantId);
  const sp = specialDay(restaurantId, date);
  if (sp && sp.open_time && sp.close_time) {
    // Special hours: one service for the day, using the slot spacing and turn time of the usual services.
    const wd = String(weekday(date));
    const base = all_.find((s) => s.days.split(',').map((x) => x.trim()).includes(wd)) || all_[0];
    if (!base) return [];
    return [{ ...base, name: sp.reason || 'Special hours', start_time: sp.open_time, end_time: sp.close_time }];
  }
  const wd = String(weekday(date));
  return all_.filter((s) => s.days.split(',').map((x) => x.trim()).includes(wd));
}

function isClosed(restaurantId, date) {
  const sp = specialDay(restaurantId, date);
  return !!sp && !(sp.open_time && sp.close_time);
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

// A seated party that is running over time keeps its table: treat it as staying at least this much longer.
const OVERTIME_HOLD_MIN = 30;

function activeReservations(restaurantId, date, ignoreId = 0) {
  const rows = all(`SELECT id, table_id, combo_id, time, duration_minutes, party_size, shift_id, status FROM reservations
     WHERE restaurant_id = ? AND date = ? AND status IN ${ACTIVE} AND id != ?`, restaurantId, date, ignoreId);
  const r = one('SELECT timezone FROM restaurants WHERE id = ?', restaurantId);
  const now = nowInZone((r && r.timezone) || 'America/New_York');
  if (date !== now.date) return rows;
  return rows.map((x) => {
    if (x.status !== 'seated') return x;
    const until = Math.max(toMin(x.time) + x.duration_minutes, now.minutes + OVERTIME_HOLD_MIN);
    return { ...x, duration_minutes: until - toMin(x.time) };
  });
}

/**
 * Staff can add bookings with no table when the room is full. Online, those
 * parties still need somewhere to sit: only offer a table if, after taking it,
 * every unassigned party at that time can still be placed on a free table.
 */
function roomForUnassigned(pick, options, reservations, combos, startMin, duration) {
  const waiting = reservations.filter((r) => !r.table_id && !r.combo_id
    && toMin(r.time) < startMin + duration && toMin(r.time) + r.duration_minutes > startMin)
    .sort((a, b) => b.party_size - a.party_size);
  if (!waiting.length) return true;
  const used = new Set(pick.tableIds);
  for (const w of waiting) {
    const o = options.find((x) => w.party_size <= x.max && x.tableIds.every((id) => !used.has(id))
      && tablesFree(x.tableIds, reservations, combos, Math.max(startMin, toMin(w.time)), Math.min(duration, w.duration_minutes)));
    if (!o) return false;
    o.tableIds.forEach((id) => used.add(id));
  }
  return true;
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

/** Every active table and combination, smallest first (for placing parties staff added without a table). */
function allSeating(restaurantId) {
  const t = all('SELECT id, max_seats FROM tables WHERE restaurant_id = ? AND active = 1 ORDER BY max_seats, id', restaurantId)
    .map((x) => ({ tableIds: [x.id], max: x.max_seats }));
  const active = new Set(t.map((x) => x.tableIds[0]));
  const c = all('SELECT table_ids, max_seats FROM table_combos WHERE restaurant_id = ? AND active = 1 ORDER BY max_seats, id', restaurantId)
    .map((x) => ({ tableIds: memberIds(x), max: x.max_seats })).filter((x) => x.tableIds.length && x.tableIds.every((id) => active.has(id)));
  return [...t, ...c];
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
  // Any table (online or not) can take a party staff added without a table.
  const waitOptions = opts.admin ? [] : allSeating(restaurant.id);

  for (const shift of shiftsForDate(restaurant.id, date)) {
    // How long this party holds the table: set by party size, or the service's turn time.
    const duration = turnFor(restaurant.turn_times, party, shift.turn_minutes);
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
        pick = options.find((o) => tablesFree(o.tableIds, reservations, combos, t, duration)
          && (opts.admin || roomForUnassigned(o, waitOptions, reservations, combos, t, duration))) || null;
        if (!pick) available = false;
      }
      result.slots.push({
        time, shiftId: shift.id, shiftName: shift.name, available,
        tableId: pick ? pick.tableId : null, comboId: pick ? pick.comboId : null, duration,
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

/** The next date (after `date`, within `days`) that has bookable services, or null. */
function nextOpenDate(restaurantId, date, days = 30) {
  for (let i = 1; i <= days; i++) {
    const d = addDays(date, i);
    if (!isClosed(restaurantId, d) && shiftsForDate(restaurantId, d).length) return d;
  }
  return null;
}

module.exports = { nextOpenDate, specialDay, getAvailability, findSlot, isTableFree, isSeatingFree, anyFreeSeating, shiftsForDate, comboMap, occupiedTables };
