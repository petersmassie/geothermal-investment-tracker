/**
 * Build a dedup key for a deal so re-reported coverage of the same underlying event
 * (different outlet, same funding round) collapses to one row instead of duplicating.
 * Keyed on normalized recipient + rounded amount + announced date — deliberately loose
 * on amount (nearest $10k) since different outlets sometimes round differently.
 * Deals with no recipient or no date can't be meaningfully deduped this way and get a
 * null key (unique per row, always inserted) — those are exactly the low-confidence /
 * review-queue cases anyway.
 */
function buildDedupKey({ recipient, deal_type, amount_usd, announced_date }) {
  if (!recipient || !announced_date) return null;
  const normalizedRecipient = recipient.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
  const roundedAmount = amount_usd ? Math.round(amount_usd / 10000) * 10000 : 'na';
  return `${normalizedRecipient}|${deal_type || 'na'}|${roundedAmount}|${announced_date}`;
}

// Thresholds for the fuzzy second-pass check (findSimilarDeal). buildDedupKey above is
// the cheap first pass — exact match on normalized recipient + deal type + rounded
// amount + date. It only catches near-identical extractions. In practice, dozens of
// outlets covering one real deal rarely produce identical text: "Quaise" vs. "Quaise
// Energy" normalize to different strings, one outlet's "announced" date is another's
// "closed" date a week later, and amounts get rounded differently or omitted entirely.
// findSimilarDeal is the safety net for those cases — pg_trgm fuzzy name matching plus
// a date window plus an amount tolerance, rather than requiring an exact string match.
const CONFIRMED_MATCH_SIMILARITY = 0.6; // above this + amount/date agree closely -> treat as certain duplicate, merge silently
const CANDIDATE_MATCH_SIMILARITY = 0.3; // above this but below confirmed -> insert, but flag for human review
const DATE_WINDOW_DAYS = 14;
const AMOUNT_TOLERANCE_FRACTION = 0.15; // ±15%

/**
 * Look for an existing deal that's probably the same underlying event as the one about
 * to be inserted, using fuzzy recipient-name matching (trigram similarity) instead of
 * requiring an exact match. Returns:
 *   { match: null }                                   — no plausible existing deal found
 *   { match: 'confirmed', dealId }                     — high similarity + amount/date agree; treat as certain duplicate
 *   { match: 'candidate', dealId, similarity }          — plausible but not certain; needs a human to confirm
 */
async function findSimilarDeal(pool, { recipient, announced_date, amount_usd }) {
  if (!recipient) return { match: null };

  const { rows } = await pool.query(
    `SELECT id, recipient, amount_usd, announced_date, similarity(lower(recipient), lower($1)) AS sim
     FROM deals
     WHERE similarity(lower(recipient), lower($1)) > $2
       AND (
         $3::date IS NULL OR announced_date IS NULL
         OR announced_date BETWEEN $3::date - ($4 || ' days')::interval AND $3::date + ($4 || ' days')::interval
       )
     ORDER BY sim DESC
     LIMIT 1`,
    [recipient, CANDIDATE_MATCH_SIMILARITY, announced_date || null, DATE_WINDOW_DAYS]
  );

  if (rows.length === 0) return { match: null };

  const candidate = rows[0];
  const amountAgrees = amountsAgree(amount_usd, candidate.amount_usd);

  if (candidate.sim >= CONFIRMED_MATCH_SIMILARITY && amountAgrees !== false) {
    // amountAgrees === true (close) or === null (one/both undisclosed, can't contradict)
    return { match: 'confirmed', dealId: candidate.id };
  }
  return { match: 'candidate', dealId: candidate.id, similarity: candidate.sim };
}

// true = amounts are close enough to agree, false = they meaningfully disagree (rules
// out a "confirmed" match even at high name similarity — could be two different deals
// with the same recipient), null = can't compare (one or both undisclosed).
function amountsAgree(a, b) {
  if (a == null || b == null) return null;
  const larger = Math.max(a, b);
  if (larger === 0) return true;
  return Math.abs(a - b) / larger <= AMOUNT_TOLERANCE_FRACTION;
}

module.exports = { buildDedupKey, findSimilarDeal };
