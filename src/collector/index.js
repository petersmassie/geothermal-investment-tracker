require('dotenv').config();

const { RSS_FEEDS } = require('./sources');
const { fetchRssArticles } = require('./fetchFeeds');
const { fetchGdeltArticles } = require('./fetchGdelt');
const { processArticle } = require('./processArticle');
const db = require('./db');

async function main() {
  const runId = await db.startCollectorRun();
  const stats = {
    articlesFetched: 0, articlesPrefilteredIn: 0, extractionCalls: 0,
    dealsCreated: 0, dealsAutoPublished: 0, dealsQueuedForReview: 0, errors: [],
  };

  try {
    const [rssArticles, gdeltArticles] = await Promise.all([
      fetchRssArticles(RSS_FEEDS),
      fetchGdeltArticles(),
    ]);
    const allArticles = dedupeByUrl([...rssArticles, ...gdeltArticles]);
    stats.articlesFetched = allArticles.length;
    console.log(`[collector] Fetched ${allArticles.length} articles (${rssArticles.length} RSS, ${gdeltArticles.length} GDELT).`);

    for (const article of allArticles) {
      try {
        await processArticle(article, stats);
      } catch (err) {
        console.error(`[collector] Failed processing ${article.source_url}: ${err.message}`);
        stats.errors.push({ url: article.source_url, message: err.message });
      }
    }

    await db.finishCollectorRun(runId, stats, 'completed');
    console.log('[collector] Run complete.', stats);
  } catch (err) {
    console.error('[collector] Run failed:', err);
    stats.errors.push({ message: err.message });
    await db.finishCollectorRun(runId, stats, 'failed');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
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
