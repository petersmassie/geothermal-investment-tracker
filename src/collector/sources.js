// Curated feed list (see architecture-proposal.md §1). Revisit this list periodically —
// it's the highest-leverage lever for coverage, more so than model/prompt tuning.
// Add/remove feeds here; nothing else in the collector needs to change.

const RSS_FEEDS = [
  { name: 'ThinkGeoenergy', url: 'https://www.thinkgeoenergy.com/feed/' },
  { name: 'Geothermal Rising', url: 'https://www.geothermal.org/our-impact/blog/feed' },
  { name: 'Eavor', url: 'https://eavor.com/feed/' },
  { name: 'Dandelion Energy', url: 'https://dandelionenergy.com/feed' },
  // Company/association/government feeds without a confirmed working RSS URL at
  // proposal time — verify and uncomment/add before the first production run:
  // { name: 'Fervo Energy', url: 'https://fervoenergy.com/feed/' },
  // { name: 'Sage Geosystems', url: 'https://sagegeosystems.com/feed/' },
  // { name: 'GreenFire Energy', url: 'https://greenfireenergy.com/feed/' },
  // { name: 'DOE Geothermal Technologies Office', url: 'https://www.energy.gov/eere/geothermal/listings/geothermal-news?feed=rss' },
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

module.exports = { RSS_FEEDS, GDELT_QUERY, PREFILTER_KEYWORDS };
