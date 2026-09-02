// Processing-only step, the counterpart to discoverArchive.js: reads a JSON queue file
// (produced elsewhere, wherever has network access to the source site) and runs every
// article through the same extraction pipeline as the daily collector and the direct
// backfill (src/collector/processArticle.js) — needs DATABASE_URL and ANTHROPIC_API_KEY,
// which is why this runs on Render, where those already live safely, rather than
// wherever discoverArchive.js happened to run.
//
// Usage: node src/backfill/processQueueFile.js --file=data/backfill-queue/thinkgeoenergy-pages-1-5.json

require('dotenv').config();
const fs = require('fs');
const { processArticle } = require('../collector/processArticle');
const db = require('../collector/db');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([a-z]+)=(.+)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const { file } = parseArgs();
  if (!file) {
    console.error('Usage: node src/backfill/processQueueFile.js --file=path/to/queue.json');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exitCode = 1;
    return;
  }

  const { source, pagesRequested, articles } = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`[processQueueFile] Loaded ${articles.length} articles from ${file} (source=${source}, pages=${pagesRequested}).`);

  const stats = {
    articlesFetched: articles.length, articlesPrefilteredIn: 0, extractionCalls: 0,
    dealsCreated: 0, dealsAutoPublished: 0, dealsQueuedForReview: 0, errors: [],
  };

  try {
    for (const article of articles) {
      try {
        await processArticle(article, stats);
      } catch (err) {
        console.error(`[processQueueFile] Failed processing ${article.source_url}: ${err.message}`);
        stats.errors.push({ url: article.source_url, message: err.message });
      }
    }
    console.log('[processQueueFile] Done.', stats);
  } finally {
    await db.pool.end();
  }
}

main();
