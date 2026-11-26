'use strict';
// Database layer. The same SQL runs on two engines:
//  - Node.js: built-in node:sqlite (see db-node.js), used by `npm start`, tests and self-hosting.
//  - Cloudflare: a SQLite-backed Durable Object (see worker/index.js), used for the free hosted site.
// A driver provides exec(sql), one/all/run(sql, ...params) and tx(fn).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  cuisine TEXT DEFAULT '',
  price_level INTEGER DEFAULT 2,
  description TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  zip TEXT NOT NULL,
  lat REAL,
  lng REAL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  image_url TEXT DEFAULT '',
  max_party_size INTEGER DEFAULT 8,
  booking_window_days INTEGER DEFAULT 60,
  min_notice_minutes INTEGER DEFAULT 60,
  reminder_hours INTEGER DEFAULT 24,
  no_show_grace_minutes INTEGER DEFAULT 30,
  auto_no_show INTEGER DEFAULT 0,          -- 1 = automatically mark unseated guests as no-show after the grace period
  send_no_show_email INTEGER DEFAULT 1,
  cancellation_policy TEXT DEFAULT 'Please cancel at least 2 hours before your reservation.',
  accent_color TEXT DEFAULT '#c2410c',
  tags TEXT DEFAULT '',                  -- comma list of tag ids (see public/js/matcher.js)
  turn_times TEXT DEFAULT '2:90,4:120,6:180,99:210', -- reservation length by party size (maxParty:minutes)
  website_url TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  hours TEXT DEFAULT '',                 -- JSON, 7 days from Sunday: [{closed, open, close}]
  featured INTEGER DEFAULT 0,            -- set by the platform, shown in "Featured" sections
  -- billing
  trial_ends_at TEXT NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'trialing', -- trialing | active | past_due | canceled | expired
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_notice_sent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Dining areas / rooms on the floor plan (Main room, Patio, Bar...)
CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  min_seats INTEGER NOT NULL DEFAULT 1,
  max_seats INTEGER NOT NULL DEFAULT 4,
  shape TEXT NOT NULL DEFAULT 'square', -- square | round | rect | booth | bar
  x INTEGER NOT NULL DEFAULT 40,
  y INTEGER NOT NULL DEFAULT 40,
  rotation INTEGER NOT NULL DEFAULT 0,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

-- Services / shifts (Lunch, Dinner, Brunch...)
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6', -- 0=Sunday
  start_time TEXT NOT NULL,      -- 'HH:MM' first seating
  end_time TEXT NOT NULL,        -- 'HH:MM' last seating
  slot_interval INTEGER NOT NULL DEFAULT 15,
  turn_minutes INTEGER NOT NULL DEFAULT 90,
  max_covers_per_slot INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited (pacing)
  active INTEGER NOT NULL DEFAULT 1
);

