// Shared per-article pipeline: prefilter -> fetch text -> Claude extraction -> dedup ->
// insert. Used by both the daily collector (src/collector/index.js, recent articles from
// RSS/GDELT) and the one-time historical backfill (src/backfill/index.js, older articles
// from GDELT date-range sweeps and direct archive crawls). Pulled out into its own module
// so both entry points run the exact same logic — same taxonomy validation, same dedup,
// same confidence scoring — rather than two copies that could drift apart.

const { passesPrefilter } = require('./prefilter');
const { fetchArticleText } = require('./fetchArticleText');
const { extractDeal } = require('./extract');
const { buildDedupKey } = require('./dedup');
const { toUsd } = require('./currency');
const db = require('./db');

const AUTO_PUBLISH_RANK = { high: 3, medium: 2, low: 1 };
const AUTO_PUBLISH_THRESHOLD = process.env.AUTO_PUBLISH_THRESHOLD || 'high';

/**
 * @param {{source_url: string, source_feed: string, title: string, summary: string, publishedAt: string|null}} article
 * @param {object} stats - mutated in place: articlesPrefilteredIn, extractionCalls, dealsCreated, dealsAutoPublished, dealsQueuedForReview
 */
async function processArticle(article, stats) {
  if (await db.hasSeenUrl(article.source_url)) return; // already processed in a prior run (daily or backfill)

  const passed = passesPrefilter(article);
  if (!passed) {
    await db.recordIngestedArticle({ ...article, passed_prefilter: false, is_relevant: null });
    return;
  }
  stats.articlesPrefilteredIn += 1;

  const articleText = await fetchArticleText(article.source_url);
  stats.extractionCalls += 1;
  const extracted = await extractDeal(article, articleText);

  if (!extracted) {
    await db.recordIngestedArticle({ ...article, passed_prefilter: true, is_relevant: false });
    return;
  }

  const amount_usd = toUsd(extracted.amount, extracted.currency);
  const dedup_key = buildDedupKey({
    recipient: extracted.recipient,
    deal_type: extracted.deal_type,
    amount_usd,
    announced_date: extracted.announced_date,
  });

  const meetsThreshold = AUTO_PUBLISH_RANK[extracted.confidence] >= AUTO_PUBLISH_RANK[AUTO_PUBLISH_THRESHOLD];
  const review_status = meetsThreshold ? 'auto_published' : 'pending_review';

  const deal = {
    recipient: extracted.recipient,
    deal_type: extracted.deal_type,
    deal_type_qualifier: extracted.deal_type_qualifier,
    amount: extracted.amount,
    currency: extracted.currency,
    amount_usd,
    announced_date: extracted.announced_date,
    tech_category: extracted.tech_category,
    geography_country: extracted.geography_country,
    geography_region: extracted.geography_region,
    source_url: article.source_url,
    source_name: article.source_feed,
    excerpt: extracted.excerpt,
    confidence: extracted.confidence,
    confidence_signals: extracted.confidence_signals,
    review_status,
    dedup_key,
    extraction_model: process.env.EXTRACTION_MODEL || 'claude-haiku-4-5',
  };

  const investors = (extracted.investors || []).map((inv) => ({
    investor_name: inv.investor_name,
    capital_source: inv.capital_source,
    capital_source_qualifier: inv.capital_source_qualifier,
    amount_attributed: inv.amount_attributed,
    is_lead_investor: inv.is_lead_investor,
  }));

  const inserted = await db.insertDeal(deal, investors);
  await db.recordIngestedArticle({ ...article, passed_prefilter: true, is_relevant: true, deal_id: inserted.id });

  if (inserted.isNew) {
    stats.dealsCreated += 1;
    // Use the actual status insertDeal settled on, not the pre-dedup-check local
    // variable above — a fuzzy "candidate" match forces review_status to
    // pending_review even when the extraction itself was high-confidence.
    if (inserted.reviewStatus === 'auto_published') stats.dealsAutoPublished += 1;
    else stats.dealsQueuedForReview += 1;
    if (inserted.possibleDuplicateOfId) {
      console.log(`[collector] Deal ${inserted.id} flagged as possible duplicate of deal ${inserted.possibleDuplicateOfId}.`);
    }
  }
}

module.exports = { processArticle };
