/**
 * Best-effort full-text fetch for an article URL, used when the RSS/GDELT summary is
 * too thin to extract from reliably. Deliberately simple (fetch + strip tags) rather
 * than a full readability library — good enough for the mostly-static industry-press
 * pages this pipeline targets, but will come back empty/garbled on paywalled or
 * JS-rendered pages. That's fine: the extractor is instructed to return is_relevant:
 * false / low confidence rather than guess when it doesn't have enough text to work with.
 */
async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; geothermal-investment-tracker/0.1)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    return stripToText(html).slice(0, 8000); // cap to keep extraction calls cheap
  } catch (err) {
    console.error(`[fetchArticleText] Failed for ${url}: ${err.message}`);
    return '';
  }
}

function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { fetchArticleText };