-- Days the restaurant is closed or blocked for online booking
CREATE TABLE IF NOT EXISTS closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  reason TEXT DEFAULT '',
  open_time TEXT DEFAULT '',  -- special hours for just this date (first seating); empty = closed all day
  close_time TEXT DEFAULT ''  -- last seating
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,          -- short confirmation code shown to guests
  manage_token TEXT UNIQUE NOT NULL,  -- secret used in guest manage/cancel link
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  combo_id INTEGER REFERENCES table_combos(id) ON DELETE SET NULL,
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,       -- local date YYYY-MM-DD
  time TEXT NOT NULL,       -- local time HH:MM
  starts_at_utc TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  party_size INTEGER NOT NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT NOT NULL,
  notes TEXT DEFAULT '',
  internal_notes TEXT DEFAULT '',
  occasion TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'online', -- online | widget | phone | walk_in | admin
  status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | seated | completed | cancelled | no_show
  reminder_sent_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_res_rest_date ON reservations(restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_res_starts ON reservations(starts_at_utc);

-- Tables that can be pushed together for larger parties (e.g. T3 + T4 = 8 seats)
CREATE TABLE IF NOT EXISTS table_combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  table_ids TEXT NOT NULL,            -- comma list of table ids
  min_seats INTEGER NOT NULL DEFAULT 1,
  max_seats INTEGER NOT NULL DEFAULT 8,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

-- Restaurant's guest address book
CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  birthday TEXT DEFAULT '',           -- MM-DD or YYYY-MM-DD
  tags TEXT DEFAULT '',               -- comma list, e.g. VIP,Regular,Allergy
  notes TEXT DEFAULT '',              -- allergies, preferences, favorite table…
  marketing_opt_in INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guests_rest ON guests(restaurant_id, email);

-- Menu items guests can browse and filter (vegan, gluten-free…)
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  section TEXT NOT NULL DEFAULT 'Menu',   -- Starters, Mains, Desserts, Drinks…
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER,                    -- NULL = no price shown (e.g. market price)
  options TEXT DEFAULT '',                -- JSON: sizes, add-ons [{name, choices: [{name, price}]}]
  tags TEXT DEFAULT '',                   -- comma list: vegan,vegetarian,gluten_free,dairy_free,nut_free,halal,spicy
  sort_order INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_menu_rest ON menu_items(restaurant_id, sort_order);

-- Uploaded photos and logos (served at /img/:id)
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- cover | logo
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gallery_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL,
  caption TEXT DEFAULT '',
  menu_item_id INTEGER,                   -- optional: the dish in the photo
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gallery_rest ON gallery_photos(restaurant_id, sort_order);
-- Diner likes ("hearts") on restaurants, dishes and gallery photos. One per diner (browser) per thing.
CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                     -- restaurant | dish | photo
  target_id INTEGER NOT NULL,
  fan TEXT NOT NULL,                      -- anonymous diner id from a cookie
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, target_id, fan)
);
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(kind, target_id);
CREATE INDEX IF NOT EXISTS idx_likes_rest ON likes(restaurant_id, created_at);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,   -- sent | outbox | failed
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS zip_cache (
  zip TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  city TEXT,
  state TEXT
);
`;

let driver = null;

function migrate(d) {
  // Lightweight migrations for databases created by earlier versions.
  let cols; let rcols;
  try {
    cols = new Set(d.all('PRAGMA table_info(restaurants)').map((c) => c.name));
    rcols = new Set(d.all('PRAGMA table_info(reservations)').map((c) => c.name));
  } catch { return; } // engine without PRAGMA support: the schema above is already current
  if (!cols.has('tags')) d.exec("ALTER TABLE restaurants ADD COLUMN tags TEXT DEFAULT ''");
  if (!rcols.has('combo_id')) d.exec('ALTER TABLE reservations ADD COLUMN combo_id INTEGER');
  if (!rcols.has('guest_id')) d.exec('ALTER TABLE reservations ADD COLUMN guest_id INTEGER');
  if (!cols.has('turn_times')) d.exec("ALTER TABLE restaurants ADD COLUMN turn_times TEXT DEFAULT '2:90,4:120,6:180,99:210'");
  for (const [c, def] of [['website_url', "''"], ['logo_url', "''"], ['hours', "''"]]) if (!cols.has(c)) d.exec(`ALTER TABLE restaurants ADD COLUMN ${c} TEXT DEFAULT ${def}`);
  if (!cols.has('featured')) d.exec('ALTER TABLE restaurants ADD COLUMN featured INTEGER DEFAULT 0');
  try {
    const mcols = new Set(d.all('PRAGMA table_info(menu_items)').map((c) => c.name));
    if (mcols.size && !mcols.has('options')) d.exec("ALTER TABLE menu_items ADD COLUMN options TEXT DEFAULT ''");
  } catch { /* table is new */ }
  try {
    const ccols = new Set(d.all('PRAGMA table_info(closures)').map((c) => c.name));
    if (ccols.size && !ccols.has('open_time')) { d.exec("ALTER TABLE closures ADD COLUMN open_time TEXT DEFAULT ''"); d.exec("ALTER TABLE closures ADD COLUMN close_time TEXT DEFAULT ''"); }
  } catch { /* table is new */ }
}

/** Plug in a database engine and make sure the schema exists. */
function init(d) {
  driver = d;
  d.exec(SCHEMA);
  migrate(d);
  return d;
}
const ready = () => !!driver;
const need = () => { if (!driver) throw new Error('Database not initialised'); return driver; };

/** Run fn inside a transaction. */
const tx = (fn) => need().tx(fn);
const one = (sql, ...p) => need().one(sql, ...p);
const all = (sql, ...p) => need().all(sql, ...p);
const run = (sql, ...p) => need().run(sql, ...p);

module.exports = { init, ready, tx, one, all, run, SCHEMA };
