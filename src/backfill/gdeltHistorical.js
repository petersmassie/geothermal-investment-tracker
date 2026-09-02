// GDELT DOC 2.0 historical sweep — same API and query shape as the daily collector's
// src/collector/fetchGdelt.js, but with a custom startdatetime/enddatetime range instead
// of the daily job's rolling `timespan: '2d'`. GDELT is the only configured source that
// can reach into the past at all (RSS feeds only ever show current items) — see
// architecture-proposal.md's backfill section.
//
// NOT YET VERIFIED LIVE as of 2026-09-02: a direct connectivity test from this build
// environment to api.gdeltproject.org timed out at the TLS handshake, consistent with
// the unresolved "GDELT fetch failed" issue flagged in the very first production run.
// Test this for real from the Render Shell (see db/test_gdelt_connectivity.js) before
// relying on it for the historical sweep — the code below is written and ready, but
// GDELT reachability itself is an open question, not something this module can fix.

const { GDELT_QUERY, NAMED_COMPANY_TERMS } = require('../collector/sources');

// Two query variants per month, both feeding the same downstream pipeline (URL-based
// dedup means running both costs nothing extra beyond the GDELT calls themselves):
//  1. The same broad "geothermal AND (funding terms)" query the daily job uses.
//  2. Named companies/funds (see sources.js) that turned up during source research as
//     not having a crawlable news archive of their own — combined with "geothermal" so
//     a generic name like "Canopus" or "Critical Energy" can't match unrelated results.
function buildNamedCompanyQuery() {
  return `(${NAMED_COMPANY_TERMS.join(' OR ')}) AND geothermal`;
}

/**
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate 'YYYY-MM-DD' (exclusive-ish — GDELT's own end-of-range handling)
 * @param {'broad'|'named_companies'} variant
 * @returns {Promise<Array<{source_url: string, source_feed: string, title: string, summary: string, publishedAt: string|null}>>}
 */
async function fetchGdeltHistorical(startDate, endDate, variant = 'broad') {
  const query = variant === 'named_companies' ? buildNamedCompanyQuery() : GDELT_QUERY.query;

  const url = new URL(GDELT_QUERY.baseUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', '250'); // GDELT's per-request cap — see backfill/index.js for the monthly chunking this requires
  url.searchParams.set('sort', 'DateDesc');
  url.searchParams.set('startdatetime', `${toGdeltDate(startDate)}000000`);
  url.searchParams.set('enddatetime', `${toGdeltDate(endDate)}000000`);

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'geothermal-investment-tracker/0.1' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.error(`[gdeltHistorical] GDELT returned HTTP ${res.status} for ${startDate}..${endDate} (${variant})`);
      return [];
    }
    const body = await res.json();
    const articles = body.articles || [];
    return articles
      .filter((a) => a.url)
      .map((a) => ({
        source_url: a.url,
        source_feed: `GDELT (backfill, ${variant})`,
        title: a.title || '',
        summary: '',
        publishedAt: a.seendate || null,
      }));
  } catch (err) {
    console.error(`[gdeltHistorical] Failed for ${startDate}..${endDate} (${variant}): ${err.message}`);
    return [];
  }
}

function toGdeltDate(isoDate) {
  return isoDate.replace(/-/g, '');
}

module.exports = { fetchGdeltHistorical };
