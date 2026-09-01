const express = require('express');
const { pool } = require('../db');
const taxonomy = require('../../shared/taxonomy');
const { toUsd } = require('../../collector/currency');
const { buildDedupKey } = require('../../collector/dedup');

const router = express.Router();

// Deal-level capital source is derived from its investor rows rather than stored
// directly (see architecture-proposal.md — multi-investor schema), so a mixed round
// isn't forced into one bucket.
function deriveSourceMix(sources) {
  const unique = [...new Set(sources)];
  if (unique.length === 0) return 'unclear';
  if (unique.length === 1) return unique[0];
  if (unique.every((s) => s === 'public' || s === 'private')) return 'mixed';
  return 'unclear';
}

// Aggregate charts exclude acquisitions by default — acquisition consideration isn't
// new capital into the company and can be entirely non-cash. See architecture-proposal.md.
const NON_ACQUISITION_TYPES = "deal_type != 'acquisition'";
const PUBLISHED = "review_status IN ('auto_published', 'approved')";

router.get('/summary', async (req, res, next) => {
  try {
    const [totals, byConfidence, pendingCount, acquisitionTotal] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS deal_count, COALESCE(SUM(amount_usd), 0) AS total_usd
                  FROM deals WHERE ${PUBLISHED} AND ${NON_ACQUISITION_TYPES}`),
      pool.query(`SELECT confidence, COUNT(*) AS count FROM deals WHERE ${PUBLISHED} GROUP BY confidence`),
      pool.query(`SELECT COUNT(*) AS count FROM deals WHERE review_status = 'pending_review'`),
      pool.query(`SELECT COUNT(*) AS deal_count, COALESCE(SUM(amount_usd), 0) AS total_usd
                  FROM deals WHERE ${PUBLISHED} AND deal_type = 'acquisition'`),
    ]);
    res.json({
      deal_count: Number(totals.rows[0].deal_count),
      total_investment_usd: Number(totals.rows[0].total_usd),
      by_confidence: Object.fromEntries(byConfidence.rows.map((r) => [r.confidence, Number(r.count)])),
      pending_review_count: Number(pendingCount.rows[0].count),
      acquisitions: {
        deal_count: Number(acquisitionTotal.rows[0].deal_count),
        total_consideration_usd: Number(acquisitionTotal.rows[0].total_usd),
      },
    });
  } catch (err) { next(err); }
});

router.get('/trends/by-quarter', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT date_trunc('quarter', announced_date)::date AS quarter,
             deal_type = 'acquisition' AS is_acquisition,
             COALESCE(SUM(amount_usd), 0) AS total_usd,
             COUNT(*) AS deal_count
      FROM deals
      WHERE ${PUBLISHED} AND announced_date IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1
    `);
    res.json(rows.map((r) => ({
      quarter: r.quarter,
      is_acquisition: r.is_acquisition,
      total_usd: Number(r.total_usd),
      deal_count: Number(r.deal_count),
    })));
  } catch (err) { next(err); }
});

router.get('/trends/by-tech', async (req, res, next) => {
  try {
    // resource_development deals break down by their specific technology
    // (tech_type_qualifier: egs, ags, etc. — the informative view); enabling-technology
    // deals (drilling, equipment, other) show as their own category-level bucket instead,
    // since a specific-technology breakdown doesn't apply the same way to those.
    const { rows } = await pool.query(`
      SELECT
        CASE WHEN tech_category = 'resource_development' THEN COALESCE(tech_type_qualifier, 'unspecified') ELSE tech_category END AS tech_key,
        tech_category,
        COALESCE(SUM(amount_usd), 0) AS total_usd,
        COUNT(*) AS deal_count
      FROM deals WHERE ${PUBLISHED} AND ${NON_ACQUISITION_TYPES}
      GROUP BY 1, 2 ORDER BY total_usd DESC
    `);
    res.json(rows.map((r) => ({
      tech_key: r.tech_key, tech_category: r.tech_category,
      total_usd: Number(r.total_usd), deal_count: Number(r.deal_count),
    })));
  } catch (err) { next(err); }
});

