const { PREFILTER_KEYWORDS } = require('./sources');

/**
 * Cheap pre-LLM filter: does the title+summary contain any funding-adjacent keyword?
 * Every article that reaches this point already mentions "geothermal" implicitly
 * (RSS feeds are geothermal-specific; the GDELT query is scoped to "geothermal AND ...").
 * This just decides whether it's worth spending an extraction call on it.
 */
function passesPrefilter(article) {
  const haystack = `${article.title} ${article.summary}`.toLowerCase();
  return PREFILTER_KEYWORDS.some((kw) => haystack.includes(kw));
}

module.exports = { passesPrefilter };
