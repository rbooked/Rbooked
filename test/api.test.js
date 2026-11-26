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
process.env.RATE_LIMIT_PER_MIN = '1000'; // the whole suite runs from one address

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
  // Not live until the owner confirms their email.
  assert.strictEqual(me.data.restaurant.verified, 0);
  assert.strictEqual((await fetch(`${base}/r/${me.data.restaurant.slug}`)).status, 404);
  const mail = one("SELECT html FROM email_log WHERE kind = 'welcome' AND to_addr = 'owner@test.local' ORDER BY id DESC");
  const link = mail.html.match(/\/api\/auth\/verify\?t=([\w%-]+)/);
  assert.ok(link, 'welcome email has a confirm link');
  assert.strictEqual((await fetch(`${base}/api/auth/verify?t=bad`, { redirect: 'manual' })).headers.get('location'), '/login?verify=expired');
  const v = await fetch(`${base}/api/auth/verify?t=${link[1]}`, { redirect: 'manual' });
  assert.strictEqual(v.headers.get('location'), '/admin/?verified=1');
  assert.strictEqual((await call('GET', '/api/admin/restaurant')).data.restaurant.verified, 1);
  assert.strictEqual((await fetch(`${base}/r/${me.data.restaurant.slug}`)).status, 200);
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
  // Staff bring it back: it stays (shown as Late) and isn't marked no-show again.
  const back = await call('PATCH', `/api/admin/reservations/${res.id}`, { status: 'confirmed' });
  assert.strictEqual(back.status, 200, JSON.stringify(back.data));
  assert.strictEqual(back.data.keep_late, 1);
  jobs.autoNoShows(new Date(new Date(res.starts_at_utc).getTime() + 90 * 60000));
  assert.strictEqual(one('SELECT status FROM reservations WHERE id = ?', res.id).status, 'confirmed');
  assert.ok((await call('PATCH', `/api/admin/reservations/${res.id}`, { status: 'seated' })).data.status === 'seated');
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

