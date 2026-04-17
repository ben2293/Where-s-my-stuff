const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');

let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  db.run(`PRAGMA foreign_keys = ON;`);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      picture TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry INTEGER DEFAULT 0,
      last_sync INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      gmail_message_id TEXT NOT NULL,
      merchant TEXT DEFAULT 'Unknown',
      carrier TEXT,
      tracking_number TEXT,
      order_number TEXT,
      status TEXT DEFAULT 'Order Confirmed',
      stage INTEGER DEFAULT 0,
      subject TEXT,
      received_date INTEGER,
      snippet TEXT,
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_email, gmail_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pkg_user ON packages(user_email, received_date);
  `);
  // Migrations — ignore errors if column already exists
  try { db.run(`ALTER TABLE packages ADD COLUMN thread_id TEXT`); } catch {}
  try { db.run(`ALTER TABLE packages ADD COLUMN image_url TEXT`); } catch {}
  try { db.run(`ALTER TABLE packages ADD COLUMN price INTEGER`); } catch {}
  try { db.run(`ALTER TABLE packages ADD COLUMN expected_date TEXT`); } catch {}
  try { db.run(`ALTER TABLE packages ADD COLUMN from_address TEXT`); } catch {}
  try { db.run(`ALTER TABLE packages ADD COLUMN manually_delivered INTEGER DEFAULT 0`); } catch {}
  try { db.run(`ALTER TABLE users ADD COLUMN auth_token TEXT`); } catch {}
  // User-learned blocks from thumbs-down feedback
  try {
    db.run(`CREATE TABLE IF NOT EXISTS user_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_email, type, value)
    )`);
  } catch {}
  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Promisified helpers that mirror better-sqlite3's sync API

function get(sql, params = []) {
  if (!db) throw new Error('DB not initialised');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

function all(sql, params = []) {
  if (!db) throw new Error('DB not initialised');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  if (!db) throw new Error('DB not initialised');
  db.run(sql, params);
  save();
}

module.exports = { getDb, get, all, run, save };
