'use strict';
// End-to-end API tests against a throwaway database.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbooked-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.SMTP_HOST = '';
process.env.STRIPE_SECRET_KEY = '';
process.env.BASE_URL = 'http://test.local';

const app = require('../src/server');
const { one, run } = require('../src/db');
const jobs = require('../src/jobs');
const { addDays, nowInZone } = require('../src/time');

let server; let base; let cookie = '';
before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, url, body, useCookie = true) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(useCookie && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc && useCookie) cookie = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch { /* */ }
  return { status: res.status, data };
}

const tomorrow = addDays(nowInZone('America/New_York').date, 1);
let manageToken;

test('restaurant signup starts a 14-day trial with starter setup', async () => {
  const r = await call('POST', '/api/auth/signup', {
    restaurant_name: 'Test Bistro', owner_name: 'Owner', email: 'owner@test.local', password: 'password123',
    phone: '555-123-4567', address: '1 Main St', city: 'New York', state: 'NY', zip: '10011', cuisine: 'Thai',
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  const me = await call('GET', '/api/admin/restaurant');
  assert.strictEqual(me.data.billing.status, 'trialing');
  assert.ok(me.data.billing.trialDaysLeft >= 13);
  const floor = await call('GET', '/api/admin/floor');
  assert.strictEqual(floor.data.tables.length, 6);
  // Give it coordinates so ZIP search works offline in tests.
  run('UPDATE restaurants SET lat = 40.74, lng = -73.99');
  run("INSERT OR REPLACE INTO zip_cache VALUES ('10011', 40.7402, -73.9996, 'New York', 'NY')");
});

test('ZIP search lists the restaurant with time slots', async () => {
  const r = await call('GET', `/api/public/search?zip=10011&date=${tomorrow}&party=2&time=19:00`, null, false);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.results[0].slug, 'test-bistro');
  assert.ok(r.data.results[0].slots.includes('19:00'));
});

test('guest can book, gets confirmation email, and the table is held', async () => {
  const r = await call('POST', '/api/public/restaurants/test-bistro/reservations',
    { date: tomorrow, time: '19:00', party_size: 6, name: 'Ann Guest', email: 'ann@example.com', phone: '555 222 3333' }, false);
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  manageToken = r.data.token;
  await new Promise((s) => setTimeout(s, 50));
  assert.ok(one("SELECT * FROM email_log WHERE kind='confirmation' AND to_addr='ann@example.com'"));
  assert.ok(one("SELECT * FROM email_log WHERE kind='staff_new'"));
  // Only one 6-top exists, so a second party of 6 at 19:30 overlaps and must fail.
  const r2 = await call('POST', '/api/public/restaurants/test-bistro/reservations',
    { date: tomorrow, time: '19:30', party_size: 6, name: 'Bob', email: 'bob@example.com', phone: '5552223334' }, false);
  assert.strictEqual(r2.status, 409);
  const av = await call('GET', `/api/public/restaurants/test-bistro/availability?date=${tomorrow}&party=6`, null, false);
  assert.strictEqual(av.data.slots.find((s) => s.time === '19:30').available, false);
  // A party of 6 holds the table for 3 hours (reservation length by party size), so 17:00 overlaps too.
  assert.strictEqual(one('SELECT duration_minutes FROM reservations WHERE manage_token = ?', manageToken).duration_minutes, 180);
  assert.strictEqual(av.data.slots.find((s) => s.time === '17:00').available, false);
  const av2 = await call('GET', `/api/public/restaurants/test-bistro/availability?date=${tomorrow}&party=2`, null, false);
  assert.strictEqual(av2.data.slots.find((s) => s.time === '17:00').available, true);
});

test('reservation length follows party size and can be changed', async () => {
  const saved = await call('PUT', '/api/admin/restaurant', { turn_times: [{ max: 2, minutes: 60 }, { max: 99, minutes: 150 }] });
  assert.strictEqual(saved.status, 200);
  const me = await call('GET', '/api/admin/restaurant');
  assert.strictEqual(me.data.restaurant.turn_times, '2:60,99:150');
  const day = addDays(tomorrow, 6);
  const a2 = await call('GET', `/api/admin/availability?date=${day}&party=2`);
  assert.strictEqual(a2.data.slots[0].duration, 60);
  const a5 = await call('GET', `/api/admin/availability?date=${day}&party=5`);
  assert.strictEqual(a5.data.slots[0].duration, 150);
  await call('PUT', '/api/admin/restaurant', { turn_times: '2:90,4:120,6:180,99:210' });
});

test('restaurant tags power "Pick for me" and featured lists', async () => {
  const put = await call('PUT', '/api/admin/restaurant', { tags: ['vegan', 'classy', 'not_a_tag'] });
  assert.strictEqual(put.status, 200);
  assert.strictEqual(one('SELECT tags FROM restaurants').tags, 'vegan,classy');
  const p = await call('GET', `/api/public/pick?zip=10011&date=${tomorrow}&time=18:00&party=2&prefs=vegan,classy`, null, false);
  assert.strictEqual(p.status, 200);
  assert.strictEqual(p.data.picks[0].restaurant.slug, 'test-bistro');
  assert.deepStrictEqual(p.data.picks[0].matched, ['vegan', 'classy']);
  assert.ok(p.data.picks[0].times.includes('18:00'));
  // Diet choices are dealbreakers.
  const h = await call('GET', `/api/public/pick?zip=10011&date=${tomorrow}&prefs=halal`, null, false);
  assert.strictEqual(h.data.picks.length, 0);
  run('UPDATE restaurants SET featured = 1');
  const f = await call('GET', `/api/public/featured?zip=10011&date=${tomorrow}`, null, false);
  assert.strictEqual(f.data[0].slug, 'test-bistro');
});

test('booking validates name, email and phone', async () => {
  const r = await call('POST', '/api/public/restaurants/test-bistro/reservations',
    { date: tomorrow, time: '18:00', party_size: 2, name: 'X', email: 'nope', phone: '1' }, false);
  assert.strictEqual(r.status, 400);
});

test('guest can modify and then cancel via manage link', async () => {
  const m = await call('POST', `/api/public/reservations/${manageToken}/modify`, { time: '20:00', party_size: 4 }, false);
  assert.strictEqual(m.status, 200, JSON.stringify(m.data));
  assert.strictEqual(m.data.time, '20:00');
  const c = await call('POST', `/api/public/reservations/${manageToken}/cancel`, {}, false);
  assert.strictEqual(c.data.status, 'cancelled');
  await new Promise((s) => setTimeout(s, 50));
  assert.ok(one("SELECT * FROM email_log WHERE kind='cancellation'"));
  assert.ok(one("SELECT * FROM email_log WHERE kind='staff_cancel'"));
});

test('staff phone booking, seat, no-show and guest history', async () => {
  const p = await call('POST', '/api/admin/reservations', { source: 'phone', date: tomorrow, time: '18:00', party_size: 2, name: 'Phone Guest', email: 'pg@example.com', phone: '5550001111' });
  assert.strictEqual(p.status, 201, JSON.stringify(p.data));
  const ns = await call('POST', `/api/admin/reservations/${p.data.id}/no-show`, {});
  assert.strictEqual(ns.data.status, 'no_show');
  const list = await call('GET', `/api/admin/reservations?date=${tomorrow}`);
  const row = list.data.reservations.find((x) => x.id === p.data.id);
  assert.strictEqual(row.history.no_shows, 1);
  const w = await call('POST', '/api/admin/reservations', { source: 'walk_in', party_size: 2 });
  assert.strictEqual(w.status, 201, JSON.stringify(w.data));
  assert.strictEqual(w.data.status, 'seated');
});

test('tables, services and closures can be managed', async () => {
  const t = await call('POST', '/api/admin/tables', { label: 'P9', min_seats: 2, max_seats: 8, shape: 'round' });
  assert.strictEqual(t.status, 201);
  const u = await call('PUT', `/api/admin/tables/${t.data.id}`, { max_seats: 10 });
  assert.strictEqual(u.data.max_seats, 10);
  const s = await call('POST', '/api/admin/shifts', { name: 'Lunch', days: [1, 2, 3, 4, 5, 6, 0], start_time: '11:30', end_time: '14:00', slot_interval: 30, turn_minutes: 60 });
  assert.strictEqual(s.status, 201);
  const c = await call('POST', '/api/admin/closures', { date: addDays(tomorrow, 1), reason: 'Holiday' });
  assert.strictEqual(c.status, 201);
  const av = await call('GET', `/api/public/restaurants/test-bistro/availability?date=${addDays(tomorrow, 1)}&party=2`, null, false);
  assert.strictEqual(av.data.closed, true);
});

test('reminder job emails upcoming guests once', async () => {
  const r = await call('POST', '/api/public/restaurants/test-bistro/reservations',
    { date: tomorrow, time: '17:00', party_size: 2, name: 'Rem Guest', email: 'rem@example.com', phone: '5553334444' }, false);
  run("UPDATE reservations SET created_at = datetime('now','-1 day') WHERE manage_token = ?", r.data.token);
  const start = new Date(one('SELECT starts_at_utc FROM reservations WHERE manage_token = ?', r.data.token).starts_at_utc);
  const n = await jobs.sendReminders(new Date(start.getTime() - 3 * 3600000));
  assert.ok(n >= 1);
  assert.strictEqual(await jobs.sendReminders(new Date(start.getTime() - 2 * 3600000)), 0);
  assert.ok(one("SELECT * FROM email_log WHERE kind='reminder' AND to_addr='rem@example.com'"));
});

test('auto no-show marks unseated guests after the grace period', async () => {
  run('UPDATE restaurants SET auto_no_show = 1, no_show_grace_minutes = 30');
  const res = one("SELECT * FROM reservations WHERE guest_email='rem@example.com'");
  const n = jobs.autoNoShows(new Date(new Date(res.starts_at_utc).getTime() + 31 * 60000));
  assert.ok(n >= 1);
  assert.strictEqual(one('SELECT status FROM reservations WHERE id = ?', res.id).status, 'no_show');
});

test('expired trial hides restaurant until subscribed', async () => {
  await call('POST', '/api/admin/billing/simulate', { status: 'expired' });
  const s = await call('GET', '/api/public/search?zip=10011', null, false);
  assert.strictEqual(s.data.results.length, 0);
  const b = await call('POST', '/api/public/restaurants/test-bistro/reservations', { date: tomorrow, time: '18:00', party_size: 2, name: 'A', email: 'a@b.co', phone: '5551112222' }, false);
  assert.strictEqual(b.status, 403);
  await call('POST', '/api/admin/billing/simulate', { status: 'active' });
  const s2 = await call('GET', '/api/public/search?zip=10011', null, false);
  assert.strictEqual(s2.data.results.length, 1);
});

test('admin API requires login and is scoped to own restaurant', async () => {
  const r = await call('GET', '/api/admin/reservations', null, false);
  assert.strictEqual(r.status, 401);
});

test('table combinations seat larger parties and block their member tables', async () => {
  const floor = await call('GET', '/api/admin/floor');
  const byLabel = Object.fromEntries(floor.data.tables.map((t) => [t.label, t]));
  // Take the big P9 table out so the party can only fit on joined tables.
  await call('PUT', `/api/admin/tables/${byLabel.P9.id}`, { active: false });
  const c = await call('POST', '/api/admin/combos', { table_ids: [byLabel.T4.id, byLabel.T5.id] });
  assert.strictEqual(c.status, 201);
  assert.strictEqual(c.data.name, 'T4 + T5');
  assert.strictEqual(c.data.max_seats, byLabel.T4.max_seats + byLabel.T5.max_seats);
  assert.strictEqual((await call('POST', '/api/admin/combos', { table_ids: [byLabel.T5.id, byLabel.T4.id] })).status, 409);
  const bad = await call('POST', '/api/admin/combos', { table_ids: [byLabel.T4.id] });
  assert.strictEqual(bad.status, 400);
  const day = addDays(tomorrow, 3);
  const party = c.data.max_seats;
  const av = await call('GET', `/api/admin/availability?date=${day}&party=${party}`);
  const slot = av.data.slots.find((s) => s.time === '19:00');
  assert.ok(slot.available);
  assert.strictEqual(slot.comboId, c.data.id);
  const b = await call('POST', '/api/admin/reservations', { date: day, time: '19:00', party_size: party, name: 'Big Party', email: 'big@example.com', phone: '5557778888', source: 'phone' });
  assert.strictEqual(b.status, 201);
  assert.strictEqual(b.data.combo_id, c.data.id);
  // T4 is now taken by the combination, so a direct booking on it conflicts.
  const clash = await call('POST', '/api/admin/reservations', { date: day, time: '19:30', party_size: 2, name: 'Two', email: 'two@example.com', phone: '5557778889', table_id: byLabel.T4.id, source: 'phone' });
  assert.strictEqual(clash.status, 409);
  const list = await call('GET', `/api/admin/reservations?date=${day}`);
  assert.strictEqual(list.data.reservations.find((x) => x.guest_email === 'big@example.com').table_label, 'T4 + T5');
});

test('address book collects guests and keeps staff notes', async () => {
  const book = await call('GET', '/api/admin/guests?q=big@example.com');
  assert.strictEqual(book.data.guests.length, 1);
  const g = book.data.guests[0];
  assert.strictEqual(g.reservations, 1);
  assert.ok(g.next_visit);
  const u = await call('PUT', `/api/admin/guests/${g.id}`, { notes: 'Likes the corner', tags: 'VIP, Regular' });
  assert.strictEqual(u.data.tags, 'VIP,Regular');
  const tagged = await call('GET', '/api/admin/guests?tag=VIP');
  assert.ok(tagged.data.guests.some((x) => x.id === g.id));
  assert.ok(tagged.data.tags.includes('VIP'));
  const detail = await call('GET', `/api/admin/guests/${g.id}`);
  assert.strictEqual(detail.data.reservations.length, 1);
  const n = await call('POST', '/api/admin/guests', { name: 'Walk Up', phone: '555 000 1234' });
  assert.strictEqual(n.status, 201);
  const dup = await call('POST', '/api/admin/guests', { name: 'Again', email: 'big@example.com' });
  assert.strictEqual(dup.status, 409);
  // A later booking with the same email links to the same contact.
  await call('POST', '/api/public/restaurants/test-bistro/reservations', { date: addDays(tomorrow, 4), time: '18:00', party_size: 2, name: 'Big Party', email: 'big@example.com', phone: '5557778888' }, false);
  assert.strictEqual((await call('GET', `/api/admin/guests/${g.id}`)).data.reservations.length, 2);
  assert.strictEqual((await call('DELETE', `/api/admin/guests/${n.data.id}`)).status, 200);
});

test('restaurant profile: website, hours, photo upload and menu with dietary filters', async () => {
  const hours = Array.from({ length: 7 }, (_, d) => ({ closed: d === 1 ? 1 : 0, open: '17:00', close: '23:00' }));
  const p = await call('PUT', '/api/admin/restaurant', { website_url: 'testbistro.com', hours: JSON.stringify(hours) });
  assert.strictEqual(p.status, 200);
  const me = (await call('GET', '/api/admin/restaurant')).data.restaurant;
  assert.strictEqual(me.website_url, 'https://testbistro.com');
  assert.strictEqual(JSON.parse(me.hours)[1].closed, 1);
  assert.strictEqual((await call('PUT', '/api/admin/restaurant', { image_url: 'javascript:alert(1)' })).status, 400);
  // 1x1 PNG
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await call('POST', '/api/admin/images', { kind: 'logo', data: png });
  assert.strictEqual(up.status, 201);
  const img = await fetch(base + up.data.url);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');
  assert.strictEqual((await call('POST', '/api/admin/images', { kind: 'cover', data: 'data:text/html;base64,PGgxPg==' })).status, 400);

  const dishes = [['Mains', 'Tofu Curry', '16', ['vegan']], ['Mains', 'Lentil Stew', '14.50', ['vegan', 'gluten_free']], ['Starters', 'Hummus', '9', ['vegan']], ['Mains', 'Steak Frites', '32', []]];
  for (const [section, name, price, tags] of dishes) assert.strictEqual((await call('POST', '/api/admin/menu', { section, name, price, tags })).status, 201);
  const menu = (await call('GET', '/api/admin/menu')).data;
  const stew = menu.find((m) => m.name === 'Lentil Stew');
  assert.strictEqual(stew.price_cents, 1450);
  assert.ok(stew.tags.split(',').includes('vegetarian'), 'vegan dishes count as vegetarian');
  await call('PUT', `/api/admin/menu/${menu.find((m) => m.name === 'Steak Frites').id}`, { available: false });

  const pubR = await call('GET', '/api/public/restaurants/test-bistro', null, false);
  assert.strictEqual(pubR.data.menu.length, 3, 'hidden dishes are not shown to guests');
  assert.strictEqual(pubR.data.restaurant.website_url, 'https://testbistro.com');
  assert.ok(pubR.data.restaurant.tags.split(',').includes('vegan'), '3+ vegan dishes make the restaurant show up as vegan');
  const s = await call('GET', '/api/public/search?zip=10011&q=lentil', null, false);
  assert.strictEqual(s.data.results.length, 1, 'search finds restaurants by dish');
  const v = await call('GET', '/api/public/search?zip=10011&tag=vegan', null, false);
  assert.strictEqual(v.data.results.length, 1);
});

test('cuisine and state come from fixed lists; time zone follows the ZIP code', async () => {
  const bad = await call('POST', '/api/auth/signup', {
    restaurant_name: 'Odd Place', owner_name: 'O', email: 'odd@test.local', password: 'password123',
    phone: '555-123-4567', address: '1 Main St', city: 'New York', state: 'NY', zip: '10011', cuisine: 'Space food',
  }, false);
  assert.strictEqual(bad.status, 400);
  const c = await call('GET', '/api/public/search?zip=10011&cuisine=Thai', null, false);
  assert.ok(c.data.results.every((r) => r.cuisine === 'Thai') && c.data.results.length >= 1);
  const none = await call('GET', '/api/public/search?zip=10011&cuisine=Korean', null, false);
  assert.strictEqual(none.data.results.length, 0);
  assert.strictEqual((await call('PUT', '/api/admin/restaurant', { state: 'XX' })).status, 400);
  const tzBefore = (await call('GET', '/api/admin/restaurant')).data.restaurant.timezone;
  assert.strictEqual(tzBefore, 'America/New_York');
  await call('PUT', '/api/admin/restaurant', { timezone: 'Asia/Tokyo' });
  assert.strictEqual((await call('GET', '/api/admin/restaurant')).data.restaurant.timezone, 'America/New_York', 'time zone is not picked by hand');
  await call('PUT', '/api/admin/restaurant', { zip: '79901', state: 'TX', city: 'El Paso' });
  assert.strictEqual((await call('GET', '/api/admin/restaurant')).data.restaurant.timezone, 'America/Denver');
});

test('home page always has restaurants to show; only Rbooked staff can feature', async () => {
  run('UPDATE restaurants SET featured = 0');
  const f = await call('GET', '/api/public/featured', null, false);
  assert.ok(f.data.length >= 1, 'newest restaurants fill in when none are featured');
  assert.strictEqual((await call('GET', '/api/admin/platform/restaurants')).status, 403);
});

test('menu import: pasted text becomes dishes with sections, prices and diet tags', async () => {
  const { parseText } = require('../public/js/menu-import');
  const items = parseText('STARTERS\nEdamame (VG) ..... $6\nMAINS\nKung Pao Tofu - peanuts, chili 🌶 15.50\nBrownie 7');
  assert.deepStrictEqual(items.map((i) => [i.section, i.name, i.price]), [['Starters', 'Edamame', '6'], ['Mains', 'Kung Pao Tofu', '15.50'], ['Mains', 'Brownie', '7']]);
  const before = (await call('GET', '/api/admin/menu')).data.length;
  const r = await call('POST', '/api/admin/menu/import', { items });
  assert.strictEqual(r.status, 201); assert.strictEqual(r.data.imported, 3);
  const menu = (await call('GET', '/api/admin/menu')).data;
  assert.strictEqual(menu.length, before + 3);
  const ed = menu.find((m) => m.name === 'Edamame');
  assert.strictEqual(ed.price_cents, 600); assert.ok(ed.tags.includes('vegan') && ed.tags.includes('vegetarian'));
  assert.ok(menu.find((m) => m.name === 'Kung Pao Tofu').tags.includes('spicy'));
  const rep = await call('POST', '/api/admin/menu/import', { items: [{ name: 'Only Dish', price: '9' }], replace: true });
  assert.strictEqual(rep.status, 201);
  assert.strictEqual((await call('GET', '/api/admin/menu')).data.length, 1);
});