test('a second restaurant can only ever touch its own data', async () => {
  // Restaurant A (the main test login) has these:
  const aRes = (await call('POST', '/api/admin/reservations', { date: addDays(tomorrow, 9), time: '18:00', party_size: 2, name: 'Private Guest', email: 'private@example.com', phone: '5550001111', source: 'phone' })).data;
  const aFloor = (await call('GET', '/api/admin/floor')).data;
  const aTable = aFloor.tables[0]; const aArea = aFloor.areas[0];
  const aDish = (await call('POST', '/api/admin/menu', { name: 'Secret Soup', price: '9', section: 'Soups' })).data;
  const aGuest = (await call('GET', '/api/admin/guests')).data.guests?.[0] || (await call('GET', '/api/admin/guests')).data[0];
  const aShift = (await call('GET', '/api/admin/shifts')).data.shifts[0];
  // Restaurant B signs up with its own cookie.
  let b = '';
  const asB = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(b ? { Cookie: b } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc && !b) b = sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch { /* html */ }
    return { status: r.status, data };
  };
  const su = await asB('POST', '/api/auth/signup', { restaurant_name: 'Other Place', owner_name: 'B', email: 'b-owner@test.local', password: 'password123', phone: '555-999-0000', address: '2 Side St', city: 'New York', state: 'NY', zip: '10011', cuisine: 'Pizza' });
  assert.strictEqual(su.status, 201, JSON.stringify(su.data));
  // B sees none of A's things in its lists...
  const list = await asB('GET', `/api/admin/reservations?date=${addDays(tomorrow, 9)}`);
  assert.ok(!JSON.stringify(list.data).includes('Private Guest'));
  assert.ok(!JSON.stringify((await asB('GET', '/api/admin/menu')).data).includes('Secret Soup'));
  // ...and can't read, change or delete them by id.
  const tries = [
    ['PATCH', `/api/admin/reservations/${aRes.id}`, { guest_name: 'Hacked' }], ['POST', `/api/admin/reservations/${aRes.id}/cancel`, {}],
    ['POST', `/api/admin/reservations/${aRes.id}/no-show`, {}], ['POST', `/api/admin/reservations/${aRes.id}/resend`, {}],
    ['PUT', `/api/admin/tables/${aTable.id}`, { label: 'X' }], ['DELETE', `/api/admin/tables/${aTable.id}`],
    ['PUT', `/api/admin/areas/${aArea.id}`, { name: 'X' }], ['DELETE', `/api/admin/areas/${aArea.id}`],
    ['PUT', `/api/admin/menu/${aDish.id}`, { name: 'X' }], ['DELETE', `/api/admin/menu/${aDish.id}`],
    ['PUT', `/api/admin/shifts/${aShift.id}`, { name: 'X' }], ['DELETE', `/api/admin/shifts/${aShift.id}`],
    ...(aGuest ? [['GET', `/api/admin/guests/${aGuest.id}`], ['PUT', `/api/admin/guests/${aGuest.id}`, { name: 'X' }], ['DELETE', `/api/admin/guests/${aGuest.id}`]] : []),
  ];
  for (const [m, u, body] of tries) {
    const r = await asB(m, u, body);
    assert.ok([400, 404].includes(r.status), `${m} ${u} gave ${r.status}`);
  }
  // A booking from B can't be put on A's table, and B can't combine A's tables.
  const bb = await asB('POST', '/api/admin/reservations', { date: addDays(tomorrow, 9), time: '18:00', party_size: 2, name: 'B guest', email: 'bg@example.com', phone: '5550002222', source: 'phone', table_id: aTable.id });
  assert.ok([400, 404].includes(bb.status), `table from other restaurant gave ${bb.status}`);
  assert.strictEqual((await asB('POST', '/api/admin/combos', { table_ids: [aFloor.tables[0].id, aFloor.tables[1].id] })).status, 400);
  // Nothing of A's changed.
  assert.strictEqual(one('SELECT guest_name FROM reservations WHERE id = ?', aRes.id).guest_name, 'Private Guest');
  assert.ok(one('SELECT id FROM menu_items WHERE id = ?', aDish.id));
  // No platform or support powers for restaurant logins.
  assert.strictEqual((await asB('GET', '/api/admin/platform/restaurants')).status, 404);
  assert.strictEqual((await asB('PUT', `/api/admin/platform/restaurants/${aRes.restaurant_id}`, { featured: true })).status, 404);
  assert.notStrictEqual((await asB('GET', '/api/staff/restaurants')).status, 200);
  const me = await asB('GET', '/api/admin/restaurant');
  assert.ok(!('password_hash' in me.data.user) && !('platformAdmin' in me.data.user));
  await call('DELETE', `/api/admin/menu/${aDish.id}`); await call('POST', `/api/admin/reservations/${aRes.id}/cancel`, { notify: false });
});

