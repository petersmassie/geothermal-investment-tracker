// Minimal migration runner: applies db/schema.sql in full. Every statement in that
// file is idempotent (CREATE TABLE/INDEX IF NOT EXISTS), so re-running this is safe —
// there's no migration ledger yet because the schema is still in its first version.
// If/when the schema needs to evolve after real data exists, split future changes into
// numbered files in db/migrations/ and extend this runner to track which have applied.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in, or set it in your shell.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log(`Applying ${schemaPath} ...`);
  try {
    await pool.query(sql);
    console.log('Schema applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
