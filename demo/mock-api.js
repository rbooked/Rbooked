/* Tablebird live demo: runs the whole backend inside the browser.
   It answers the same /api/... calls the real server does, keeps data in this
   browser's storage, and records every email in a demo inbox. */
(function () {
  const KEY = 'tablebird_demo_v1';
  const mem = {};
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return mem.db || null; } },
    set(v) { mem.db = v; try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* memory only */ } },
  };

  // ---------- time helpers (same logic as src/time.js) ----------
  function partsInZone(date, tz) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  }
  function offsetMs(date, tz) { const p = partsInZone(date, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000; }
  function zonedToUtc(ds, ts, tz) {
    const [y, m, d] = ds.split('-').map(Number); const [h, mi] = ts.split(':').map(Number);
    const g = Date.UTC(y, m - 1, d, h, mi); let t = g - offsetMs(new Date(g), tz); t = g - offsetMs(new Date(t), tz); return new Date(t);
  }
  function nowInZone(tz) { const p = partsInZone(new Date(), tz); return { date: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`, minutes: p.h * 60 + p.mi }; }
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const addDays = (ds, n) => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const weekday = (ds) => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const prettyTime = (t) => { const m = toMin(t); const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const prettyDate = (ds) => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }); };
  const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- seed ----------
  const ZIPS = {
    10001: [40.7506, -73.9972, 'New York', 'NY'], 10011: [40.7402, -73.9996, 'New York', 'NY'], 10013: [40.7201, -74.0049, 'New York', 'NY'],
    10003: [40.7318, -73.9893, 'New York', 'NY'], 10019: [40.7651, -73.9858, 'New York', 'NY'], 11201: [40.6947, -73.9904, 'Brooklyn', 'NY'],
    94103: [37.7725, -122.4147, 'San Francisco', 'CA'], 94110: [37.7509, -122.4153, 'San Francisco', 'CA'], 94102: [37.7793, -122.4193, 'San Francisco', 'CA'],
    97205: [45.5205, -122.688, 'Portland', 'OR'], 97209: [45.5287, -122.6835, 'Portland', 'OR'], 97214: [45.5136, -122.6417, 'Portland', 'OR'], 97201: [45.5079, -122.6905, 'Portland', 'OR'],
    60607: [41.8721, -87.6578, 'Chicago', 'IL'], 60601: [41.8858, -87.6229, 'Chicago', 'IL'], 78701: [30.2711, -97.7437, 'Austin', 'TX'], 78704: [30.2428, -97.7658, 'Austin', 'TX'],
    90012: [34.0614, -118.2385, 'Los Angeles', 'CA'], 90028: [34.0997, -118.3264, 'Los Angeles', 'CA'], 33130: [25.7673, -80.2047, 'Miami', 'FL'], 33139: [25.7826, -80.1341, 'Miami Beach', 'FL'],
    30303: [33.7525, -84.3888, 'Atlanta', 'GA'], 98101: [47.6114, -122.3305, 'Seattle', 'WA'], '02108': [42.3576, -71.0636, 'Boston', 'MA'], 20001: [38.9123, -77.0177, 'Washington', 'DC'],
  };
  const RESTAURANTS = [
    ['Ember & Rye', 'New American', 3, '10011', '212 W 18th St', 'America/New_York', 'Wood-fired seasonal plates and a deep rye whiskey list.', '#b45309'],
    ['Little Saffron', 'Indian', 2, '10001', '341 W 29th St', 'America/New_York', 'Regional Indian cooking with a tandoor at its heart.', '#c2410c'],
    ['Osteria Lume', 'Italian', 3, '10013', '88 Grand St', 'America/New_York', 'Handmade pasta, natural wine, candlelit corners.', '#9f1239'],
    ['Kumo Sushi Bar', 'Japanese', 4, '10011', '17 W 20th St', 'America/New_York', 'Omakase counter and a la carte sushi.', '#1e3a8a'],
    ['Marrow & Vine', 'Steakhouse', 4, '94103', '1001 Mission St', 'America/Los_Angeles', 'Dry-aged steaks and California cabernet.', '#7f1d1d'],
    ['Tía Luz Cocina', 'Mexican', 2, '94110', '2940 24th St', 'America/Los_Angeles', 'Masa made daily, mezcal flights, sunny patio.', '#15803d'],
    ['Fern & Fig', 'Vegetarian', 2, '97214', '1300 SE Morrison St', 'America/Los_Angeles', 'Produce-driven vegetarian plates from local farms.', '#4d7c0f'],
    ['Harbor Oyster House', 'Seafood', 3, '97209', '1220 NW Glisan St', 'America/Los_Angeles', 'Pacific oysters, chowder, and whole grilled fish.', '#0e7490'],
    ['The Copper Kettle', 'Gastropub', 2, '97205', '725 SW 10th Ave', 'America/Los_Angeles', 'Pub classics, 24 taps, and a cozy fireplace.', '#a16207'],
    ['Smoke Signal BBQ', 'Barbecue', 2, '78701', '501 Congress Ave', 'America/Chicago', 'Central Texas brisket, ribs and sides.', '#7c2d12'],
    ['Pilsen Table', 'Latin American', 2, '60607', '1430 W Taylor St', 'America/Chicago', 'Neighborhood spot for arepas, ceviche and cocktails.', '#be185d'],
    ['Sol y Sal', 'Spanish', 3, '33130', '1200 Brickell Ave', 'America/New_York', 'Tapas, paella for two, and a long sherry list.', '#b91c1c'],
    ['Silver Lake Noodle', 'Thai', 2, '90028', '6300 Sunset Blvd', 'America/Los_Angeles', 'Boat noodles, khao soi and late-night curries.', '#7e22ce'],
  ];
  const FIRST = ['Ava', 'Liam', 'Maya', 'Noah', 'Sofia', 'Ethan', 'Zoe', 'Lucas', 'Priya', 'Omar', 'Grace', 'Diego', 'Hana', 'Sam'];
  const LAST = ['Johnson', 'Kim', 'Garcia', 'Patel', 'Nguyen', 'Brown', 'Rossi', 'Cohen', 'Okafor', 'Silva', 'Lee', 'Martin'];

  function seed() {
    const db = { seq: 1, restaurants: [], users: [], areas: [], tables: [], shifts: [], closures: [], reservations: [], emails: [], session: null };
    const id = () => db.seq++;
    RESTAURANTS.forEach(([name, cuisine, price, zip, address, tz, description, color], idx) => {
      const z = ZIPS[zip];
      const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const r = {
        id: id(), slug, name, cuisine, price_level: price, description, phone: `(555) 01${String(idx).padStart(2, '0')}-${1000 + idx * 7}`,
        email: `hello@${slug}.example`, address, city: z[2], state: z[3], zip, lat: z[0] + ((idx % 5) - 2) * 0.002, lng: z[1] + ((idx % 3) - 1) * 0.002,
        timezone: tz, image_url: '', max_party_size: 8, booking_window_days: 60, min_notice_minutes: 60, reminder_hours: 24,
        no_show_grace_minutes: 30, auto_no_show: 0, send_no_show_email: 1, cancellation_policy: 'Please cancel at least 2 hours before your reservation.',
        accent_color: color, trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(), subscription_status: idx === 0 ? 'trialing' : 'active',
        stripe_subscription_id: null,
      };
      db.restaurants.push(r);
      starterFloor(db, r, true, id);
      if (idx === 0) db.users.push({ id: id(), restaurant_id: r.id, name: 'Demo Owner', email: 'demo@tablebird.test', password: 'demo1234' });
      const today = nowInZone(tz).date;
      const tbls = db.tables.filter((t) => t.restaurant_id === r.id && t.online_bookable);
      for (let d = 0; d < 4; d++) {
        const date = addDays(today, d); const used = new Set();
        ['17:30', '18:00', '18:30', '19:00', '19:15', '19:30', '20:00', '20:30'].forEach((time, i) => {
          if ((idx * 7 + d * 3 + i * 5) % 10 < 3) return;
          const t = tbls.find((tb) => !used.has(`${tb.id}-${Math.floor(i / 3)}`));
          if (!t) return;
          used.add(`${t.id}-${Math.floor(i / 3)}`);
          const fn = FIRST[(idx + d + i) % FIRST.length]; const ln = LAST[(idx * 3 + i) % LAST.length];
          db.reservations.push({
            id: id(), code: rand(6), manage_token: token(), restaurant_id: r.id, table_id: t.id, shift_id: null, date, time,
            starts_at_utc: zonedToUtc(date, time, tz).toISOString(), duration_minutes: 90, party_size: Math.min(t.max_seats, 2 + ((i + d) % 3)),
            guest_name: `${fn} ${ln}`, guest_email: `${fn}.${ln}@example.com`.toLowerCase(), guest_phone: `(555) 2${String(i).padStart(2, '0')}-${4000 + d * 10 + i}`,
            notes: i === 2 ? 'Window seat if possible' : '', internal_notes: '', occasion: i === 5 ? 'Birthday' : '', source: ['online', 'widget', 'phone'][i % 3],
            status: 'confirmed', created_at: nowSql(), updated_at: nowSql(),
          });
        });
      }
    });
    return db;
  }

  function starterFloor(db, r, full, id) {
    const main = { id: id(), restaurant_id: r.id, name: full ? 'Main room' : 'Main dining room', sort_order: 0 };
    db.areas.push(main);
    const list = full
      ? [[main.id, 'T1', 1, 2, 'square', 40, 40], [main.id, 'T2', 1, 2, 'square', 150, 40], [main.id, 'T3', 2, 4, 'square', 260, 40],
        [main.id, 'T4', 2, 4, 'round', 40, 170], [main.id, 'T5', 2, 4, 'round', 150, 170], [main.id, 'B1', 4, 6, 'booth', 270, 170], [main.id, 'T6', 6, 10, 'rect', 40, 300]]
      : [[main.id, 'T1', 1, 2, 'square', 60, 60], [main.id, 'T2', 1, 2, 'square', 180, 60], [main.id, 'T3', 2, 4, 'square', 300, 60],
        [main.id, 'T4', 2, 4, 'square', 60, 200], [main.id, 'T5', 2, 4, 'round', 180, 200], [main.id, 'T6', 4, 6, 'rect', 300, 200]];
    if (full) {
      const patio = { id: id(), restaurant_id: r.id, name: 'Patio', sort_order: 1 };
      db.areas.push(patio);
      list.push([patio.id, 'P1', 2, 4, 'round', 40, 40], [patio.id, 'P2', 2, 4, 'round', 150, 40], [patio.id, 'Bar', 1, 2, 'bar', 260, 40]);
    }
    for (const [area, label, mn, mx, shape, x, y] of list) {
      db.tables.push({ id: id(), restaurant_id: r.id, area_id: area, label, min_seats: mn, max_seats: mx, shape, x, y, rotation: 0, online_bookable: label === 'Bar' ? 0 : 1, active: 1 });
    }
    if (full) {
      db.shifts.push({ id: id(), restaurant_id: r.id, name: 'Lunch', days: '1,2,3,4,5', start_time: '11:30', end_time: '14:00', slot_interval: 15, turn_minutes: 75, max_covers_per_slot: 12, active: 1 });
      db.shifts.push({ id: id(), restaurant_id: r.id, name: 'Dinner', days: '0,1,2,3,4,5,6', start_time: '17:00', end_time: '21:30', slot_interval: 15, turn_minutes: 90, max_covers_per_slot: 16, active: 1 });
      db.shifts.push({ id: id(), restaurant_id: r.id, name: 'Weekend brunch', days: '0,6', start_time: '10:00', end_time: '13:30', slot_interval: 30, turn_minutes: 75, max_covers_per_slot: 0, active: 1 });
    } else {
      db.shifts.push({ id: id(), restaurant_id: r.id, name: 'Dinner', days: '0,1,2,3,4,5,6', start_time: '17:00', end_time: '21:30', slot_interval: 15, turn_minutes: 90, max_covers_per_slot: 0, active: 1 });
    }
  }

  let db = store.get();
  if (!db || !db.restaurants) { db = seed(); store.set(db); }
  const save = () => store.set(db);
  const nextId = () => db.seq++;

  // ---------- domain logic (mirrors src/availability.js, reservations.js) ----------
  class E extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
  const ACTIVE = ['confirmed', 'seated'];
  function isBookable(r) {
    if (['active', 'past_due'].includes(r.subscription_status)) return true;
    return r.subscription_status === 'trialing' && new Date(r.trial_ends_at) > new Date();
  }
  function billingSummary(r) {
    const left = new Date(r.trial_ends_at) - new Date();
    return {
      status: r.subscription_status === 'trialing' && left <= 0 ? 'expired' : r.subscription_status, bookable: isBookable(r), trialEndsAt: r.trial_ends_at,
      trialDaysLeft: Math.max(0, Math.ceil(left / 86400000)), hasPaymentMethod: !!r.stripe_subscription_id, price: '$20/month', stripeEnabled: false, demoMode: true,
    };
  }
  const tableIsFree = (tid, res, start, dur) => !res.some((r) => r.table_id === tid && toMin(r.time) < start + dur && toMin(r.time) + r.duration_minutes > start);

  function getAvailability(r, date, party, opts = {}) {
    party = Number(party);
    const out = { date, partySize: party, closed: false, slots: [] };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(party >= 1)) return out;
    if (!opts.admin && party > r.max_party_size) return { ...out, tooLarge: true };
    if (db.closures.some((c) => c.restaurant_id === r.id && c.date === date)) return { ...out, closed: true };
    const now = nowInZone(r.timezone);
    if (!opts.admin) {
      if (date < now.date) return out;
      if (date > addDays(now.date, r.booking_window_days)) return { ...out, outsideWindow: true };
    }
    const tables = db.tables.filter((t) => t.restaurant_id === r.id && t.active && t.min_seats <= party && t.max_seats >= party && (opts.admin || t.online_bookable))
      .sort((a, b) => a.max_seats - b.max_seats || a.id - b.id);
    const res = db.reservations.filter((x) => x.restaurant_id === r.id && x.date === date && ACTIVE.includes(x.status) && x.id !== (opts.ignore || 0));
    const wd = String(weekday(date));
    db.shifts.filter((s) => s.restaurant_id === r.id && s.active && s.days.split(',').includes(wd)).sort((a, b) => a.start_time.localeCompare(b.start_time)).forEach((s) => {
      for (let t = toMin(s.start_time); t <= toMin(s.end_time); t += s.slot_interval) {
        const time = hhmm(t);
        let available = !(!opts.admin && date === now.date && t < now.minutes + r.min_notice_minutes);
        if (available && s.max_covers_per_slot > 0 && res.filter((x) => x.time === time).reduce((a, x) => a + x.party_size, 0) + party > s.max_covers_per_slot) available = false;
        let tableId = null;
        if (available) { const tb = tables.find((tb) => tableIsFree(tb.id, res, t, s.turn_minutes)); tableId = tb ? tb.id : null; if (!tableId) available = false; }
        out.slots.push({ time, shiftId: s.id, shiftName: s.name, available, tableId, duration: s.turn_minutes });
      }
    });
    return out;
  }
  const findSlot = (r, date, time, party, opts) => getAvailability(r, date, party, opts).slots.find((s) => s.time === time && s.available) || null;
  const isTableFree = (rid, tid, date, time, dur, ignore = 0) => tableIsFree(Number(tid),
    db.reservations.filter((x) => x.restaurant_id === rid && x.date === date && ACTIVE.includes(x.status) && x.id !== ignore), toMin(time), dur);

  // ---------- emails (recorded in the demo inbox) ----------
  function emailHtml(r, title, body) {
    return `<div style="font-family:Helvetica,Arial,sans-serif;background:#f6f3ee;padding:18px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:${r ? r.accent_color : '#c2410c'};color:#fff;padding:16px 22px;font-weight:bold;font-size:18px">${esc(r ? r.name : 'Tablebird')}</div>
      <div style="padding:22px;color:#1f1b16"><h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${body}</div>
      <div style="padding:12px 22px;background:#faf7f2;font-size:12px;color:#7a6f63">${r ? `${esc(r.address)}, ${esc(r.city)} ${esc(r.state)} · ${esc(r.phone)}<br>` : ''}Reservations powered by Tablebird</div></div></div>`;
  }
  const details = (x) => `<table cellpadding="5" style="background:#faf7f2;border-radius:8px;width:100%;font-size:14px;margin:6px 0 14px">
    <tr><td style="color:#7a6f63;width:110px">Date</td><td><b>${esc(prettyDate(x.date))}</b></td></tr><tr><td style="color:#7a6f63">Time</td><td><b>${prettyTime(x.time)}</b></td></tr>
    <tr><td style="color:#7a6f63">Party</td><td>${x.party_size}</td></tr><tr><td style="color:#7a6f63">Name</td><td>${esc(x.guest_name)}</td></tr>
    <tr><td style="color:#7a6f63">Phone</td><td>${esc(x.guest_phone)}</td></tr><tr><td style="color:#7a6f63">Confirmation</td><td><b>${esc(x.code)}</b></td></tr>
    ${x.notes ? `<tr><td style="color:#7a6f63">Notes</td><td>${esc(x.notes)}</td></tr>` : ''}</table>`;
  const btn = (label, color) => `<span style="display:inline-block;background:${color};color:#fff;padding:10px 16px;border-radius:8px;font-weight:bold">${esc(label)}</span>`;
  const T = {
    confirmation: (r, x) => [`Confirmed: ${r.name}, ${prettyDate(x.date)} at ${prettyTime(x.time)}`, emailHtml(r, 'Your table is booked', `<p>Hi ${esc(x.guest_name.split(' ')[0])}, we look forward to seeing you.</p>${details(x)}<p style="font-size:13px;color:#7a6f63">${esc(r.cancellation_policy)}</p><p>${btn('View or cancel reservation', r.accent_color)}</p><p style="font-size:12px;color:#7a6f63">📎 reservation.ics (calendar invite)</p>`)],
    updated: (r, x) => [`Updated: ${r.name}, ${prettyDate(x.date)} at ${prettyTime(x.time)}`, emailHtml(r, 'Your reservation was updated', details(x) + btn('View reservation', r.accent_color))],
    reminder: (r, x) => [`Reminder: ${r.name} on ${prettyDate(x.date)} at ${prettyTime(x.time)}`, emailHtml(r, 'See you soon!', `<p>A friendly reminder of your upcoming reservation.</p>${details(x)}${btn('Manage or cancel', r.accent_color)}`)],
    cancellation: (r, x) => [`Cancelled: ${r.name}, ${prettyDate(x.date)} at ${prettyTime(x.time)}`, emailHtml(r, 'Your reservation was cancelled', `<p>${x.cancelled_by === 'restaurant' ? `We're sorry, ${esc(r.name)} had to cancel your reservation. Please call ${esc(r.phone)} with any questions.` : 'Your reservation has been cancelled. We hope to see you another time.'}</p>${details(x)}${btn('Book again', r.accent_color)}`)],
    no_show: (r, x) => [`We missed you at ${r.name}`, emailHtml(r, 'We missed you today', `<p>Your reservation was marked as a no-show. If this is a mistake, please call ${esc(r.phone)}.</p>${details(x)}`)],
    staff_new: (r, x) => [`New reservation: ${x.guest_name}, ${x.party_size} ppl, ${prettyDate(x.date)} ${prettyTime(x.time)}`, emailHtml(r, 'New reservation', `${details(x)}<p>Source: ${esc(x.source)}</p>`)],
    staff_cancel: (r, x) => [`Guest cancelled: ${x.guest_name}, ${prettyDate(x.date)} ${prettyTime(x.time)}`, emailHtml(r, 'A guest cancelled', details(x))],
  };
  function sendEmail(kind, r, x) {
    const [subject, html] = T[kind](r, x);
    const to = kind.startsWith('staff_') ? r.email : x.guest_email;
    db.emails.push({ id: nextId(), reservation_id: x ? x.id : null, restaurant_id: r.id, to_addr: to, subject, html, kind, status: 'outbox', created_at: nowSql() });
    if (window.TBDemo) window.TBDemo.bump();
    return 'outbox';
  }

  function cleanGuest(d) {
    const g = { guest_name: String(d.name || '').trim(), guest_email: String(d.email || '').trim().toLowerCase(), guest_phone: String(d.phone || '').trim() };
    if (!g.guest_name) throw new E('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.guest_email)) throw new E('Please enter a valid email address.');
    if (g.guest_phone.replace(/\D/g, '').length < 7) throw new E('Please enter a valid phone number.');
    return { ...g, notes: String(d.notes || '').slice(0, 500), occasion: String(d.occasion || '').slice(0, 60) };
  }
  function createReservation(r, d, opts = {}) {
    const g = cleanGuest(d);
    const date = String(d.date || ''); const time = String(d.time || ''); const party = Number(d.party_size);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new E('Invalid date or time.');
    if (!(party >= 1 && party <= 50)) throw new E('Invalid party size.');
    const source = opts.source || 'online';
    let slot;
    if (opts.admin && d.table_id) {
      const t = db.tables.find((x) => x.id === Number(d.table_id) && x.restaurant_id === r.id);
      if (!t) throw new E('Table not found.');
      const dur = Number(d.duration_minutes) || 90;
      if (!d.force && !isTableFree(r.id, t.id, date, time, dur)) throw new E(`Table ${t.label} is already booked around that time.`, 409);
      slot = { tableId: t.id, shiftId: null, duration: dur };
    } else {
      slot = findSlot(r, date, time, party, { admin: !!opts.admin });
      if (!slot && opts.admin) {
        const dur = Number(d.duration_minutes) || 90;
        const t = db.tables.filter((x) => x.restaurant_id === r.id && x.active && x.min_seats <= party && x.max_seats >= party).sort((a, b) => a.max_seats - b.max_seats)
          .find((x) => isTableFree(r.id, x.id, date, time, dur));
        if (t) slot = { tableId: t.id, shiftId: null, duration: dur };
      }
      if (!slot) throw new E('Sorry, that time was just taken. Please pick another time.', 409);
    }
    const x = {
      id: nextId(), code: rand(6), manage_token: token(), restaurant_id: r.id, table_id: slot.tableId, shift_id: slot.shiftId, date, time,
      starts_at_utc: zonedToUtc(date, time, r.timezone).toISOString(), duration_minutes: slot.duration, party_size: party, ...g,
      internal_notes: String(d.internal_notes || ''), source, status: source === 'walk_in' ? 'seated' : 'confirmed', created_at: nowSql(), updated_at: nowSql(),
    };
    db.reservations.push(x);
    if (source !== 'walk_in' && d.send_email !== false) sendEmail('confirmation', r, x);
    if (!opts.admin) sendEmail('staff_new', r, x);
    return x;
  }

  const PUBLIC = ['slug', 'name', 'cuisine', 'price_level', 'description', 'phone', 'address', 'city', 'state', 'zip', 'lat', 'lng', 'timezone', 'image_url', 'max_party_size', 'booking_window_days', 'cancellation_policy', 'accent_color'];
  const pub = (r) => Object.fromEntries(PUBLIC.map((k) => [k, r[k]]));
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  function bookable(slug) {
    const r = db.restaurants.find((x) => x.slug === slug);
    if (!r) throw new E('Restaurant not found.', 404);
    if (!isBookable(r)) throw new E('This restaurant is not taking online reservations right now.', 403);
    return r;
  }
  function miles(a, b) {
    const R = 3958.8; const rad = (d) => (d * Math.PI) / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const byToken = (t) => {
    const x = db.reservations.find((y) => y.manage_token === t);
    if (!x) throw new E('Reservation not found.', 404);
    return { x, r: db.restaurants.find((y) => y.id === x.restaurant_id) };
  };
  const guestView = (x, r) => ({
    code: x.code, status: x.status, date: x.date, time: x.time, party_size: x.party_size, guest_name: x.guest_name, guest_email: x.guest_email,
    guest_phone: x.guest_phone, notes: x.notes, occasion: x.occasion, restaurant: pub(r), canChange: x.status === 'confirmed' && new Date(x.starts_at_utc) > new Date(),
  });
  function me() {
    const u = db.session && db.users.find((x) => x.id === db.session);
    if (!u) throw new E('Please log in.', 401);
    return { u, r: db.restaurants.find((x) => x.id === u.restaurant_id) };
  }
  const owned = (list, id, rid) => { const o = db[list].find((x) => x.id === Number(id) && x.restaurant_id === rid); if (!o) throw new E('Not found.', 404); return o; };
  function history(rid, email) {
    const rows = db.reservations.filter((x) => x.restaurant_id === rid && x.guest_email === email);
    return { visits: rows.filter((x) => ['completed', 'seated'].includes(x.status)).length, no_shows: rows.filter((x) => x.status === 'no_show').length };
  }
  function slugify(n) {
    const b = n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'restaurant';
    let s = b; let i = 2; while (db.restaurants.some((r) => r.slug === s)) s = `${b}-${i++}`; return s;
  }

  // ---------- routes ----------
  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

  on('GET', '/api/public/search', (q) => {
    const zip = String(q.zip || '').trim(); const party = Math.max(1, Math.min(20, Number(q.party) || 2));
    const want = /^\d{2}:\d{2}$/.test(q.time || '') ? q.time : '19:00';
    if (!/^\d{5}$/.test(zip)) throw new E('Please enter a 5-digit ZIP code.');
    const z = ZIPS[zip]; const origin = z ? { lat: z[0], lng: z[1], city: z[2], state: z[3] } : null;
    let list = db.restaurants.filter(isBookable).map((r) => ({ r, mi: origin ? miles(origin, r) : (r.zip.slice(0, 3) === zip.slice(0, 3) ? 0 : Infinity) }))
      .filter((x) => x.mi <= 25).sort((a, b) => a.mi - b.mi);
    if (q.q) list = list.filter(({ r }) => `${r.name} ${r.cuisine}`.toLowerCase().includes(String(q.q).toLowerCase()));
    return {
      origin: origin ? { city: origin.city, state: origin.state } : null, party, time: want,
      results: list.map(({ r, mi }) => {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : nowInZone(r.timezone).date;
        const av = getAvailability(r, date, party); const tgt = toMin(want);
        const slots = av.slots.filter((s) => s.available).sort((a, b) => Math.abs(toMin(a.time) - tgt) - Math.abs(toMin(b.time) - tgt)).slice(0, 5).map((s) => s.time).sort();
        return { ...pub(r), miles: Math.round(mi * 10) / 10, date, slots, closed: av.closed };
      }),
    };
  });
  on('GET', '/api/public/restaurants/:slug', (q, b, p) => {
    const r = bookable(p.slug);
    return { restaurant: pub(r), shifts: db.shifts.filter((s) => s.restaurant_id === r.id && s.active), today: nowInZone(r.timezone).date };
  });
  on('GET', '/api/public/restaurants/:slug/availability', (q, b, p) => {
    const r = bookable(p.slug); const av = getAvailability(r, q.date || nowInZone(r.timezone).date, Number(q.party) || 2);
    av.slots = av.slots.map(({ time, shiftName, available }) => ({ time, shiftName, available })); return av;
  });
  on('POST', '/api/public/restaurants/:slug/reservations', (q, b, p) => {
    const r = bookable(p.slug);
    if (b.website) throw new E('Invalid submission.');
    const x = createReservation(r, b, { source: b.source === 'widget' ? 'widget' : 'online' });
    return { code: x.code, token: x.manage_token, date: x.date, time: x.time, party_size: x.party_size };
  });
  on('GET', '/api/public/reservations/:t', (q, b, p) => { const { x, r } = byToken(p.t); return guestView(x, r); });
  on('POST', '/api/public/reservations/:t/cancel', (q, b, p) => {
    const { x, r } = byToken(p.t);
    if (x.status !== 'confirmed') throw new E(`This reservation is already ${x.status.replace('_', '-')}.`);
    Object.assign(x, { status: 'cancelled', cancelled_by: 'guest', cancelled_at: nowSql() });
    sendEmail('cancellation', r, x); sendEmail('staff_cancel', r, x); return guestView(x, r);
  });
  on('POST', '/api/public/reservations/:t/modify', (q, b, p) => {
    const { x, r } = byToken(p.t);
    if (x.status !== 'confirmed') throw new E('This reservation can no longer be changed online.');
    const date = b.date || x.date; const time = b.time || x.time; const party = Number(b.party_size || x.party_size);
    const s = findSlot(r, date, time, party, { ignore: x.id });
    if (!s) throw new E('That time is not available. Please pick another.', 409);
    Object.assign(x, { date, time, party_size: party, table_id: s.tableId, duration_minutes: s.duration, starts_at_utc: zonedToUtc(date, time, r.timezone).toISOString(), updated_at: nowSql() });
    sendEmail('updated', r, x); return guestView(x, r);
  });
  on('GET', '/api/public/reservations/:t/availability', (q, b, p) => {
    const { x, r } = byToken(p.t); const av = getAvailability(r, q.date || x.date, Number(q.party) || x.party_size, { ignore: x.id });
    av.slots = av.slots.map(({ time, shiftName, available }) => ({ time, shiftName, available })); return av;
  });

  on('POST', '/api/auth/signup', (q, b) => {
    const need = { restaurant_name: 'Restaurant name', owner_name: 'Your name', email: 'Email', password: 'Password', phone: 'Phone', address: 'Street address', city: 'City', state: 'State', zip: 'ZIP code' };
    for (const [k, l] of Object.entries(need)) if (!String(b[k] || '').trim()) throw new E(`${l} is required.`);
    const em = String(b.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new E('Enter a valid email.');
    if (String(b.password).length < 8) throw new E('Password must be at least 8 characters.');
    if (!/^\d{5}$/.test(String(b.zip).trim())) throw new E('Enter a 5-digit ZIP code.');
    if (db.users.some((u) => u.email === em)) throw new E('An account with that email already exists. Please log in.');
    const z = ZIPS[b.zip];
    const near = z ? null : db.restaurants.find((r) => r.zip.slice(0, 3) === String(b.zip).slice(0, 3));
    const r = {
      id: nextId(), slug: slugify(b.restaurant_name), name: String(b.restaurant_name).trim(), cuisine: b.cuisine || '', price_level: 2, description: '',
      phone: b.phone, email: em, address: b.address, city: b.city, state: String(b.state).toUpperCase().slice(0, 2), zip: b.zip,
      lat: z ? z[0] : near ? near.lat : null, lng: z ? z[1] : near ? near.lng : null, timezone: b.timezone || 'America/New_York', image_url: '',
      max_party_size: 8, booking_window_days: 60, min_notice_minutes: 60, reminder_hours: 24, no_show_grace_minutes: 30, auto_no_show: 0, send_no_show_email: 1,
      cancellation_policy: 'Please cancel at least 2 hours before your reservation.', accent_color: '#c2410c',
      trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(), subscription_status: 'trialing', stripe_subscription_id: null,
    };
    db.restaurants.push(r);
    starterFloor(db, r, false, nextId);
    const u = { id: nextId(), restaurant_id: r.id, name: b.owner_name, email: em, password: b.password };
    db.users.push(u); db.session = u.id;
    db.emails.push({ id: nextId(), restaurant_id: r.id, to_addr: em, kind: 'welcome', status: 'outbox', created_at: nowSql(), subject: `Welcome to Tablebird, ${r.name}!`,
      html: emailHtml(null, 'Your 30-day free trial has started', `<p>Hi ${esc(u.name)}, thanks for joining Tablebird.</p><p>Your free trial runs until <b>${new Date(r.trial_ends_at).toDateString()}</b>. After that it's just <b>$20/month</b>, cancel anytime.</p>`) });
    return { ok: true, slug: r.slug };
  });
  on('POST', '/api/auth/login', (q, b) => {
    const u = db.users.find((x) => x.email === String(b.email || '').trim().toLowerCase() && x.password === b.password);
    if (!u) throw new E('Wrong email or password.', 401);
    db.session = u.id; return { ok: true };
  });
  on('POST', '/api/auth/logout', () => { db.session = null; return { ok: true }; });
  on('GET', '/api/auth/me', () => { const u = db.users.find((x) => x.id === db.session); return { user: u ? { name: u.name, email: u.email } : null, demo: true }; });

  const SETTINGS = ['name', 'cuisine', 'price_level', 'description', 'phone', 'email', 'address', 'city', 'state', 'zip', 'timezone', 'image_url', 'max_party_size', 'booking_window_days', 'min_notice_minutes', 'reminder_hours', 'no_show_grace_minutes', 'auto_no_show', 'send_no_show_email', 'cancellation_policy', 'accent_color'];
  on('GET', '/api/admin/restaurant', () => {
    const { u, r } = me();
    const base = location.href.replace(/[^/]*$/, '').replace(/\/$/, '');
    return { restaurant: pick(r, ['id', 'slug', ...SETTINGS]), user: { name: u.name, email: u.email }, billing: billingSummary(r), baseUrl: 'https://YOUR-DOMAIN.com', demoBase: base };
  });
  on('PUT', '/api/admin/restaurant', (q, b) => {
    const { r } = me(); const f = pick(b, SETTINGS);
    ['price_level', 'max_party_size', 'booking_window_days', 'min_notice_minutes', 'reminder_hours', 'no_show_grace_minutes'].forEach((k) => { if (f[k] !== undefined) f[k] = Math.max(0, Number(f[k]) || 0); });
    ['auto_no_show', 'send_no_show_email'].forEach((k) => { if (f[k] !== undefined) f[k] = f[k] ? 1 : 0; });
    Object.assign(r, f); return { ok: true };
  });
  on('GET', '/api/admin/reservations', (q) => {
    const { r } = me(); const from = q.from || q.date || nowInZone(r.timezone).date; const to = q.to || from; const s = String(q.q || '').toLowerCase();
    const rows = db.reservations.filter((x) => x.restaurant_id === r.id && x.date >= from && x.date <= to && (!s || `${x.guest_name} ${x.guest_email} ${x.guest_phone} ${x.code}`.toLowerCase().includes(s)))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .map((x) => ({ ...x, table_label: (db.tables.find((t) => t.id === x.table_id) || {}).label, history: history(r.id, x.guest_email) }));
    return { from, to, reservations: rows };
  });
  on('GET', '/api/admin/stats', (q) => {
    const { r } = me(); const date = q.date || nowInZone(r.timezone).date;
    const rows = db.reservations.filter((x) => x.restaurant_id === r.id && x.date === date); const c = (s) => rows.filter((x) => x.status === s).length;
    const t = db.tables.filter((x) => x.restaurant_id === r.id && x.active);
    return { date, bookings: rows.length, covers: rows.filter((x) => ['confirmed', 'seated', 'completed'].includes(x.status)).reduce((a, x) => a + x.party_size, 0),
      upcoming: c('confirmed'), seated: c('seated'), completed: c('completed'), cancelled: c('cancelled'), no_shows: c('no_show'), tables: t.length, seats: t.reduce((a, x) => a + x.max_seats, 0) };
  });
  on('GET', '/api/admin/availability', (q) => { const { r } = me(); return getAvailability(r, q.date || nowInZone(r.timezone).date, Number(q.party) || 2, { admin: true, ignore: Number(q.ignore) || 0 }); });
  on('POST', '/api/admin/reservations', (q, b) => {
    const { r } = me(); const source = ['phone', 'walk_in', 'admin'].includes(b.source) ? b.source : 'phone'; const d = { ...b };
    if (source === 'walk_in') {
      const n = nowInZone(r.timezone); d.date = d.date || n.date; d.time = d.time || hhmm(Math.floor(n.minutes / 5) * 5);
      d.email = d.email || 'walkin@guest.local'; d.phone = d.phone || '0000000'; d.name = d.name || 'Walk-in';
    }
    d.send_email = b.send_email !== false && source !== 'walk_in';
    return createReservation(r, d, { source, admin: true });
  });
  on('PATCH', '/api/admin/reservations/:id', (q, b, p) => {
    const { r } = me(); const x = owned('reservations', p.id, r.id);
    const f = pick(b, ['guest_name', 'guest_email', 'guest_phone', 'notes', 'internal_notes', 'occasion', 'party_size', 'table_id', 'date', 'time', 'duration_minutes', 'status']);
    if (f.status && !['confirmed', 'seated', 'completed'].includes(f.status)) throw new E('Use the cancel / no-show actions for that status.');
    const next = { ...x, ...f };
    const moved = ['table_id', 'date', 'time', 'duration_minutes'].some((k) => f[k] !== undefined && String(f[k]) !== String(x[k]));
    if (moved && next.table_id && !b.force && !isTableFree(r.id, next.table_id, next.date, next.time, Number(next.duration_minutes), x.id)) throw new E('That table is already booked around that time.', 409);
    if (f.date || f.time) f.starts_at_utc = zonedToUtc(next.date, next.time, r.timezone).toISOString();
    const changed = (f.date && f.date !== x.date) || (f.time && f.time !== x.time) || (f.party_size && Number(f.party_size) !== x.party_size);
    Object.assign(x, f, { updated_at: nowSql() });
    if (changed && b.notify !== false && x.status === 'confirmed') sendEmail('updated', r, x);
    return x;
  });
  on('POST', '/api/admin/reservations/:id/cancel', (q, b, p) => {
    const { r } = me(); const x = owned('reservations', p.id, r.id);
    Object.assign(x, { status: 'cancelled', cancelled_by: 'restaurant', cancelled_at: nowSql() }); if (b.notify !== false) sendEmail('cancellation', r, x); return x;
  });
  on('POST', '/api/admin/reservations/:id/no-show', (q, b, p) => {
    const { r } = me(); const x = owned('reservations', p.id, r.id); x.status = 'no_show'; if (b.notify !== false && r.send_no_show_email) sendEmail('no_show', r, x); return x;
  });
  on('POST', '/api/admin/reservations/:id/resend', (q, b, p) => { const { r } = me(); const x = owned('reservations', p.id, r.id); return { status: sendEmail(x.status === 'cancelled' ? 'cancellation' : 'confirmation', r, x) }; });

  on('GET', '/api/admin/floor', () => { const { r } = me(); return { areas: db.areas.filter((a) => a.restaurant_id === r.id).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id), tables: db.tables.filter((t) => t.restaurant_id === r.id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })) }; });
  on('POST', '/api/admin/areas', (q, b) => { const { r } = me(); if (!b.name) throw new E('Area name required.'); const a = { id: nextId(), restaurant_id: r.id, name: b.name, sort_order: Number(b.sort_order) || 0 }; db.areas.push(a); return a; });
  on('PUT', '/api/admin/areas/:id', (q, b, p) => { const { r } = me(); const a = owned('areas', p.id, r.id); Object.assign(a, pick(b, ['name', 'sort_order'])); return a; });
  on('DELETE', '/api/admin/areas/:id', (q, b, p) => { const { r } = me(); owned('areas', p.id, r.id); db.areas = db.areas.filter((a) => a.id !== Number(p.id)); db.tables.forEach((t) => { if (t.area_id === Number(p.id)) t.area_id = null; }); return { ok: true }; });
  const cleanTable = (b) => {
    const f = pick(b, ['area_id', 'label', 'min_seats', 'max_seats', 'shape', 'x', 'y', 'rotation', 'online_bookable', 'active']);
    ['min_seats', 'max_seats', 'x', 'y', 'rotation'].forEach((k) => { if (f[k] !== undefined) f[k] = Math.round(Number(f[k]) || 0); });
    ['online_bookable', 'active'].forEach((k) => { if (f[k] !== undefined) f[k] = f[k] ? 1 : 0; });
    if (f.area_id === '' || f.area_id === 0) f.area_id = null; if (f.min_seats !== undefined && f.min_seats < 1) f.min_seats = 1; return f;
  };
  on('POST', '/api/admin/tables', (q, b) => {
    const { r } = me(); const t = { id: nextId(), restaurant_id: r.id, min_seats: 1, max_seats: 4, shape: 'square', x: 40, y: 40, rotation: 0, online_bookable: 1, active: 1, area_id: null, ...cleanTable(b) };
    if (!t.label) throw new E('Table label required.'); if (t.max_seats < t.min_seats) throw new E('Max seats must be at least min seats.'); db.tables.push(t); return t;
  });
  on('PUT', '/api/admin/tables/:id', (q, b, p) => {
    const { r } = me(); const t = owned('tables', p.id, r.id); const f = cleanTable(b);
    if ((f.max_seats ?? t.max_seats) < (f.min_seats ?? t.min_seats)) throw new E('Max seats must be at least min seats.'); Object.assign(t, f); return t;
  });
  on('PUT', '/api/admin/floor/layout', (q, b) => { const { r } = me(); (b.tables || []).forEach((x) => { const t = db.tables.find((y) => y.id === x.id && y.restaurant_id === r.id); if (t) Object.assign(t, pick(cleanTable(x), ['x', 'y', 'rotation'])); }); return { ok: true }; });
  on('DELETE', '/api/admin/tables/:id', (q, b, p) => { const { r } = me(); owned('tables', p.id, r.id); db.tables = db.tables.filter((t) => t.id !== Number(p.id)); db.reservations.forEach((x) => { if (x.table_id === Number(p.id)) x.table_id = null; }); return { ok: true }; });
  const cleanShift = (b) => {
    const f = pick(b, ['name', 'days', 'start_time', 'end_time', 'slot_interval', 'turn_minutes', 'max_covers_per_slot', 'active']);
    if (Array.isArray(f.days)) f.days = f.days.join(',');
    ['slot_interval', 'turn_minutes', 'max_covers_per_slot'].forEach((k) => { if (f[k] !== undefined) f[k] = Math.max(0, Number(f[k]) || 0); });
    if (f.active !== undefined) f.active = f.active ? 1 : 0; return f;
  };
  on('GET', '/api/admin/shifts', () => { const { r } = me(); return { shifts: db.shifts.filter((s) => s.restaurant_id === r.id).sort((a, b) => a.start_time.localeCompare(b.start_time)), closures: db.closures.filter((c) => c.restaurant_id === r.id).sort((a, b) => a.date.localeCompare(b.date)) }; });
  on('POST', '/api/admin/shifts', (q, b) => { const { r } = me(); const s = { id: nextId(), restaurant_id: r.id, slot_interval: 15, turn_minutes: 90, max_covers_per_slot: 0, days: '0,1,2,3,4,5,6', active: 1, ...cleanShift(b) }; if (!s.name || !s.start_time || !s.end_time) throw new E('Name, first and last seating are required.'); db.shifts.push(s); return s; });
  on('PUT', '/api/admin/shifts/:id', (q, b, p) => { const { r } = me(); const s = owned('shifts', p.id, r.id); Object.assign(s, cleanShift(b)); return s; });
  on('DELETE', '/api/admin/shifts/:id', (q, b, p) => { const { r } = me(); owned('shifts', p.id, r.id); db.shifts = db.shifts.filter((s) => s.id !== Number(p.id)); return { ok: true }; });
  on('POST', '/api/admin/closures', (q, b) => { const { r } = me(); if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw new E('Pick a date.'); const c = { id: nextId(), restaurant_id: r.id, date: b.date, reason: b.reason || '' }; db.closures.push(c); return c; });
  on('DELETE', '/api/admin/closures/:id', (q, b, p) => { const { r } = me(); owned('closures', p.id, r.id); db.closures = db.closures.filter((c) => c.id !== Number(p.id)); return { ok: true }; });
  on('GET', '/api/admin/guests', (q) => {
    const { r } = me(); const s = String(q.q || '').toLowerCase(); const m = new Map();
    db.reservations.filter((x) => x.restaurant_id === r.id && x.guest_email !== 'walkin@guest.local').forEach((x) => {
      const g = m.get(x.guest_email) || { email: x.guest_email, name: x.guest_name, phone: x.guest_phone, reservations: 0, visits: 0, no_shows: 0, cancellations: 0, last_date: x.date };
      g.reservations++; if (['completed', 'seated'].includes(x.status)) g.visits++; if (x.status === 'no_show') g.no_shows++; if (x.status === 'cancelled') g.cancellations++;
      if (x.date > g.last_date) g.last_date = x.date; m.set(x.guest_email, g);
    });
    return [...m.values()].filter((g) => !s || `${g.name} ${g.email} ${g.phone}`.toLowerCase().includes(s)).sort((a, b) => b.last_date.localeCompare(a.last_date));
  });
  on('GET', '/api/admin/emails', () => { const { r } = me(); return db.emails.filter((e) => e.restaurant_id === r.id).slice().reverse().map(({ html, ...e }) => e); });
  on('GET', '/api/admin/billing', () => billingSummary(me().r));
  on('POST', '/api/admin/billing/checkout', () => { throw new E('Payments are switched off in the demo. Use the demo buttons below.'); });
  on('POST', '/api/admin/billing/portal', () => { throw new E('Payments are switched off in the demo.'); });
  on('POST', '/api/admin/billing/simulate', (q, b) => {
    const { r } = me();
    if (b.status === 'expired') Object.assign(r, { subscription_status: 'trialing', trial_ends_at: new Date(Date.now() - 1000).toISOString() });
    else r.subscription_status = 'active';
    return billingSummary(r);
  });

  function handle(method, url, body) {
    const u = new URL(url, location.href);
    const path = u.pathname.slice(u.pathname.indexOf('/api/'));
    const q = Object.fromEntries(u.searchParams);
    for (const rt of routes) {
      const m = rt.method === method && path.match(rt.re);
      if (m) {
        try {
          const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
          const out = rt.fn(q, body || {}, params); save();
          return { status: method === 'POST' && /reservations$|tables$|areas$|shifts$|closures$|signup$/.test(path) ? 201 : 200, data: out };
        } catch (e) {
          if (!(e instanceof E)) console.error(e);
          return { status: e.status || 500, data: { error: e instanceof E ? e.message : 'Something went wrong.' } };
        }
      }
    }
    return { status: 404, data: { error: 'Not found' } };
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    if (!/\/api\//.test(url)) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
    db = store.get() || db; // pick up changes made in other tabs/frames
    const res = handle(method, url, body);
    await new Promise((r) => setTimeout(r, 120));
    return new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  };

  // ---------- demo inbox (shows every email the system "sent") ----------
  function inboxUI() {
    if (window.self !== window.top && /embed\.html/.test(location.pathname)) return; // keep the widget clean
    const style = document.createElement('style');
    style.textContent = `.demo-bar{position:relative;z-index:30;background:#1f1b16;color:#f5e6d8;font:500 13px Inter,system-ui,sans-serif;padding:7px max(16px,env(safe-area-inset-right,0px)) 7px max(16px,env(safe-area-inset-left,0px));display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .demo-bar b{color:#fff}.demo-bar button{background:#c2410c;color:#fff;border:0;border-radius:7px;padding:5px 10px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
      .demo-bar button.alt{background:transparent;border:1px solid #6b5f52}.demo-bar .sp{flex:1}
      body.admin .sidebar{height:calc(100vh - 41px)}@media (max-width:900px){body.admin .sidebar{height:auto}}
      .inbox-list{max-height:60vh;overflow:auto;border:1px solid #e6ded2;border-radius:10px}.inbox-item{padding:10px 12px;border-bottom:1px solid #e6ded2;cursor:pointer;font-size:14px}
      .inbox-item:hover{background:#faf7f2}.inbox-item small{color:#6f655a;display:block}.inbox-view{border:1px solid #e6ded2;border-radius:10px;overflow:hidden}`;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.innerHTML = `<span><b>Live demo.</b> Everything works, but bookings stay in your browser and emails go to the demo inbox instead of being sent.</span><span class="sp"></span>
      <button type="button" id="demo-inbox">Demo inbox (<span id="demo-count">0</span>)</button><button type="button" class="alt" id="demo-reset">Reset demo</button>`;
    document.body.prepend(bar);
    const count = () => { const n = (store.get() || db).emails.length; const el = document.getElementById('demo-count'); if (el) el.textContent = n; };
    window.TBDemo = { bump: () => setTimeout(count, 0) };
    count(); window.addEventListener('storage', count);
    document.getElementById('demo-inbox').onclick = () => {
      const emails = (store.get() || db).emails.slice().reverse();
      TB.modal(`<h2>Demo inbox</h2><p class="muted small">Every email Tablebird would have sent to guests and restaurants. On the real site these go out through your email provider.</p>
        <div id="ib">${emails.length ? `<div class="inbox-list">${emails.map((e) => `<div class="inbox-item" data-id="${e.id}"><b>${esc(e.subject)}</b><small>To ${esc(e.to_addr)} · ${esc(e.kind.replace('_', ' '))}</small></div>`).join('')}</div>` : '<p>No emails yet. Book a table to see the confirmation.</p>'}</div>
        <div class="row" style="margin-top:12px"><button class="btn secondary" data-close>Close</button></div>`, (m) => {
        m.parentElement.style.alignItems = 'start'; m.style.maxWidth = '640px';
        m.querySelectorAll('.inbox-item').forEach((it) => {
          it.onclick = () => {
            const e = emails.find((x) => x.id === Number(it.dataset.id));
            m.querySelector('#ib').innerHTML = `<button class="btn ghost sm" id="ib-back">← All emails</button><p class="small muted">To: ${esc(e.to_addr)}<br>Subject: <b>${esc(e.subject)}</b></p><div class="inbox-view">${e.html}</div>`;
            m.querySelector('#ib-back').onclick = () => { document.querySelector('.modal-back').remove(); document.getElementById('demo-inbox').click(); };
          };
        });
      });
    };
    document.getElementById('demo-reset').onclick = () => {
      TB.modal(`<h2>Reset the demo?</h2><p>This puts back the sample restaurants and bookings and removes anything you added in this browser.</p>
        <div class="row"><button class="btn danger" id="rs-yes">Reset demo</button><button class="btn secondary" data-close>Cancel</button></div>`, (m) => {
        m.querySelector('#rs-yes').onclick = () => { db = seed(); save(); location.href = 'index.html'; };
      });
    };
  }
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-email]');
    if (!a) return;
    ev.preventDefault();
    const e = (store.get() || db).emails.find((x) => x.id === Number(a.dataset.email));
    if (e) TB.modal(`<p class="small muted">To: ${esc(e.to_addr)}<br>Subject: <b>${esc(e.subject)}</b></p><div class="inbox-view">${e.html}</div><div class="row" style="margin-top:12px"><button class="btn secondary" data-close>Close</button></div>`);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inboxUI); else inboxUI();
})();
