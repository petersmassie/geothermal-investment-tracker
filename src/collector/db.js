const { Pool, types } = require('pg');
const { findSimilarDeal } = require('./dedup');

// See src/web/db.js for why: pg returns NUMERIC as strings by default; parse once here
// rather than at every call site that might read amounts back.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function hasSeenUrl(sourceUrl) {
  const { rows } = await pool.query('SELECT 1 FROM ingested_articles WHERE source_url = $1', [sourceUrl]);
  return rows.length > 0;
}

async function recordIngestedArticle({ source_url, source_feed, title, passed_prefilter, is_relevant, deal_id }) {
  await pool.query(
    `INSERT INTO ingested_articles (source_url, source_feed, title, passed_prefilter, is_relevant, deal_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_url) DO NOTHING`,
    [source_url, source_feed, title, passed_prefilter, is_relevant, deal_id || null]
  );
}

/**
 * Insert a deal + its investors inside one transaction. Two dedup checks run first:
 *  1. Exact dedup_key match -> certain duplicate, no-op, return the existing deal's id.
 *  2. Fuzzy match (findSimilarDeal: trigram name similarity + date window + amount
 *     tolerance) -> either a "confirmed" match (treated the same as #1) or a
 *     "candidate" match, which still inserts the new row but forces it into review
 *     with possible_duplicate_of_id set, regardless of the confidence-based
 *     review_status the caller passed in — a probable duplicate should never
 *     auto-publish even if the extraction itself was high-confidence.
 */
async function insertDeal(deal, investors) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (deal.dedup_key) {
      const existing = await client.query('SELECT id FROM deals WHERE dedup_key = $1', [deal.dedup_key]);
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { id: existing.rows[0].id, isNew: false, dedupReason: 'exact_key' };
      }
    }

    const similar = await findSimilarDeal(client, {
      recipient: deal.recipient, announced_date: deal.announced_date, amount_usd: deal.amount_usd,
    });
    if (similar.match === 'confirmed') {
      await client.query('ROLLBACK');
      return { id: similar.dealId, isNew: false, dedupReason: 'fuzzy_confirmed' };
    }

    const possible_duplicate_of_id = similar.match === 'candidate' ? similar.dealId : null;
    const review_status = possible_duplicate_of_id ? 'pending_review' : deal.review_status;

    const insertRes = await client.query(
      `INSERT INTO deals (
        recipient, deal_type, deal_type_qualifier, amount, currency, amount_usd,
        announced_date, tech_category, tech_type_qualifier, geography_country, geography_region,
        source_url, source_name, excerpt, confidence, confidence_signals, review_status,
        dedup_key, possible_duplicate_of_id, extraction_model
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING id`,
      [
        deal.recipient, deal.deal_type, deal.deal_type_qualifier, deal.amount, deal.currency, deal.amount_usd,
        deal.announced_date, deal.tech_category, deal.tech_type_qualifier, deal.geography_country, deal.geography_region,
        deal.source_url, deal.source_name, deal.excerpt, deal.confidence, deal.confidence_signals, review_status,
        deal.dedup_key, possible_duplicate_of_id, deal.extraction_model,
      ]
    );
    const dealId = insertRes.rows[0].id;

    for (const inv of investors) {
      await client.query(
        `INSERT INTO deal_investors (deal_id, investor_name, capital_source, capital_source_qualifier, amount_attributed, is_lead_investor)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [dealId, inv.investor_name, inv.capital_source, inv.capital_source_qualifier, inv.amount_attributed, inv.is_lead_investor]
      );
    }

    await client.query('COMMIT');
    return { id: dealId, isNew: true, reviewStatus: review_status, possibleDuplicateOfId: possible_duplicate_of_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function startCollectorRun() {
  const { rows } = await pool.query(
    `INSERT INTO collector_runs (status) VALUES ('running') RETURNING id`
  );
  return rows[0].id;
}

async function finishCollectorRun(runId, stats, status = 'completed') {
  await pool.query(
    `UPDATE collector_runs SET finished_at = now(), articles_fetched = $2, articles_prefiltered_in = $3,
       extraction_calls = $4, deals_created = $5, deals_auto_published = $6, deals_queued_for_review = $7,
       errors = $8, status = $9
     WHERE id = $1`,
    [
      runId, stats.articlesFetched, stats.articlesPrefilteredIn, stats.extractionCalls,
      stats.dealsCreated, stats.dealsAutoPublished, stats.dealsQueuedForReview,
      JSON.stringify(stats.errors || []), status,
    ]
  );
}

module.exports = { pool, hasSeenUrl, recordIngestedArticle, insertDeal, startCollectorRun, finishCollectorRun };
