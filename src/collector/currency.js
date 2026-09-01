// Approximate, static USD conversion for dashboard aggregation only — NOT for anything
// requiring accuracy. Rates are rough snapshots and will drift; the dedup key rounds to
// the nearest $10k specifically because of this imprecision. Every deal keeps its
// original amount/currency untouched (see deals.amount / deals.currency) — amount_usd
// is a derived convenience field only, and null means "not converted," not "zero."
//
// TODO before this matters for real trend analysis: swap this for a live FX rate API
// (e.g. exchangerate.host, free tier) called at extraction time, or a periodic rate
// refresh job. Flagging rather than building it now since it's not blocking a first
// working pipeline.
const APPROX_USD_RATES = {
  USD: 1,
  CAD: 0.73,
  EUR: 1.08,
  GBP: 1.27,
  ISK: 0.0073,
  KES: 0.0077,
  IDR: 0.000063,
  PHP: 0.018,
  AUD: 0.65,
  NZD: 0.60,
  JPY: 0.0067,
};

function toUsd(amount, currency) {
  if (amount == null || !currency) return null;
  const rate = APPROX_USD_RATES[currency.toUpperCase()];
  if (!rate) return null; // unsupported currency — leave null rather than guess
  return Math.round(amount * rate);
}

module.exports = { toUsd, APPROX_USD_RATES };
