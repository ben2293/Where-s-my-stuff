const { Pool, types } = require('pg');

// Parse BIGINT (OID 20) as JS number instead of string
types.setTypeParser(20, val => parseInt(val, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Convert SQLite ? placeholders to Postgres $1, $2, ...
function convertParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function getDb() {
  // Run each statement separately — pg doesn't support multi-statement queries
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      picture TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry BIGINT DEFAULT 0,
      last_sync BIGINT DEFAULT 0,
      auth_token TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS packages (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      gmail_message_id TEXT NOT NULL,
      thread_id TEXT,
      from_address TEXT,
      merchant TEXT DEFAULT 'Unknown',
      carrier TEXT,
      tracking_number TEXT,
      order_number TEXT,
      status TEXT DEFAULT 'Order Confirmed',
      stage INTEGER DEFAULT 0,
      subject TEXT,
      received_date BIGINT,
      snippet TEXT,
      image_url TEXT,
      price INTEGER,
      expected_date TEXT,
      manually_delivered INTEGER DEFAULT 0,
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      UNIQUE(user_email, gmail_message_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      reason TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      UNIQUE(user_email, type, value)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pkg_user ON packages(user_email, received_date)`);
  return pool;
}

async function get(sql, params = []) {
  const { rows } = await pool.query(convertParams(sql), params);
  return rows[0];
}

async function all(sql, params = []) {
  const { rows } = await pool.query(convertParams(sql), params);
  return rows;
}

async function run(sql, params = []) {
  await pool.query(convertParams(sql), params);
}

module.exports = { getDb, get, all, run };
