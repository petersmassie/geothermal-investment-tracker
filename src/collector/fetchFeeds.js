const Parser = require('rss-parser');
const parser = new Parser({ timeout: 15000 });

/**
 * Fetch every configured RSS feed. A single feed failing (dead URL, timeout, malformed
 * XML) never aborts the run — it's logged and skipped so one bad feed can't take down
 * the whole daily collection.
 * @param {{name: string, url: string}[]} feeds
 * @returns {Promise<Array<{source_url: string, source_feed: string, title: string, summary: string, publishedAt: string|null}>>}
 */
async function fetchRssArticles(feeds) {
  const results = [];
  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items || []) {
        if (!item.link) continue;
        results.push({
          source_url: item.link,
          source_feed: feed.name,
          title: item.title || '',
          summary: item.contentSnippet || item.content || item.summary || '',
          publishedAt: item.isoDate || item.pubDate || null,
        });
      }
    } catch (err) {
      console.error(`[fetchFeeds] Failed to fetch "${feed.name}" (${feed.url}): ${err.message}`);
    }
  }
  return results;
}

module.exports = { fetchRssArticles };
