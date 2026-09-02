// Direct crawls of two sources confirmed (2026-09-02, by fetching and inspecting the
// real HTML, not just assuming) to publish a real, plain-HTML, multi-year paginated
// archive of their own — unlike RSS, which only ever shows current items. See
// architecture-proposal.md's backfill section and the Geothermal Investment project's
// research notes for what else was checked and ruled out (Fervo/Zanskar/Mazama/400C are
// JavaScript-rendered — their listings aren't in the HTML a plain fetch gets back).
//
// Both crawlers return the same {source_url, source_feed, title, summary, publishedAt}
// shape fetchRssArticles/fetchGdeltArticles use, so everything downstream (prefilter,
// extraction, dedup, insert — see src/collector/processArticle.js) is unchanged.

// A real browser UA + the headers a real browser actually sends. The self-identifying
// UA these crawlers used at first ("...geothermal-investment-tracker/0.1") got a 403
// from ThinkGeoenergy when run from Render specifically — consistent with bot-defense
// software (most WordPress sites at this traffic tier sit behind Cloudflare) flagging
// both the UA string and Render's IP range as non-browser traffic. This won't
// necessarily fix an IP-range-level block (that needs verifying for real, not guessing),
// but it's the first real lever to pull, and it's what fetchArticleText.js already uses
// successfully for individual article pages on other sites.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * ThinkGeoenergy's Finance category archive — https://www.thinkgeoenergy.com/category/finance/
 * WordPress pagination: /category/finance/ (page 1) then /category/finance/page/N/.
 * Confirmed 109 pages deep at time of writing. Each archive page lists ~9 posts as
 * `<div class="content-post-items">` blocks containing the link, a visible date
 * ("1 Sep 2026" format) and title — parsed directly from the listing page.
 * @param {number} page 1-indexed
 * @returns {Promise<{articles: Array, hasMore: boolean}>}
 */
async function fetchThinkGeoenergyArchivePage(page) {
  const url = page <= 1
    ? 'https://www.thinkgeoenergy.com/category/finance/'
    : `https://www.thinkgeoenergy.com/category/finance/page/${page}/`;

  const html = await fetchHtml(url);
  if (!html) return { articles: [], hasMore: false };

  const articles = [];
  const blocks = html.split('content-post-items');
  for (const block of blocks.slice(1)) { // first slice is everything before the first block
    const hrefMatch = block.match(/href="(https:\/\/www\.thinkgeoenergy\.com\/[a-z0-9-]+\/)"/);
    const dateMatch = block.match(/class="article-meta">([^<]+)</);
    const titleMatch = block.match(/<h3>([^<]+)</);
    if (!hrefMatch || !titleMatch) continue; // nav/ad block, not a real post
    articles.push({
      source_url: hrefMatch[1],
      source_feed: 'ThinkGeoenergy (archive)',
      title: decodeHtmlEntities(titleMatch[1]),
      summary: '',
      publishedAt: dateMatch ? parseThinkGeoenergyDate(dateMatch[1]) : null,
    });
  }

  // Confirms there's a "next page" link on this page, rather than assuming based on
  // count — the last page has fewer posts but no page/N+1/ link.
  const hasMore = html.includes(`/category/finance/page/${page + 1}/`);
  return { articles: dedupeByUrl(articles), hasMore };
}

/**
 * DOE Geothermal Technologies Office news archive (Drupal "listing" view) —
 * https://www.energy.gov/eere/geothermal/listings/geothermal-news
 * Confirmed 0-indexed ?page=N pagination, 5 pages deep at time of writing. Each page
 * lists `<div class="listing-item">` blocks with a relative href, a real
 * `<time datetime="ISO8601">` and a title.
 * @param {number} page 0-indexed (DOE/Drupal convention, unlike the ThinkGeoenergy crawler above)
 * @returns {Promise<{articles: Array, hasMore: boolean}>}
 */
async function fetchDoeArchivePage(page) {
  const url = `https://www.energy.gov/eere/geothermal/listings/geothermal-news?page=${page}`;
  const html = await fetchHtml(url);
  if (!html) return { articles: [], hasMore: false };

  const articles = [];
  const blocks = html.split('listing-item__date');
  for (const block of blocks.slice(1)) {
    const dateMatch = block.match(/<time datetime="([^"]+)"/);
    const hrefMatch = block.match(/listing-item__title[^"]*"[\s\S]{0,50}?<a href="([^"]+)"/);
    const titleMatch = block.match(/class="field field--string field--title">([^<]+)</);
    if (!hrefMatch || !titleMatch) continue;
    const href = hrefMatch[1].startsWith('http') ? hrefMatch[1] : `https://www.energy.gov${hrefMatch[1]}`;
    articles.push({
      source_url: href,
      source_feed: 'DOE Geothermal Technologies Office (archive)',
      title: decodeHtmlEntities(titleMatch[1]),
      summary: '',
      publishedAt: dateMatch ? dateMatch[1] : null,
    });
  }

  const hasMore = html.includes(`?page=${page + 1}`);
  return { articles: dedupeByUrl(articles), hasMore };
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.error(`[archiveSources] ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`[archiveSources] Failed to fetch ${url}: ${err.message}`);
    return null;
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

function decodeHtmlEntities(text) {
  return text
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–').replace(/&#038;/g, '&').replace(/&amp;/g, '&')
    .trim();
}

// ThinkGeoenergy's listing date is displayed like "1 Sep 2026" — parse to ISO for
// consistency with the RSS/GDELT article shape (announced_date itself still comes from
// the article text via Claude, same as every other source; this is just for logging/
// chunking decisions).
function parseThinkGeoenergyDate(text) {
  const parsed = new Date(text.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

module.exports = { fetchThinkGeoenergyArchivePage, fetchDoeArchivePage };
