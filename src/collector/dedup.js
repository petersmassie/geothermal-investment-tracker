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

module.exports = { buildDedupKey };
