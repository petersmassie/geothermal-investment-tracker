// Curated feed list (see architecture-proposal.md §1). Revisit this list periodically —
// it's the highest-leverage lever for coverage, more so than model/prompt tuning.
// Add/remove feeds here; nothing else in the collector needs to change.

const RSS_FEEDS = [
  { name: 'ThinkGeoenergy', url: 'https://www.thinkgeoenergy.com/feed/' },
  { name: 'Geothermal Rising', url: 'https://www.geothermal.org/our-impact/blog/feed' },
  { name: 'Eavor', url: 'https://eavor.com/feed/' },
  { name: 'Dandelion Energy', url: 'https://dandelionenergy.com/feed' },
  // Verified working 2026-09-02 (curl'd directly, confirmed 10 real items) — the
  // proposal-time placeholder URL was wrong; this is the real feed URL.
  { name: 'DOE Geothermal Technologies Office', url: 'https://www.energy.gov/rss/hgeo-geothermal/900546' },
  // Company/association feeds without a confirmed working RSS URL as of 2026-09-02 —
  // verify before uncommenting:
  // { name: 'Fervo Energy', url: 'https://fervoenergy.com/feed/' },
  // { name: 'Sage Geosystems', url: 'https://sagegeosystems.com/feed/' },
  // { name: 'GreenFire Energy', url: 'https://greenfireenergy.com/feed/' },
];

// Named companies/funds worth searching for explicitly in the historical GDELT sweep
// (src/backfill/gdeltHistorical.js) — surfaced during backfill source research
// (2026-09-02) as companies without a crawlable news archive of their own. Combined
// with "geothermal" in the query (not used bare) to avoid false positives from generic
// words like "Canopus" or "Critical Energy" matching unrelated results.
const NAMED_COMPANY_TERMS = [
  'Fervo', 'Zanskar', 'Hephae', 'Mazama Energy', '"400C Energy"', 'Quaise',
  '"Underground Ventures"', 'Borobotics', '"GA Drilling"', 'TerraFerno', '"Critical Energy" geothermal',
];

// GDELT DOC 2.0 catch-all query — see architecture-proposal.md for coverage/rate-limit
// notes. Queried once per run in addition to the RSS feeds above.
const GDELT_QUERY = {
  baseUrl: 'https://api.gdeltproject.org/api/v2/doc/doc',
  query: '(geothermal) AND (funding OR investment OR grant OR "financing" OR raises OR acquires OR acquisition)',
  params: {
    mode: 'ArtList',
    format: 'json',
    maxrecords: '75',
    sort: 'DateDesc',
    timespan: '2d', // daily run — look back slightly further than 24h to cover any run slippage
  },
};

// Cheap keyword prefilter applied to every fetched article's title+summary before any
// LLM call is spent on it. Deliberately broad (recall over precision) — false positives
// cost one cheap extraction call; false negatives silently lose a real deal.
const PREFILTER_KEYWORDS = [
  'invest', 'investment', 'funding', 'funds', 'raise', 'raised', 'raises',
  'grant', 'financing', 'finance', 'loan', 'debt', 'equity', 'acqui', 'merger',
  'stake', 'venture', 'capital', 'series a', 'series b', 'series c', 'ipo',
  'joint venture', 'backed', 'million', 'billion', 'award', 'subsidy', 'incentive',
];

module.exports = { RSS_FEEDS, GDELT_QUERY, PREFILTER_KEYWORDS, NAMED_COMPANY_TERMS };
