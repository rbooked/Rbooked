'use strict';
// Node.js database engine: built-in node:sqlite, stored in the file at DATABASE_PATH.
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./db');

if (!db.ready()) {
  const moduleName = 'node:sqlite'; // loaded by name so the Cloudflare bundle never pulls it in
  const { DatabaseSync } = require(moduleName);
  fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
  const sqlite = new DatabaseSync(path.resolve(config.databasePath));
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.init({
    exec: (sql) => sqlite.exec(sql),
    one: (sql, ...p) => sqlite.prepare(sql).get(...p),
    all: (sql, ...p) => sqlite.prepare(sql).all(...p),
    run: (sql, ...p) => sqlite.prepare(sql).run(...p),
    tx(fn) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const out = fn(); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  });
}
module.exports = db;
