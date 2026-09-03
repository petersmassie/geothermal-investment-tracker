// One-off repair pass for existing deals written before the shorthand-amount fix (see
// src/collector/extract.js rule 4 and src/collector/recheckAmount.js): re-derives each
// deal's amount/currency from its stored title + excerpt and updates it if it changed.
// Leaves every other field (recipient, deal_type, tech_category, review_status, ...)
// untouched — this is not a re-extraction, only an amount/currency repair, so it can
// never overwrite a manual correction a reviewer already made to anything else.
//
// Defaults to a dry run (prints every proposed change, writes nothing) — pass --apply to
// actually update the database. Always run the dry run first and read through it; this
// is production data and the point of a dry run is to catch a bad batch before it's
// written, not to rubber-stamp whatever the model says a second time.
//
// Usage: node db/recheck_amounts.js            (dry run)
//        node db/recheck_amounts.js --apply     (writes changes)
//        node db/recheck_amounts.js --apply --limit=20   (process only the first 20, for a smaller first pass)

require('dotenv').config();
const { Pool, types } = require('pg');
const { recheckAmount } = require('../src/collector/recheckAmount');
const { toUsd } = require('../src/collector/currency');

// pg returns NUMERIC as a string by default — parse once here so amount comparisons
// below are numeric, not string, comparisons (see src/collector/db.js for the same fix
// applied to the main app pool).
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

function parseArgs() {
  const args = { apply: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--apply') { args.apply = true; continue; }
    const match = arg.match(/^--([a-z]+)=(.+)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const { apply, limit } = parseArgs();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.recipient, d.amount, d.currency, d.excerpt, ia.title
       FROM deals d
       LEFT JOIN ingested_articles ia ON ia.deal_id = d.id
       WHERE d.amount IS NOT NULL
       ORDER BY d.id
       ${limit ? 'LIMIT $1' : ''}`,
      limit ? [Number(limit)] : []
    );
    console.log(`[recheck_amounts] ${rows.length} deal(s) with a non-null amount to check. Mode: ${apply ? 'APPLY (writing changes)' : 'DRY RUN (no changes written)'}.`);

    let changed = 0;
    let unchanged = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const result = await recheckAmount({
          title: row.title,
          excerpt: row.excerpt,
          currentAmount: row.amount,
          currentCurrency: row.currency,
        });

        const sameAmount = (result.amount == null && row.amount == null) || Number(result.amount) === Number(row.amount);
        const sameCurrency = (result.currency || null) === (row.currency || null);

        if (sameAmount && sameCurrency) {
          unchanged += 1;
          continue;
        }

        changed += 1;
        console.log(
          `[${apply ? 'APPLYING' : 'DRY-RUN'}] deal ${row.id} (${row.recipient || '(unnamed)'}): `
          + `${row.amount ?? 'null'} ${row.currency || ''} -> ${result.amount ?? 'null'} ${result.currency || ''}`
        );

        if (apply) {
          const amount_usd = toUsd(result.amount, result.currency);
          await pool.query(
            `UPDATE deals SET amount = $1, currency = $2, amount_usd = $3, updated_at = now() WHERE id = $4`,
            [result.amount, result.currency, amount_usd, row.id]
          );
        }
      } catch (err) {
        errors += 1;
        console.error(`[recheck_amounts] Failed for deal ${row.id}: ${err.message}`);
      }
    }

    console.log(`[recheck_amounts] Done. changed=${changed} unchanged=${unchanged} errors=${errors} mode=${apply ? 'applied' : 'dry-run'}.`);
    if (!apply && changed > 0) {
      console.log('[recheck_amounts] This was a dry run — nothing was written. Re-run with --apply once these look right.');
    }
  } finally {
    await pool.end();
  }
}

main();
