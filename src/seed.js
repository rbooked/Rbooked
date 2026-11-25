'use strict';
// Seeds demo restaurants, floor plans, services, and sample reservations.
// Usage: npm run seed   (add --reset to wipe the database first)
const fs = require('fs');
const path = require('path');
const config = require('./config');

if (process.argv.includes('--reset')) {
  for (const s of ['', '-wal', '-shm']) {
    const f = path.resolve(config.databasePath + s);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

require('./db-node');
const { one, run, tx } = require('./db');
const { hashPassword } = require('./auth');
const { zonedToUtc, nowInZone, addDays } = require('./time');
const crypto = require('crypto');

const ZIPS = [
  ['10001', 40.7506, -73.9972, 'New York', 'NY'], ['10011', 40.7402, -73.9996, 'New York', 'NY'], ['10013', 40.7201, -74.0049, 'New York', 'NY'],
  ['94103', 37.7725, -122.4147, 'San Francisco', 'CA'], ['94110', 37.7509, -122.4153, 'San Francisco', 'CA'],
  ['97205', 45.5205, -122.6880, 'Portland', 'OR'], ['97209', 45.5287, -122.6835, 'Portland', 'OR'], ['97214', 45.5136, -122.6417, 'Portland', 'OR'],
  ['60607', 41.8721, -87.6578, 'Chicago', 'IL'], ['78701', 30.2711, -97.7437, 'Austin', 'TX'],
];

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
];

const TAGS = {"Ember & Rye": "classy,romantic,cocktails,vegetarian", "Little Saffron": "vegan,vegetarian,halal,casual,family", "Osteria Lume": "romantic,classy,quiet,vegetarian", "Kumo Sushi Bar": "classy,quiet,gluten_free", "Marrow & Vine": "classy,cocktails,views,gluten_free", "Tía Luz Cocina": "casual,lively,outdoor,family,vegetarian,vegan", "Fern & Fig": "vegan,vegetarian,gluten_free,casual,outdoor", "Harbor Oyster House": "classy,views,cocktails,gluten_free", "The Copper Kettle": "casual,lively,late_night,family", "Smoke Signal BBQ": "casual,lively,family,outdoor,gluten_free", "Pilsen Table": "lively,cocktails,late_night,vegan,vegetarian"};
const FEATURED = new Set(["Ember & Rye", "Fern & Fig", "Harbor Oyster House", "Kumo Sushi Bar", "Smoke Signal BBQ", "Tía Luz Cocina"]);

const FIRST = ['Ava', 'Liam', 'Maya', 'Noah', 'Sofia', 'Ethan', 'Zoe', 'Lucas', 'Priya', 'Omar', 'Grace', 'Diego', 'Hana', 'Sam'];
const LAST = ['Johnson', 'Kim', 'Garcia', 'Patel', 'Nguyen', 'Brown', 'Rossi', 'Cohen', 'Okafor', 'Silva', 'Lee', 'Martin'];

if (one('SELECT COUNT(*) AS n FROM restaurants').n > 0) {
  console.log('Database already has data. Run `npm run seed -- --reset` to start fresh.');
  process.exit(0);
}

tx(() => {
  for (const [zip, lat, lng, city, state] of ZIPS) run('INSERT OR REPLACE INTO zip_cache VALUES (?,?,?,?,?)', zip, lat, lng, city, state);
  RESTAURANTS.forEach(([name, cuisine, price, zip, address, tz, desc, color], idx) => {
    const z = ZIPS.find((x) => x[0] === zip);
    const jitter = () => (Math.random() - 0.5) * 0.01;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const trialEnds = new Date(Date.now() + 30 * 86400000).toISOString();
    const rid = run(`INSERT INTO restaurants (slug, name, cuisine, price_level, description, phone, email, address, city, state, zip, lat, lng, timezone,
      accent_color, trial_ends_at, subscription_status, tags, featured) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, name, cuisine, price, desc, `(555) 01${String(idx).padStart(2, '0')}-${1000 + idx * 7}`, `hello@${slug}.example`,
    address, z[3], z[4], zip, z[1] + jitter(), z[2] + jitter(), tz, color, trialEnds, idx === 0 ? 'trialing' : 'active',
    TAGS[name] || '', FEATURED.has(name) ? 1 : 0).lastInsertRowid;

    const main = run('INSERT INTO areas (restaurant_id, name, sort_order) VALUES (?,?,0)', rid, 'Main room').lastInsertRowid;
    const patio = run('INSERT INTO areas (restaurant_id, name, sort_order) VALUES (?,?,1)', rid, 'Patio').lastInsertRowid;
    const tables = [
      [main, 'T1', 1, 2, 'square', 40, 40], [main, 'T2', 1, 2, 'square', 150, 40], [main, 'T3', 2, 4, 'square', 260, 40],
      [main, 'T4', 2, 4, 'round', 40, 170], [main, 'T5', 2, 4, 'round', 150, 170], [main, 'B1', 4, 6, 'booth', 270, 170],
      [main, 'T6', 6, 10, 'rect', 40, 300], [patio, 'P1', 2, 4, 'round', 40, 40], [patio, 'P2', 2, 4, 'round', 150, 40],
      [patio, 'Bar', 1, 2, 'bar', 260, 40],
    ];
    for (const [area, label, mn, mx, shape, x, y] of tables) {
      run('INSERT INTO tables (restaurant_id, area_id, label, min_seats, max_seats, shape, x, y, online_bookable) VALUES (?,?,?,?,?,?,?,?,?)',
        rid, area, label, mn, mx, shape, x, y, label === 'Bar' ? 0 : 1);
    }
    const tid = (label) => one('SELECT id FROM tables WHERE restaurant_id = ? AND label = ?', rid, label).id;
    for (const [name, labels, mn, mx] of [['T1 + T2', ['T1', 'T2'], 3, 4], ['T4 + T5', ['T4', 'T5'], 5, 8], ['P1 + P2', ['P1', 'P2'], 5, 8], ['T6 + B1', ['T6', 'B1'], 10, 16]]) {
      run('INSERT INTO table_combos (restaurant_id, name, table_ids, min_seats, max_seats, online_bookable) VALUES (?,?,?,?,?,?)', rid, name, labels.map(tid).join(','), mn, mx, mx > 10 ? 0 : 1);
    }
    run(`INSERT INTO shifts (restaurant_id, name, days, start_time, end_time, slot_interval, turn_minutes, max_covers_per_slot)
         VALUES (?, 'Lunch', '1,2,3,4,5', '11:30', '14:00', 15, 75, 12)`, rid);
    run(`INSERT INTO shifts (restaurant_id, name, days, start_time, end_time, slot_interval, turn_minutes, max_covers_per_slot)
         VALUES (?, 'Dinner', '0,1,2,3,4,5,6', '17:00', '21:30', 15, 90, 16)`, rid);
    run(`INSERT INTO shifts (restaurant_id, name, days, start_time, end_time, slot_interval, turn_minutes, max_covers_per_slot)
         VALUES (?, 'Weekend brunch', '0,6', '10:00', '13:30', 30, 75, 0)`, rid);

    // Profile: placeholder cover art and logo, opening hours from the services, website, and a menu.
    const S = require('../public/js/samples');
    const shiftRows = require('./db').all('SELECT * FROM shifts WHERE restaurant_id = ?', rid);
    run('UPDATE restaurants SET image_url = ?, logo_url = ?, hours = ?, website_url = ? WHERE id = ?',
      S.coverArt({ cuisine, accent_color: color }), S.logoArt({ name, accent_color: color }), JSON.stringify(S.hoursFromShifts(shiftRows)), `https://example.com/${slug}`, rid);
    for (const m of S.menuFor(cuisine)) {
      run('INSERT INTO menu_items (restaurant_id, section, name, description, price_cents, tags, sort_order) VALUES (?,?,?,?,?,?,?)',
        rid, m.section, m.name, m.description, m.price_cents, m.tags, m.sort_order);
    }

    if (idx === 0) {
      run('INSERT INTO users (restaurant_id, name, email, password_hash) VALUES (?,?,?,?)', rid, 'Demo Owner', 'demo@rbooked.test', hashPassword('demo1234'));
    }

    // Sample reservations: today and the next 3 days, dinner service.
    const today = nowInZone(tz).date;
    const tableRows = require('./db').all('SELECT id, max_seats FROM tables WHERE restaurant_id = ? AND online_bookable = 1', rid);
    for (let d = 0; d < 4; d++) {
      const date = addDays(today, d);
      const used = new Set();
      ['17:30', '18:00', '18:30', '19:00', '19:15', '19:30', '20:00', '20:30'].forEach((time, i) => {
        if (Math.random() < 0.35) return;
        const t = tableRows.find((tb) => !used.has(`${tb.id}-${Math.floor(i / 3)}`) && tb.max_seats >= 2);
        if (!t) return;
        used.add(`${t.id}-${Math.floor(i / 3)}`);
        const fn = FIRST[(idx + d + i) % FIRST.length]; const ln = LAST[(idx * 3 + i) % LAST.length];
        const party = Math.min(t.max_seats, 2 + ((i + d) % 3));
        const code = crypto.randomBytes(3).toString('hex').toUpperCase();
        run(`INSERT INTO reservations (code, manage_token, restaurant_id, table_id, date, time, starts_at_utc, duration_minutes, party_size,
            guest_name, guest_email, guest_phone, notes, source, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        code, crypto.randomBytes(20).toString('hex'), rid, t.id, date, time, zonedToUtc(date, time, tz).toISOString(), require('../public/js/matcher').turnFor('2:90,4:120,6:180,99:210', party, 90), party,
        `${fn} ${ln}`, `${fn}.${ln}@example.com`.toLowerCase(), `(555) 2${String(i).padStart(2, '0')}-${4000 + d * 10 + i}`,
        i === 2 ? 'Window seat if possible' : i === 5 ? 'Birthday' : '', ['online', 'widget', 'phone'][i % 3], 'confirmed');
      });
    }
  });
});

// Build each restaurant's address book from the sample bookings, with a few notes and tags.
const { upsertGuest } = require('./reservations');
const NOTES = [['VIP,Regular', 'Prefers a booth. Likes the house red.'], ['Allergy', 'Severe nut allergy. Tell the kitchen.'], ['Regular', 'Celebrates anniversary every spring.'], ['', ''], ['VIP', 'Food writer. Comp a dessert.'], ['', '']];
tx(() => {
  const rows = require('./db').all('SELECT id, restaurant_id, guest_name, guest_email, guest_phone FROM reservations');
  for (const x of rows) {
    const gid = upsertGuest(x.restaurant_id, { guest_name: x.guest_name, guest_email: x.guest_email, guest_phone: x.guest_phone });
    run('UPDATE reservations SET guest_id = ? WHERE id = ?', gid, x.id);
  }
  require('./db').all('SELECT id FROM guests').forEach((g, i) => {
    const [tags, notes] = NOTES[i % NOTES.length];
    run('UPDATE guests SET tags = ?, notes = ? WHERE id = ?', tags, notes, g.id);
  });
});

console.log(`Seeded ${RESTAURANTS.length} restaurants.`);
console.log('Demo restaurant login: demo@rbooked.test / demo1234');
console.log('Try ZIP codes: 10011 (NYC), 94110 (SF), 97205 (Portland), 60607 (Chicago), 78701 (Austin)');
