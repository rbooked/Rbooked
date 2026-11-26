// Cloudflare entry point (free Workers plan).
// - Static files in /public are served by Cloudflare directly (see wrangler.jsonc "assets").
// - Everything else (/api/*, /img/*, /healthz) goes to one Durable Object that holds the SQLite
//   database and runs the same Express-style app as the Node.js server.
// - A cron trigger runs reminders, auto no-shows and trial notices every 5 minutes.
import { DurableObject } from 'cloudflare:workers';

const toBinding = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Uint8Array) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  return v;
};

function sqliteDriver(storage) {
  const sql = storage.sql;
  const q = (text, params) => sql.exec(text, ...params.map(toBinding));
  return {
    exec: (text) => { sql.exec(text); },
    one: (text, ...p) => q(text, p).toArray()[0],
    all: (text, ...p) => q(text, p).toArray(),
    run(text, ...p) {
      const cur = q(text, p);
      cur.toArray();
      const changes = cur.rowsWritten;
      const lastInsertRowid = sql.exec('SELECT last_insert_rowid() AS id').one().id;
      return { changes, lastInsertRowid };
    },
    tx: (fn) => storage.transactionSync(fn),
  };
}

import restaurantHtml from '../../public/restaurant.html'; // the restaurant page template, for /r/<slug>

export class RbookedDB extends DurableObject {
  setup() {
    if (this.app) return;
    globalThis.__rbRestaurantHtml = restaurantHtml;
    if (this.env.AI) globalThis.__rbAI = this.env.AI; // Workers AI (free daily allowance) for smart menu reading
    for (const [k, v] of Object.entries(this.env)) if (typeof v === 'string') process.env[k] = v;
    const db = require('../db.js');
    db.init(sqliteDriver(this.ctx.storage));
    if (!process.env.SESSION_SECRET) {
      // No secret set in the dashboard: create one once and keep it in the database.
      db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      let row = db.one("SELECT value FROM app_settings WHERE key = 'session_secret'");
      if (!row) {
        const value = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
        db.run("INSERT INTO app_settings (key, value) VALUES ('session_secret', ?)", value);
        row = { value };
      }
      process.env.SESSION_SECRET = row.value;
    }
    this.express = require('./mini-express.js');
    this.app = require('../server.js');
  }

  async fetch(request) {
    this.setup();
    const response = await this.express.handle(this.app, request);
    await require('../email.js').flush(); // finish sending booking emails before the request ends
    return response;
  }

  async runJobs() {
    this.setup();
    await require('../jobs.js').runAll();
    await require('../email.js').flush();
  }
}

const mainDb = (env) => env.DB.get(env.DB.idFromName('main'));

export default {
  fetch(request, env) {
    return mainDb(env).fetch(request);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(mainDb(env).runJobs());
  },
};
