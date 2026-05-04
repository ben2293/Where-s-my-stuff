require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Same validation rules as parser.js
const ORDER_WORD_BLACKLIST = /^(confirmed|placed|received|shipped|dispatched|delivered|update|processing|accepted|cancelled|canceled|payment|status|order|number|track|tracking|ref|id|has|been|will|your|this|that|with|from|for|and|the|are|you|not|but|can|had|her|was|one|our|out|day|get|him|his|how|its|may|new|now|old|see|two|who|boy|did|she|use|way|many|oil|sit|set|run|eat|far|sea|eye|ago|off|too|any|say|man|try|ask|end|why|let|put|come|here|just|like|long|make|over|such|take|than|them|well|were|what|have|they|know|want|good|much|some|time|very|tell)$/i;

function isValidOrderNumber(val) {
  if (!val || typeof val !== 'string') return false;
  if (val.length < 5) return false;
  if (!/\d/.test(val)) return false;
  if (ORDER_WORD_BLACKLIST.test(val)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_]+$/.test(val)) return false;
  return true;
}

async function main() {
  console.log('[migrate] Scanning for garbage order numbers...\n');

  const { rows } = await pool.query(`
    SELECT id, user_email, merchant, subject, order_number, received_date
    FROM packages
    WHERE order_number IS NOT NULL
    ORDER BY user_email, received_date DESC
  `);

  let cleaned = 0;
  let kept = 0;
  const byUser = {};

  for (const row of rows) {
    const valid = isValidOrderNumber(row.order_number);
    if (!valid) {
      cleaned++;
      const key = row.user_email;
      if (!byUser[key]) byUser[key] = [];
      byUser[key].push({
        id: row.id,
        merchant: row.merchant,
        order_number: row.order_number,
        subject: (row.subject || '').slice(0, 60),
      });

      await pool.query(
        `UPDATE packages SET order_number = NULL, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = $1`,
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
        console.log(`    [#${item.id}] "${item.subject}" — was: "${item.order_number}"`);
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
