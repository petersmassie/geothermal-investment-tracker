const { Pool, types } = require('pg');

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
 * Insert a deal + its investors inside one transaction. If dedup_key collides with an
 * existing deal, this is a no-op (the earlier-seen coverage wins) and the existing
 * deal's id is returned instead so the caller can still link ingested_articles to it.
 */
async function insertDeal(deal, investors) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (deal.dedup_key) {
      const existing = await client.query('SELECT id FROM deals WHERE dedup_key = $1', [deal.dedup_key]);
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { id: existing.rows[0].id, isNew: false };
      }
    }

    const insertRes = await client.query(
      `INSERT INTO deals (
        recipient, deal_type, deal_type_qualifier, amount, currency, amount_usd,
        announced_date, tech_type, tech_type_qualifier, geography_country, geography_region,
        source_url, source_name, excerpt, confidence, confidence_signals, review_status,
        dedup_key, extraction_model
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING id`,
      [
        deal.recipient, deal.deal_type, deal.deal_type_qualifier, deal.amount, deal.currency, deal.amount_usd,
        deal.announced_date, deal.tech_type, deal.tech_type_qualifier, deal.geography_country, deal.geography_region,
        deal.source_url, deal.source_name, deal.excerpt, deal.confidence, deal.confidence_signals, deal.review_status,
        deal.dedup_key, deal.extraction_model,
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
    return { id: dealId, isNew: true };
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
