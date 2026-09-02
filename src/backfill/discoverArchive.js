// Discovery-only step: crawls an archive source (see archiveSources.js) and writes the
// discovered articles to a JSON file. Deliberately needs NO secrets — no DATABASE_URL,
// no ANTHROPIC_API_KEY — just network access, so it can run anywhere that can reach the
// source site, independent of wherever the processing step (processQueueFile.js) runs.
//
// This exists because ThinkGeoenergy's bot-defense blocks Render's IP range specifically
// (confirmed 2026-09-02 — same request works fine from elsewhere, 403s only from
// Render), while the processing step needs the production database and Claude API key,
// which live safely in Render's environment and should never be pasted into a chat or
// committed to git. Splitting the two lets discovery run wherever has network access and
// processing run wherever has the credentials, without the two ever needing to meet.
//
// Usage: node src/backfill/discoverArchive.js --source=thinkgeoenergy --page=1 --out=queue.json
//        node src/backfill/discoverArchive.js --source=thinkgeoenergy --pages=1-5 --out=queue.json

const fs = require('fs');
const { fetchThinkGeoenergyArchivePage, fetchDoeArchivePage } = require('./archiveSources');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([a-z]+)=(.+)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const { source, page, pages, out } = parseArgs();
  if (!source || !out) {
    console.error('Usage: node src/backfill/discoverArchive.js --source=thinkgeoenergy|doe (--page=N | --pages=N-M) --out=queue.json');
    process.exitCode = 1;
    return;
  }

  const fetchPage = source === 'thinkgeoenergy' ? fetchThinkGeoenergyArchivePage
    : source === 'doe' ? fetchDoeArchivePage
    : null;
  if (!fetchPage) {
    console.error(`Unknown --source=${source}. Use thinkgeoenergy or doe.`);
    process.exitCode = 1;
    return;
  }

  const [start, end] = pages ? pages.split('-').map(Number) : [Number(page || 1), Number(page || 1)];

  const allArticles = [];
  let lastHasMore = true;
  for (let p = start; p <= end; p += 1) {
    console.log(`[discoverArchive] Fetching ${source} page ${p} ...`);
    const { articles, hasMore } = await fetchPage(p);
    console.log(`[discoverArchive]   -> ${articles.length} articles, hasMore=${hasMore}`);
    allArticles.push(...articles);
    lastHasMore = hasMore;
    if (!hasMore) {
      console.log(`[discoverArchive] Page ${p} was the last page — stopping early.`);
      break;
    }
  }

  const deduped = dedupeByUrl(allArticles);
  fs.writeFileSync(out, JSON.stringify({ source, pagesRequested: `${start}-${end}`, hasMore: lastHasMore, articles: deduped }, null, 2));
  console.log(`[discoverArchive] Wrote ${deduped.length} articles to ${out}.`);
  if (lastHasMore) {
    console.log(`[discoverArchive] More pages remain — next run with --page=${end + 1} (or --pages=${end + 1}-...).`);
  }
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
