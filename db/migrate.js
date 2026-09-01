// Migration runner: applies db/schema.sql (the current target schema — always safe to
// re-run, CREATE TABLE/INDEX IF NOT EXISTS throughout), then applies every file in
// db/migrations/ in filename order, skipping ones already recorded as applied. This
// is what lets a fresh install and an already-running production database converge on
// the same schema: a fresh DB gets everything from schema.sql directly and finds each
// migration file already a no-op; an existing DB gets brought forward by the migrations.

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

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    const schemaPath = path.join(__dirname, 'schema.sql');
    console.log(`Applying ${schemaPath} ...`);
    await pool.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('Base schema applied.');

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
      : [];

    for (const file of files) {
      const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (rows.length > 0) {
        console.log(`Skipping ${file} (already applied).`);
        continue;
      }
      console.log(`Applying migrations/${file} ...`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied ${file}.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }

    console.log('All migrations up to date.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
