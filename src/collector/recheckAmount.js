// One-off re-extraction of just the amount/currency for an ALREADY-STORED deal, used by
// db/recheck_amounts.js to repair rows written before the shorthand-parsing fix in
// extract.js (see that file's rule 4 — "$1M" etc. being returned as bare digits like 1
// instead of 1000000). Deliberately does NOT re-run full extraction: re-deriving
// recipient/deal_type/tech_category/etc. risks quietly overwriting a reviewer's manual
// correction on those fields. Only amount and currency are in scope here.
//
// Uses the deal's stored title + excerpt rather than re-fetching the article — those are
// the same two things the original extraction had to work with for these backfilled
// articles (fetchArticleText.js's fetch of the live page is a best-effort call that can
// come back empty, e.g. on a site whose bot-defense blocks Render's IP range — see
// archiveSources.js's comments on thinkgeoenergy.com), so this doesn't require any new
// network access, doesn't hit the same WAF issue, and — per rule 7 in extract.js's
// SYSTEM_PROMPT — the excerpt is required to be a real quote supporting the amount, so
// it should carry the number even when the fuller article text wasn't available.

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are correcting the amount field of an already-extracted geothermal investment deal. A prior extraction pass had a bug: it sometimes returned the bare shorthand digits from the source text (e.g. 1 instead of 1000000 for "$1M", or 700 instead of 700000 for "£700k") instead of expanding the K/M/B/thousand/million/billion suffix into the true full number. Your only job is to re-derive the correct full numeric amount and its currency from the title and excerpt given below.

Rules:
1. amount must be the FULL numeric value. Expand every K/M/B/thousand/million/billion
   suffix or word, whether attached to a currency symbol, a currency code, or bare:
     "$1M" / "$1 M" / "$1m" / "1 million" -> amount: 1000000
     "€30m" / "EUR 30 million"            -> amount: 30000000
     "$1.8bn" / "$1.8 billion"            -> amount: 1800000000
     "£700k" / "700 thousand"             -> amount: 700000
     "NZD 1 billion"                      -> amount: 1000000000
   Never return the bare shorthand digits as amount.
2. currency is the ISO 4217 code (USD, CAD, EUR, GBP, NZD, ...). Infer it from a currency
   symbol or code in the text; if genuinely ambiguous, keep the currency that was already
   stored (given below) rather than guessing a different one.
3. If the title/excerpt don't actually state a numeric amount at all (vague language like
   "a significant investment," or the number simply isn't present in this text), return
   the currently stored amount/currency unchanged rather than inventing or nulling it —
   you only have a short excerpt here, not the full article, so absence of the number in
   this text is not strong evidence it was never disclosed.
4. Set corrected to true only if you are changing the amount and/or currency from what was
   stored; false if you're leaving it as-is.`;

const recheckSchema = {
  name: 'recheck_amount',
  description: 'Re-derive the correct full numeric amount and currency for a previously-extracted deal.',
  input_schema: {
    type: 'object',
    properties: {
      amount: { type: ['number', 'null'], description: 'The full numeric deal amount, or null if genuinely undisclosed.' },
      currency: { type: ['string', 'null'], description: 'ISO 4217 currency code, or null if amount is null.' },
      corrected: { type: 'boolean', description: 'True if this differs from the originally stored amount/currency.' },
    },
    required: ['amount', 'currency', 'corrected'],
    additionalProperties: false,
  },
};

async function recheckAmount({ title, excerpt, currentAmount, currentCurrency }) {
  const userText = [
    `Title: ${title || '(no title stored)'}`,
    `Excerpt: ${excerpt || '(no excerpt stored)'}`,
    `Currently stored amount: ${currentAmount == null ? 'null' : currentAmount}`,
    `Currently stored currency: ${currentCurrency || 'null'}`,
  ].join('\n');

  const response = await anthropic.messages.create({
    model: process.env.EXTRACTION_MODEL || 'claude-haiku-4-5',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
    tools: [{ name: recheckSchema.name, description: recheckSchema.description, input_schema: recheckSchema.input_schema }],
    tool_choice: { type: 'tool', name: recheckSchema.name },
  });
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('No tool_use block in recheck_amount response');
  return toolUse.input;
}

module.exports = { recheckAmount };