router.get('/trends/by-geography', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT COALESCE(geography_country, 'Unknown') AS country, COALESCE(SUM(amount_usd), 0) AS total_usd, COUNT(*) AS deal_count
      FROM deals WHERE ${PUBLISHED} AND ${NON_ACQUISITION_TYPES}
      GROUP BY 1 ORDER BY total_usd DESC LIMIT 20
    `);
    res.json(rows.map((r) => ({ country: r.country, total_usd: Number(r.total_usd), deal_count: Number(r.deal_count) })));
  } catch (err) { next(err); }
});

router.get('/deals', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const status = req.query.status === 'pending_review' ? 'pending_review' : null;

    // Note the "d." prefix here (unlike PUBLISHED's use in the queries above, which
    // query `deals` unqualified) — needed because this query joins `deals` to itself
    // to pull in the possible-duplicate match, so column names need disambiguating.
    const whereClause = status ? "d.review_status = 'pending_review'" : "d.review_status IN ('auto_published', 'approved')";

    // Left join to the deal this one was flagged as a possible duplicate of (if any),
    // so the review queue can show the reviewer what it's suspected of matching rather
    // than just an opaque id.
    const { rows: deals } = await pool.query(`
      SELECT d.*,
        dup.recipient AS duplicate_of_recipient,
        dup.amount_usd AS duplicate_of_amount_usd,
        dup.announced_date AS duplicate_of_announced_date
      FROM deals d
      LEFT JOIN deals dup ON dup.id = d.possible_duplicate_of_id
      WHERE ${whereClause}
      ORDER BY d.announced_date DESC NULLS LAST, d.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const dealIds = deals.map((d) => d.id);
    let investorsByDeal = {};
    if (dealIds.length > 0) {
      const { rows: investors } = await pool.query(
        `SELECT * FROM deal_investors WHERE deal_id = ANY($1::int[])`, [dealIds]
      );
      investorsByDeal = investors.reduce((acc, inv) => {
        (acc[inv.deal_id] ||= []).push(inv);
        return acc;
      }, {});
    }

    res.json(deals.map((d) => {
      const investors = investorsByDeal[d.id] || [];
      return { ...d, investors, source_mix: deriveSourceMix(investors.map((i) => i.capital_source)) };
    }));
  } catch (err) { next(err); }
});

router.get('/taxonomy', (req, res) => {
  res.json(taxonomy);
});

// Editable fields for a pending-review deal, before you approve/reject it. Deliberately
// deal-level only for now (not the investors array) — see architecture-proposal.md
// follow-up note. Restricted to pending_review deals: an already-published deal isn't
// editable through this endpoint, so a correction there means reject + wait for the
// next scan, or a direct DB fix, until this gets extended.
const EDITABLE_FIELDS = [
  'recipient', 'deal_type', 'deal_type_qualifier', 'amount', 'currency',
  'announced_date', 'tech_category', 'tech_type_qualifier', 'geography_country', 'geography_region',
];

router.put('/deals/:id', async (req, res, next) => {
  try {
    const current = await pool.query('SELECT * FROM deals WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Deal not found' });
    if (current.rows[0].review_status !== 'pending_review') {
      return res.status(400).json({ error: 'Only pending-review deals can be edited' });
    }

    const updates = { ...current.rows[0], ...pickEditable(req.body) };
    // pg returns DATE columns as JS Date objects, not the 'YYYY-MM-DD' strings the
    // collector writes — normalize here so an edit that doesn't touch announced_date
    // (falling back to the DB's Date object) still produces a dedup key in the same
    // format as every key the collector itself generates.
    if (updates.announced_date instanceof Date) {
      updates.announced_date = updates.announced_date.toISOString().slice(0, 10);
    }

    if (updates.deal_type && !taxonomy.DEAL_TYPE.includes(updates.deal_type)) {
      return res.status(400).json({ error: `Invalid deal_type: ${updates.deal_type}` });
    }
    if (updates.tech_category && !taxonomy.TECH_CATEGORY.includes(updates.tech_category)) {
      return res.status(400).json({ error: `Invalid tech_category: ${updates.tech_category}` });
    }

    const amount_usd = toUsd(updates.amount, updates.currency);
    const dedup_key = buildDedupKey({
      recipient: updates.recipient, deal_type: updates.deal_type,
      amount_usd, announced_date: updates.announced_date,
    });

    const { rows } = await pool.query(
      `UPDATE deals SET recipient=$1, deal_type=$2, deal_type_qualifier=$3, amount=$4, currency=$5,
         amount_usd=$6, announced_date=$7, tech_category=$8, tech_type_qualifier=$9,
         geography_country=$10, geography_region=$11, dedup_key=$12, updated_at=now()
       WHERE id=$13 AND review_status = 'pending_review' RETURNING *`,
      [
        updates.recipient, updates.deal_type, updates.deal_type_qualifier, updates.amount, updates.currency,
        amount_usd, updates.announced_date, updates.tech_category, updates.tech_type_qualifier,
        updates.geography_country, updates.geography_region, dedup_key, req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

function pickEditable(body) {
  const out = {};
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) out[field] = body[field] || null;
  }
  return out;
}

router.post('/deals/:id/review', async (req, res, next) => {
  try {
    const { decision } = req.body; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
    }
    const { rows } = await pool.query(
      `UPDATE deals SET review_status = $1, updated_at = now() WHERE id = $2 AND review_status = 'pending_review' RETURNING id`,
      [decision, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Deal not found or not pending review' });
    res.json({ id: rows[0].id, review_status: decision });
  } catch (err) { next(err); }
});

router.get('/status', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM collector_runs ORDER BY started_at DESC LIMIT 14`);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
