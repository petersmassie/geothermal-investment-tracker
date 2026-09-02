// One-time historical backfill — separate from the daily collector (src/collector/index.js)
// on purpose, so a long/failed backfill run can never affect the daily cron job. Run
// manually, one chunk at a time (per the plan: batched, not a single unattended sweep),
// each invocation processing exactly one page or one month before exiting. Safe to
// re-run any chunk — every article is checked against `ingested_articles` by URL first
// (src/collector/processArticle.js), so reprocessing a page/month already done is a
// cheap no-op, not a duplicate.
//
// Usage (run from the project root, same as `npm run collect`):
//   node src/backfill/index.js --source=thinkgeoenergy --page=1
//   node src/backfill/index.js --source=doe --page=0
//   node src/backfill/index.js --source=gdelt --month=2022-06
//
// For thinkgeoenergy/doe, run pages in order starting from 1 (thinkgeoenergy) or 0
// (doe) — each run prints whether there's a next page. For gdelt, run months in order
// (oldest or newest first, your call) across the ~4-year backfill window — GDELT is NOT
// YET VERIFIED reachable from this environment; run db/test_gdelt_connectivity.js first.

require('dotenv').config();

const { fetchThinkGeoenergyArchivePage, fetchDoeArchivePage } = require('./archiveSources');
const { fetchGdeltHistorical } = require('./gdeltHistorical');
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
  const { source, page, month } = parseArgs();
  if (!source) {
    console.error('Usage: node src/backfill/index.js --source=thinkgeoenergy|doe|gdelt [--page=N] [--month=YYYY-MM]');
    process.exitCode = 1;
    return;
  }

  const stats = {
    articlesFetched: 0, articlesPrefilteredIn: 0, extractionCalls: 0,
    dealsCreated: 0, dealsAutoPublished: 0, dealsQueuedForReview: 0, errors: [],
  };

  try {
    let articles = [];
    let hasMore = false;

    if (source === 'thinkgeoenergy') {
      const pageNum = Number(page || 1);
      console.log(`[backfill] Fetching ThinkGeoenergy Finance archive, page ${pageNum} ...`);
      ({ articles, hasMore } = await fetchThinkGeoenergyArchivePage(pageNum));
      console.log(`[backfill] Next page: run again with --page=${pageNum + 1}` + (hasMore ? '' : ' (this was the last page — nothing more to run)'));
    } else if (source === 'doe') {
      const pageNum = Number(page || 0);
      console.log(`[backfill] Fetching DOE Geothermal news archive, page ${pageNum} ...`);
      ({ articles, hasMore } = await fetchDoeArchivePage(pageNum));
      console.log(`[backfill] Next page: run again with --page=${pageNum + 1}` + (hasMore ? '' : ' (this was the last page — nothing more to run)'));
    } else if (source === 'gdelt') {
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        console.error('For --source=gdelt, pass --month=YYYY-MM (e.g. --month=2022-06)');
        process.exitCode = 1;
        return;
      }
      const { startDate, endDate } = monthRange(month);
      console.log(`[backfill] Sweeping GDELT for ${startDate} .. ${endDate} (broad + named-companies queries) ...`);
      const [broad, named] = await Promise.all([
        fetchGdeltHistorical(startDate, endDate, 'broad'),
        fetchGdeltHistorical(startDate, endDate, 'named_companies'),
      ]);
      articles = dedupeByUrl([...broad, ...named]);
      console.log(`[backfill] GDELT returned ${broad.length} (broad) + ${named.length} (named companies) = ${articles.length} unique articles for this month.`);
      if (broad.length === 250 || named.length === 250) {
        console.log('[backfill] WARNING: one query hit GDELT\'s 250-record cap for this month — some articles may be missed. Consider narrowing further (e.g. by half-month) if this month looks important.');
      }
    } else {
      console.error(`Unknown --source=${source}. Use thinkgeoenergy, doe, or gdelt.`);
      process.exitCode = 1;
      return;
    }

    stats.articlesFetched = articles.length;
    console.log(`[backfill] Processing ${articles.length} articles through the extraction pipeline ...`);

    for (const article of articles) {
      try {
        await processArticle(article, stats);
      } catch (err) {
        console.error(`[backfill] Failed processing ${article.source_url}: ${err.message}`);
        stats.errors.push({ url: article.source_url, message: err.message });
      }
    }

    console.log('[backfill] Chunk complete.', stats);
  } catch (err) {
    console.error('[backfill] Run failed:', err);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

function monthRange(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1)); // first day of next month
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function dedupeByUrl(articles) {
  const seen = new Set();
  return articles.filter((a) => {
    if (seen.has(a.source_url)) return false;
    seen.add(a.source_url);
    return true;
  });
}

main();
