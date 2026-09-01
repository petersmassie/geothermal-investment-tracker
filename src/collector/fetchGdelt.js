const { GDELT_QUERY } = require('./sources');

/**
 * Query the GDELT DOC 2.0 API as a catch-all sweep alongside the curated RSS feeds.
 * Free, no API key, but undocumented rate limits — a single failure here is logged
 * and treated as "no results" rather than aborting the run.
 * @returns {Promise<Array<{source_url: string, source_feed: string, title: string, summary: string, publishedAt: string|null}>>}
 */
async function fetchGdeltArticles() {
  const url = new URL(GDELT_QUERY.baseUrl);
  url.searchParams.set('query', GDELT_QUERY.query);
  for (const [key, value] of Object.entries(GDELT_QUERY.params)) {
    url.searchParams.set(key, value);
  }

  try {
    const res = await fetch(url.toString(), { headers: { 'User-Agent': 'geothermal-investment-tracker/0.1' } });
    if (!res.ok) {
      console.error(`[fetchGdelt] GDELT returned HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    const articles = body.articles || [];
    return articles
      .filter((a) => a.url)
      .map((a) => ({
        source_url: a.url,
        source_feed: 'GDELT',
        title: a.title || '',
        summary: '', // GDELT DOC list mode doesn't return a summary — the extractor fetches full text if needed
        publishedAt: a.seendate || null,
      }));
  } catch (err) {
    console.error(`[fetchGdelt] Failed: ${err.message}`);
    return [];
  }
}

module.exports = { fetchGdeltArticles };