test('forgot password: emailed one-time link sets a new password', async () => {
  const quiet = await call('POST', '/api/auth/forgot', { email: 'no-such-owner@test.local' }, false);
  assert.strictEqual(quiet.status, 200); // same answer whether or not the email has a login
  assert.strictEqual((await call('POST', '/api/auth/forgot', { email: 'owner@test.local' }, false)).status, 200);
  const mail = one("SELECT html FROM email_log WHERE kind = 'password_reset' AND to_addr = 'owner@test.local' ORDER BY id DESC");
  const t = decodeURIComponent(mail.html.match(/reset-password\?t=([\w%-]+)/)[1]);
  assert.strictEqual((await call('POST', '/api/auth/reset', { token: t, password: 'short' }, false)).status, 400);
  const ok = await fetch(`${base}/api/auth/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t, password: 'newpassword456' }) });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await call('POST', '/api/auth/reset', { token: t, password: 'another12345' }, false)).status, 400, 'links work once');
  assert.strictEqual((await call('POST', '/api/auth/login', { email: 'owner@test.local', password: 'password123' }, false)).status, 401);
  assert.strictEqual((await call('POST', '/api/auth/login', { email: 'owner@test.local', password: 'newpassword456' })).status, 200);
  // Old sessions were logged out; log back in with the new password above, then put the old one back for later tests.
  run('UPDATE users SET password_hash = ? WHERE email = ?', require('../src/auth').hashPassword('password123'), 'owner@test.local');
});

test('daily backup is emailed once a day and errors email support', async () => {
  const ops = require('../src/ops');
  const data = ops.buildBackup();
  assert.ok(data.tables.restaurants.length >= 1 && data.tables.reservations.length >= 1);
  assert.ok(!('sessions' in data.tables) && !('auth_tokens' in data.tables));
  assert.ok(!data.tables.users.some((u) => 'password' in u));
  const at = new Date('2026-12-01T12:00:00Z'); // 7 AM in New York
  assert.ok(await ops.dailyBackup(at));
  assert.strictEqual(await ops.dailyBackup(new Date(at.getTime() + 2 * 3600000)), false, 'only once a day');
  assert.ok(one("SELECT id FROM email_log WHERE kind = 'backup' AND to_addr = 'rbookedsupport@gmail.com'"));
  assert.strictEqual(await ops.alertError('test', new Error('Boom test')), true);
  assert.strictEqual(await ops.alertError('test', new Error('Boom test')), false, 'same problem only once an hour');
  assert.ok(one("SELECT id FROM email_log WHERE kind = 'alert' AND subject LIKE '%Boom test%'"));
});

test('referrals: both restaurants get a free month once the new one confirms its email', async () => {
  const me = (await call('GET', '/api/admin/restaurant')).data.restaurant;
  run('UPDATE restaurants SET free_months = 0 WHERE id = ?', me.id);
  const before = one('SELECT trial_ends_at, subscription_status FROM restaurants WHERE id = ?', me.id);
  const info = await (await fetch(`${base}/api/auth/referrer/${me.slug}`)).json();
  assert.strictEqual(info.name, me.name);
  const r = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    restaurant_name: 'Friend Diner', owner_name: 'F', email: 'friend@test.local', password: 'password123', phone: '555-222-3333',
    address: '3 Elm St', city: 'New York', state: 'NY', zip: '10011', cuisine: 'American', ref: me.slug }) });
  assert.strictEqual(r.status, 201);
  const friend = one("SELECT * FROM restaurants WHERE name = 'Friend Diner'");
  assert.strictEqual(friend.referred_by, me.id);
  const days = (new Date(friend.trial_ends_at) - Date.now()) / 86400000;
  assert.ok(days > 43 && days < 45, `new restaurant gets 14 + 30 days (got ${days})`);
  let list = (await call('GET', '/api/admin/referrals')).data;
  assert.strictEqual(list.referred[0].status, 'waiting'); assert.strictEqual(list.free_months, 0);
  const mail = one("SELECT html FROM email_log WHERE kind = 'welcome' AND to_addr = 'friend@test.local'");
  await fetch(`${base}/api/auth/verify?t=${mail.html.match(/verify\?t=([\w%-]+)/)[1]}`, { redirect: 'manual' });
  list = (await call('GET', '/api/admin/referrals')).data;
  assert.strictEqual(list.referred[0].status, 'earned'); assert.strictEqual(list.free_months, 1);
  assert.ok(list.link.includes(`ref=${me.slug}`));
  if (before.subscription_status === 'trialing') {
    const after = one('SELECT trial_ends_at FROM restaurants WHERE id = ?', me.id).trial_ends_at;
    assert.ok(new Date(after) - Math.max(Date.now(), new Date(before.trial_ends_at)) > 29 * 86400000, 'a month was added');
  }
  assert.ok(one("SELECT id FROM email_log WHERE kind = 'referral'"));
  // Confirming again (or a reset link) never pays twice.
  await call('POST', '/api/auth/forgot', { email: 'friend@test.local' }, false);
  assert.strictEqual((await call('GET', '/api/admin/referrals')).data.free_months, 1);
  assert.strictEqual((await fetch(`${base}/api/auth/referrer/no-such-place`)).status, 404);
});

test('login: too many wrong passwords makes you wait', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await call('POST', '/api/auth/login', { email: 'nobody-here@test.local', password: 'wrong' }, false);
  assert.strictEqual(last.status, 429);
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
  assert.strictEqual((await call('GET', '/api/admin/platform/restaurants')).status, 404);
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

test('dish options and smart AI menu reading (with a fallback when AI is off)', async () => {
  const M = require('../public/js/menu-import');
  assert.deepStrictEqual(M.parseOptionsText('Size: Small $9 | Large $14.50\nAdd-ons: Extra cheese +2; Bacon (+3)'), [
    { name: 'Size', choices: [{ name: 'Small', price: '9' }, { name: 'Large', price: '14.50' }] },
    { name: 'Add-ons', choices: [{ name: 'Extra cheese', price: '+2' }, { name: 'Bacon', price: '+3' }] }]);
  assert.strictEqual(M.optionsText(M.parseOptionsText('Size: Small $9 | Large $14.50')), 'Size: Small $9 | Large $14.50');

  // No AI binding: the endpoint says so and the browser uses the built-in reader.
  delete globalThis.__rbAI;
  assert.deepStrictEqual((await call('POST', '/api/admin/menu/read', { text: 'MAINS\nSaleeg 24.95\nMandi 22' })).data, { smart: false, items: [] });

  let seen = 0;
  globalThis.__rbAI = { run: async (model, input) => { seen++; assert.ok(input.messages[1].content.includes('S a l e e g')); return { response: { items: [
    { section: 'mains', name: 'Saleeg', price: '$24.95', description: 'creamy rice, chicken', tags: ['halal', 'bogus'], options: [{ name: 'Size', choices: [{ name: 'Half', price: '24.95' }, { name: 'Whole', price: '$39' }] }, { name: 'Add-ons', choices: [{ name: 'Extra lamb', price: '+8' }] }] },
    { section: 'Mains', name: 'Saleeg', price: '24.95' },
    { section: 'Drinks', name: 'Vegan Mango Lassi', price: '5' }] } }; } };
  try {
    const r = await call('POST', '/api/admin/menu/read', { text: 'MAINS\nS a l e e g $ 2 4 . 9 5\nVegan Mango Lassi 5' });
    assert.strictEqual(r.data.smart, true); assert.strictEqual(seen, 1);
    assert.strictEqual(r.data.items.length, 2, 'duplicates dropped');
    const [sal, lassi] = r.data.items;
    assert.strictEqual(sal.price, '24.95'); assert.deepStrictEqual(sal.tags, ['halal']);
    assert.deepStrictEqual(sal.options[0].choices.map((c) => c.price), ['24.95', '39']);
    assert.ok(lassi.tags.includes('vegetarian') && lassi.tags.includes('dairy_free'));
    // A failing model means null, so the browser falls back.
    globalThis.__rbAI = { run: async () => { throw new Error('quota'); } };
    assert.strictEqual((await call('POST', '/api/admin/menu/read', { text: 'MAINS\nSaleeg 24.95\nMandi 22' })).data.smart, false);

    await call('POST', '/api/admin/menu/import', { items: [{ ...sal, options: M.optionsText(sal.options) }], replace: true });
    const saved = (await call('GET', '/api/admin/menu')).data[0];
    assert.deepStrictEqual(JSON.parse(saved.options)[1], { name: 'Add-ons', choices: [{ name: 'Extra lamb', price: '+8' }] });
    const slug = (await call('GET', '/api/admin/restaurant')).data.restaurant.slug;
    const pub = (await call('GET', `/api/public/restaurants/${slug}`)).data.menu[0];
    assert.strictEqual(JSON.parse(pub.options)[0].choices[1].name, 'Whole');
  } finally { delete globalThis.__rbAI; }
  assert.ok(require('../src/ai-menu').chunks('a\n'.repeat(9000), 5000).length >= 3);
});

test('staff key can reset a restaurant and keep its logins', async () => {
  const req = (method, path, key) => fetch(`${base}${path}`, { method, headers: key ? { Authorization: `Bearer ${key}` } : {} });
  delete process.env.STAFF_API_KEY;
  assert.strictEqual((await req('GET', '/api/staff/restaurants', 'x')).status, 404, 'off without a key');
  process.env.STAFF_API_KEY = 'k'.repeat(40);
  try {
    assert.strictEqual((await req('GET', '/api/staff/restaurants', 'wrong')).status, 401);
    const list = await (await req('GET', '/api/staff/restaurants', 'k'.repeat(40))).json();
    const myId = (await call('GET', '/api/admin/restaurant')).data.restaurant.id;
    const mine = list.find((r) => r.id === myId);
    assert.ok(mine && mine.logins);
    const out = await (await req('POST', `/api/staff/restaurants/${mine.id}/reset`, 'k'.repeat(40))).json();
    assert.ok(out.ok && out.logins_kept >= 1);
    const me = await call('GET', '/api/admin/restaurant');
    assert.strictEqual(me.status, 200); assert.strictEqual(me.data.restaurant.name, 'My restaurant');
    assert.strictEqual((await call('POST', '/api/admin/account/reset', { password: 'password123' })).status, 404, 'owners cannot start over themselves');
    const put = (body) => fetch(`${base}/api/staff/users/email`, { method: 'PUT', headers: { Authorization: `Bearer ${'k'.repeat(40)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.strictEqual((await put({ from: 'nobody@x.com', to: 'a@b.com' })).status, 404);
    assert.strictEqual((await put({ from: 'owner@test.local', to: 'Management@QueenMamasKitchen.com' })).status, 200);
    assert.strictEqual((await call('GET', '/api/admin/restaurant')).data.user.email, 'management@queenmamaskitchen.com');
    assert.strictEqual((await put({ from: 'management@queenmamaskitchen.com', to: 'owner@test.local' })).status, 200);
  } finally { delete process.env.STAFF_API_KEY; }
});

test('special hours replace the usual services on one date only', async () => {
  const slug = (await call('GET', '/api/admin/restaurant')).data.restaurant.slug;
  const day = addDays(nowInZone('America/New_York').date, 5); const next = addDays(day, 7);
  const times = async (d) => (await call('GET', `/api/public/restaurants/${slug}/availability?date=${d}&party=2`)).data.slots.map((x) => x.time);
  const before = await times(day);
  assert.ok(before.length > 2);
  assert.strictEqual((await call('POST', '/api/admin/closures', { date: day, open_time: '18:00', close_time: '17:00' })).status, 400);
  const sp = await call('POST', '/api/admin/closures', { date: day, reason: 'Holiday', open_time: '17:00', close_time: '18:00' });
  assert.strictEqual(sp.status, 201, JSON.stringify(sp.data));
  const after = await times(day);
  assert.ok(after.length && after[0] === '17:00' && after[after.length - 1] === '18:00', after.join(','));
  assert.deepStrictEqual(await times(next), before, 'other days keep the usual hours');
  const pub = await call('GET', `/api/public/restaurants/${slug}`);
  assert.ok(pub.data.special.some((x) => x.date === day && x.open_time === '17:00'));
  await call('POST', '/api/admin/closures', { date: day, closed: true });
  const av = (await call('GET', `/api/public/restaurants/${slug}/availability?date=${day}&party=2`)).data;
  assert.ok(av.closed && !av.slots.length);
  await call('DELETE', `/api/admin/closures/${(await call('GET', '/api/admin/shifts')).data.closures.find((c) => c.date === day).id}`);
});

test('services can follow opening hours, and closed days point to the next open day', async () => {
  const slug = (await call('GET', '/api/admin/restaurant')).data.restaurant.slug;
  const H = (o, c) => ({ closed: false, open: o, close: c });
  const hours = [H('10:00', '15:00'), { closed: true, open: '17:00', close: '22:00' }, { closed: true, open: '17:00', close: '22:00' }, H('17:00', '22:00'), H('17:00', '22:00'), H('17:00', '23:00'), H('17:00', '23:00')];
  await call('PUT', '/api/admin/restaurant', { hours: JSON.stringify(hours) });
  const before = (await call('GET', '/api/admin/shifts')).data.shifts;
  const r = await call('POST', '/api/admin/shifts/from-hours', {});
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const sh = r.data.shifts.map((x) => [x.days, x.start_time, x.end_time]).sort();
  assert.deepStrictEqual(sh, [['0', '10:00', '14:00'], ['3,4', '17:00', '21:00'], ['5,6', '17:00', '22:00']]);
  // Find the next Monday (closed): availability is empty and points to Wednesday.
  let d = addDays(nowInZone('America/New_York').date, 2); while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  const av = (await call('GET', `/api/public/restaurants/${slug}/availability?date=${d}&party=2`)).data;
  assert.strictEqual(av.slots.length, 0); assert.strictEqual(av.nextOpen, addDays(d, 2));
  // put the original services back for later tests
  await call('POST', '/api/admin/shifts/from-hours', {}).catch(() => {});
  for (const x of (await call('GET', '/api/admin/shifts')).data.shifts) await call('DELETE', `/api/admin/shifts/${x.id}`);
  for (const x of before) await call('POST', '/api/admin/shifts', { name: x.name, days: x.days.split(','), start_time: x.start_time, end_time: x.end_time, slot_interval: x.slot_interval, turn_minutes: x.turn_minutes, active: x.active });
  await call('PUT', '/api/admin/restaurant', { hours: '' });
});

test('search engines: restaurant pages, sitemap and robots', async () => {
  const slug = (await call('GET', '/api/admin/restaurant')).data.restaurant.slug;
  const page = await fetch(`${base}/r/${slug}`); const html = await page.text();
  assert.strictEqual(page.status, 200);
  assert.ok(/<title>[^<]+· Book a table in /.test(html), 'title has the restaurant');
  assert.ok(html.includes('<link rel="canonical"') && html.includes('"@type":"Restaurant"'));
  assert.strictEqual((html.match(/name="description"/g) || []).length, 1);
  assert.strictEqual((await fetch(`${base}/r/no-such-place`)).status, 404);
  const sm = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.ok(sm.includes(`/r/${slug}</loc>`) && sm.includes('<urlset'));
  assert.ok((await (await fetch(`${base}/robots.txt`)).text()).includes('Sitemap:'));
  const { hashtag } = require('../public/js/matcher');
  assert.strictEqual(hashtag("Queen Mama's Kitchen"), '#QueenMamasKitchen');
  const name = (await call('GET', '/api/admin/restaurant')).data.restaurant.name;
  const go = await fetch(`${base}/tag/${hashtag(name).slice(1).toLowerCase()}`, { redirect: 'manual' });
  assert.strictEqual(go.status, 302); assert.strictEqual(go.headers.get('location'), `/r/${slug}`);
  assert.ok(html.includes(hashtag(name)), 'hashtag in the page description');
});

test('map: pins sit on the street address, looked up once', async () => {
  const realFetch = globalThis.fetch; let lookups = 0;
  globalThis.fetch = (url, o) => {
    if (String(url).includes('geocoding.geo.census.gov')) {
      lookups++;
      return Promise.resolve(new Response(JSON.stringify({ result: { addressMatches: [{ coordinates: { x: -73.9851, y: 40.7589 } }] } }), { status: 200 }));
    }
    return realFetch(url, o);
  };
  try {
    await call('PUT', '/api/admin/restaurant', { address: '1 Map Street' });
    const me = (await call('GET', '/api/admin/restaurant')).data.restaurant;
    const data = await (await fetch(`${base}/api/public/map`)).json();
    const pin = data.pins.find((p) => p.slug === me.slug);
    assert.ok(pin, 'restaurant has a pin');
    assert.strictEqual(pin.lat, 40.7589); assert.strictEqual(pin.lng, -73.9851);
    assert.ok(pin.tag.startsWith('#'));
    const n = lookups;
    await fetch(`${base}/api/public/map`); await fetch(`${base}/api/public/restaurants/${me.slug}`);
    assert.strictEqual(lookups, n, 'same address is not looked up again');
  } finally { globalThis.fetch = realFetch; }
});

test('gallery and likes: diners heart restaurants, dishes and food photos', async () => {
  await call('PUT', '/api/admin/restaurant', { name: 'Heart Cafe', cuisine: 'Cafe', description: 'Cozy cafe with pastries.' });
  const dish = (await call('POST', '/api/admin/menu', { name: 'Croissant', price: '4', section: 'Bakery' })).data;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await call('POST', '/api/admin/images', { kind: 'gallery', data: png, caption: 'Fresh out of the oven', menu_item_id: dish.id });
  assert.strictEqual(up.status, 201, JSON.stringify(up.data));
  const me = (await call('GET', '/api/admin/restaurant')).data.restaurant;
  // A diner (no login, own cookie jar) likes things.
  let fan = '';
  const diner = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(fan ? { Cookie: fan } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) fan = sc.split(';')[0];
    return { status: r.status, data: await r.json() };
  };
  const page = await diner('GET', `/api/public/restaurants/${me.slug}`);
  assert.strictEqual(page.data.gallery.length, 1);
  assert.strictEqual(page.data.gallery[0].dish, 'Croissant');
  const l1 = await diner('POST', '/api/public/like', { kind: 'photo', id: up.data.id });
  assert.deepStrictEqual(l1.data, { liked: true, likes: 1 });
  await diner('POST', '/api/public/like', { kind: 'dish', id: dish.id });
  await diner('POST', '/api/public/like', { kind: 'restaurant', id: me.id });
  const again = await diner('GET', `/api/public/restaurants/${me.slug}`);
  assert.strictEqual(again.data.restaurant.likes, 1); assert.strictEqual(again.data.restaurant.liked, true);
  assert.strictEqual(again.data.menu.find((m) => m.id === dish.id).likes, 1);
  assert.strictEqual(again.data.gallery[0].liked, true);
  const un = await diner('POST', '/api/public/like', { kind: 'photo', id: up.data.id });
  assert.deepStrictEqual(un.data, { liked: false, likes: 0 }, 'tapping again un-likes');
  const tr = await diner('GET', '/api/public/trending');
  assert.ok(tr.data.some((g) => g.id === up.data.id && g.restaurant.slug === me.slug));
  assert.strictEqual((await call('DELETE', `/api/admin/gallery/${up.data.id}`)).status, 200);
  assert.strictEqual((await diner('GET', `/api/public/restaurants/${me.slug}`)).data.gallery.length, 0);
});

