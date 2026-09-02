require('dotenv').config();
const { Pool, types } = require('pg');
const { DEAL_TYPE_QUALIFIER, CAPITAL_SOURCE_QUALIFIER } = require('../src/shared/taxonomy');

types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

// One-off cleanup for deals extracted before src/collector/extract.js's sanitizeQualifiers()
// existed (2026-09-02) — the Claude API doesn't hard-enforce tool-use enum constraints, so a
// handful of deals got a full descriptive sentence in a qualifier field instead of a real
// taxonomy code. This nulls out anything that doesn't match its closed list, the same
// validation new extractions now get automatically, and drops affected deals' confidence to
// 'low' so they sit in (or return to) the review queue rather than displaying bad data or
// having been auto-published on the strength of a bad field. Safe to re-run — it's a no-op
// once the data is clean. (tech_category has no qualifier tier as of taxonomy v3 — bad
// tech_category data from before that change is handled by db/migrations/002_simplify_tech_taxonomy.sql
// instead, not here.)
async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let totalFixed = 0;

    totalFixed += await fixQualifierColumn(client, 'deal_type', 'deal_type_qualifier', DEAL_TYPE_QUALIFIER);
    totalFixed += await fixInvestorQualifiers(client);

    await client.query('COMMIT');
    console.log(`Done. ${totalFixed} field(s) cleaned up.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function fixQualifierColumn(client, parentCol, qualifierCol, qualifierMap) {
  let fixed = 0;
  for (const [parentValue, allowed] of Object.entries(qualifierMap)) {
    if (allowed.length === 0) continue; // deliberate free-text bucket, nothing to validate
    const placeholders = allowed.map((_, i) => `$${i + 2}`).join(', ');
    const { rows } = await client.query(
      `UPDATE deals
       SET ${qualifierCol} = NULL, confidence = 'low', updated_at = now()
       WHERE ${parentCol} = $1
         AND ${qualifierCol} IS NOT NULL
         AND ${qualifierCol} NOT IN (${placeholders})
       RETURNING id, recipient`,
      [parentValue, ...allowed]
    );
    for (const r of rows) console.log(`  Fixed deal #${r.id} (${r.recipient}): invalid ${qualifierCol} for ${parentCol}=${parentValue}`);
    fixed += rows.length;
  }
  return fixed;
}

async function fixInvestorQualifiers(client) {
  let fixed = 0;
  for (const [parentValue, allowed] of Object.entries(CAPITAL_SOURCE_QUALIFIER)) {
    if (allowed.length === 0) continue;
    const placeholders = allowed.map((_, i) => `$${i + 2}`).join(', ');
    const { rows } = await client.query(
      `UPDATE deal_investors
       SET capital_source_qualifier = NULL
       WHERE capital_source = $1
         AND capital_source_qualifier IS NOT NULL
         AND capital_source_qualifier NOT IN (${placeholders})
       RETURNING id, deal_id`,
      [parentValue, ...allowed]
    );
    for (const r of rows) console.log(`  Fixed investor row #${r.id} on deal #${r.deal_id}: invalid capital_source_qualifier for capital_source=${parentValue}`);
    fixed += rows.length;
  }
  return fixed;
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exitCode = 1;
});
