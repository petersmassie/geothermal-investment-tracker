require('dotenv').config();
const { Pool } = require('pg');

// One-off recovery for the specific production incident on 2026-09-02: the very first
// run of the ThinkGeoenergy archive backfill happened before ANTHROPIC_API_KEY was set
// on the web service, so every extraction call failed with an auth error. Before the
// fix in src/collector/extract.js (callModel used to swallow a failed API call and
// return null, which extractDeal treated identically to "Claude looked at this and said
// it's not a deal"), those failures got permanently recorded in ingested_articles as
// passed_prefilter=true, is_relevant=false — which means hasSeenUrl() will skip them
// forever, even now that the underlying bug is fixed and the key is set correctly.
//
// This deletes those specific rows so the affected articles get a genuine first attempt
// next time processQueueFile.js runs on the same file. Scoped tightly and safe: only
// rows for the given --source-feed with no deal_id (nothing here ever produced a real
// deal, since every extraction call failed outright — there's no legitimate data to lose).
//
// Usage: node db/reset_ingested_source.js --source-feed="ThinkGeoenergy (archive)"

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const { 'source-feed': sourceFeed } = parseArgs();
  if (!sourceFeed) {
    console.error('Usage: node db/reset_ingested_source.js --source-feed="ThinkGeoenergy (archive)"');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  try {
    const { rows } = await pool.query(
      `DELETE FROM ingested_articles WHERE source_feed = $1 AND deal_id IS NULL RETURNING source_url`,
      [sourceFeed]
    );
    console.log(`Deleted ${rows.length} record(s) for source_feed = "${sourceFeed}" (deal_id IS NULL, so nothing real was lost).`);
    console.log('These URLs will be genuinely re-attempted on the next processing run.');
  } finally {
    await pool.end();
  }
}

main();