test('import from your website: schema.org data, a menu page and photos', async () => {
  const site = {
    'https://queenmamas.example/': `<html><head><title>Queen Mama's Kitchen | Soul food in Portland</title>
      <meta property="og:image" content="/img/hero.jpg"><meta name="description" content="Fried chicken, greens and peach cobbler.">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant","name":"Queen Mama&#39;s Kitchen","servesCuisine":"Soul Food",
        "telephone":"(503) 555-0142","priceRange":"$$","address":{"@type":"PostalAddress","streetAddress":"12 NE Alberta St","addressLocality":"Portland","addressRegion":"OR","postalCode":"97211"},
        "openingHoursSpecification":[{"dayOfWeek":["Tuesday","Wednesday","Thursday"],"opens":"11:00","closes":"21:00"},{"dayOfWeek":"https://schema.org/Friday","opens":"11:00","closes":"23:00"}],
        "logo":"https://queenmamas.example/logo.png"}</script></head>
      <body><img src="/img/logo-small.png" width="80"><img src="/img/chicken.jpg" width="800"><a href="/our-menu">Menu</a></body></html>`,
    'https://queenmamas.example/our-menu': `<html><body><h2>Plates</h2><p>Fried Chicken ........ $18</p><p>crispy, with honey hot sauce</p><p>Smothered Pork Chop ..... $21</p>
      <h2>Sides</h2><p>Collard Greens (V) ..... $6</p><p>Mac &amp; Cheese ..... $7</p><h2>Dessert</h2><p>Peach Cobbler ..... $8</p></body></html>`,
  };
  const realFetch = global.fetch;
  global.fetch = async (u) => {
    if (site[u]) return new Response(site[u], { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response('nope', { status: 404 });
  };
  try {
    const out = await require('../src/site-import').importSite('queenmamas.example');
    assert.strictEqual(out.name, "Queen Mama's Kitchen");
    assert.deepStrictEqual([out.address, out.city, out.state, out.zip, out.phone, out.cuisine, out.price_level], ['12 NE Alberta St', 'Portland', 'OR', '97211', '(503) 555-0142', 'Soul Food', 2]);
    assert.strictEqual(out.hours[0].closed, true);
    assert.deepStrictEqual(out.hours[5], { closed: false, open: '11:00', close: '23:00' });
    assert.deepStrictEqual(out.images, ['https://queenmamas.example/img/hero.jpg', 'https://queenmamas.example/img/chicken.jpg']);
    assert.strictEqual(out.logo, 'https://queenmamas.example/logo.png');
    assert.deepStrictEqual(out.menu.map((m) => [m.section, m.name, m.price]), [['Plates', 'Fried Chicken', '18'], ['Plates', 'Smothered Pork Chop', '21'], ['Sides', 'Collard Greens', '6'], ['Sides', 'Mac & Cheese', '7'], ['Dessert', 'Peach Cobbler', '8']]);
    assert.strictEqual(out.menu[0].description, 'crispy, with honey hot sauce');
  } finally { global.fetch = realFetch; }
  const L = require('../src/site-import');
  assert.strictEqual(L.safeUrl('http://localhost:3000/x'), null);
  assert.strictEqual(L.safeUrl('http://169.254.169.254/latest'), null);
  assert.ok(L.safeUrl('joes-diner.com'));
});
