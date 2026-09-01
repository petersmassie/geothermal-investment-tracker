const express = require('express');
const { pool } = require('../db');

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
    const { rows } = await pool.query(`
      SELECT tech_type, COALESCE(SUM(amount_usd), 0) AS total_usd, COUNT(*) AS deal_count
      FROM deals WHERE ${PUBLISHED} AND ${NON_ACQUISITION_TYPES}
      GROUP BY tech_type ORDER BY total_usd DESC
    `);
    res.json(rows.map((r) => ({ tech_type: r.tech_type, total_usd: Number(r.total_usd), deal_count: Number(r.deal_count) })));
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

    const whereClause = status ? "review_status = 'pending_review'" : PUBLISHED;

    const { rows: deals } = await pool.query(`
      SELECT * FROM deals WHERE ${whereClause}
      ORDER BY announced_date DESC NULLS LAST, created_at DESC
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
