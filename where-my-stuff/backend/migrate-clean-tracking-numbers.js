require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Same validation rules as parser.js
const TRACKING_BLACKLIST = /^(number|no|id|code|ref|reference)$/i;

function isValidTrackingNumber(val) {
  if (!val || typeof val !== 'string') return false;
  if (val.length < 6) return false;
  if (!/^\d/.test(val) && !/^[A-Z]{2,4}\d/.test(val)) return false;
  if (TRACKING_BLACKLIST.test(val)) return false;
  return true;
}

async function main() {
  console.log('[migrate] Scanning for garbage tracking numbers...\n');

  const { rows } = await pool.query(`
    SELECT id, user_email, merchant, subject, tracking_number, received_date
    FROM packages
    WHERE tracking_number IS NOT NULL
    ORDER BY user_email, received_date DESC
  `);

  let cleaned = 0;
  let kept = 0;
  const byUser = {};

  for (const row of rows) {
    const valid = isValidTrackingNumber(row.tracking_number);
    if (!valid) {
      cleaned++;
      const key = row.user_email;
      if (!byUser[key]) byUser[key] = [];
      byUser[key].push({
        id: row.id,
        merchant: row.merchant,
        tracking_number: row.tracking_number,
        subject: (row.subject || '').slice(0, 60),
      });

      await pool.query(
        `UPDATE packages SET tracking_number = NULL, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = $1`,
        [row.id]
      );
    } else {
      kept++;
    }
  }

  console.log(`[migrate] Results:`);
  console.log(`  Total scanned:    ${rows.length}`);
  console.log(`  Cleaned (garbage): ${cleaned}`);
  console.log(`  Kept (valid):      ${kept}`);

  if (cleaned > 0) {
    console.log(`\n[migrate] Cleaned packages by user:`);
    for (const [email, items] of Object.entries(byUser)) {
      console.log(`\n  ${email} (${items.length} cleaned):`);
      for (const item of items) {
        console.log(`    [#${item.id}] "${item.subject}" — was: "${item.tracking_number}"`);
      }
    }
  }

  console.log('\n[migrate] Done.');
  await pool.end();
}

main().catch(err => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
