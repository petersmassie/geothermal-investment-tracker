const Anthropic = require('@anthropic-ai/sdk');
const { extractionSchema } = require('../shared/extractionSchema');
const {
  DEAL_TYPE, CAPITAL_SOURCE, TECH_CATEGORY, DEAL_TYPE_QUALIFIER, CAPITAL_SOURCE_QUALIFIER,
} = require('../shared/taxonomy');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You extract structured geothermal energy investment/funding data from a single news article for a research dataset. Follow these rules exactly:

1. Only extract a deal if the article actually announces or substantively reports a specific
   geothermal investment, funding round, grant, financing, acquisition, or joint venture. If
   it's general geothermal news with no such deal, set is_relevant to false and leave the
   other fields null / empty as appropriate — do not force a classification onto an article
   that doesn't contain one.

2. JV vs. equity tie-breaker: classify deal_type as "jv" whenever the announcement frames the
   deal as forming a new joint venture entity, or as an additional investment into an existing
   joint venture — regardless of whether the underlying capital contribution is structured as
   equity or debt. Otherwise, classify by the underlying structure (equity, debt, project
   financing, acquisition, grant, or other).

3. Grants are not restricted to government sources — a private foundation or corporate grant
   is still deal_type "grant", with capital_source "private" on that investor.

4. Never invent a number. If an amount is described vaguely ("a significant investment", "an
   undisclosed sum"), leave amount and currency null rather than estimating.

5. investors is an array — one entry per distinct named investor/funding source. Most deals
   have exactly one. Only split amount_attributed per investor if the article itself states
   individual amounts; otherwise leave amount_attributed null on each entry and rely on the
   deal-level amount.

6. confidence_signals must reflect what the article actually states, not what you inferred —
   these drive an automated confidence score downstream, so err toward false/uncertain rather
   than true when in doubt.

7. excerpt must be a real, short, verbatim quote from the article text supporting the
   extraction — not a paraphrase.

8. tech_category — pick exactly one, by what the deal is actually for:
   - "conventional": classic hydrothermal power generation from a naturally accessible
     resource, no stimulation technique involved.
   - "egs": enhanced geothermal systems (includes open-loop).
   - "ags": advanced/closed-loop geothermal systems.
   - "shr": superhot rock — only when the article specifically frames it that way (not
     every deep/next-generation project is SHR; don't infer it from "next-generation"
     framing alone).
   - "direct_use": heat pump, district heating, or another non-power-generation use of
     the resource (e.g. residential ground-source heat pumps, a municipal heating
     network).
   - "cross_cutting_or_other": a company selling enabling technology or hardware that
     could serve any future resource-development project — drilling equipment,
     subsurface imaging/exploration, turbines, heat exchangers, high-temperature
     materials — rather than developing or operating a resource project itself. This is
     about what the RECIPIENT's business is, not what technology the article mentions in
     passing: Quaise Energy sells drilling technology, so a Quaise deal is
     "cross_cutting_or_other" even when the article discusses EGS or superhot rock as
     the eventual downstream application. Also use this value for anything that
     genuinely doesn't fit the other five.`;

/**
 * Roll up the model's confidence_signals into a high/medium/low label. Deliberately
 * rule-based rather than trusting a self-reported score (see architecture-proposal.md §2):
 * a deal only counts as "high" confidence when the concrete, checkable signals all line up.
 * hadInvalidField (see sanitizeExtraction below) always caps it at "low" — a model
 * that couldn't fit its own answer into the closed taxonomy is not a deal to auto-publish.
 */
function computeConfidence(result, hadInvalidField = false) {
  if (!result.is_relevant) return 'low';
  if (hadInvalidField) return 'low';
  const s = result.confidence_signals || {};
  const hasCore = Boolean(result.recipient) && result.deal_type && result.tech_category;
  if (!hasCore) return 'low';

  const strongSignals = [s.amount_stated, s.recipient_named_specifically, s.investor_named].filter(Boolean).length;

  if (strongSignals === 3 && s.source_is_primary) return 'high';
  if (strongSignals >= 2) return 'medium';
  return 'low';
}

/**
 * The Claude API treats a tool-use JSON schema's "enum" (and even "type") as guidance,
 * not a hard constraint — it does not reject a response that ignores it. In production
 * this has shown up twice, both against Postgres CHECK/NOT NULL constraints that only
 * fire at insert time (deals_tech_category_check, deals_deal_type_check,
 * deal_investors_capital_source_check): once as a qualifier field coming back as free
 * descriptive text instead of a closed-list code (fixed below via normalizeQualifier),
 * and once as tech_category/deal_type/capital_source themselves coming back outside
 * their allowed lists — an entire backfill batch failed on this second case, every
 * failure surfacing only as a raw "violates check constraint" error from the INSERT,
 * with nothing having validated the model's answer against the taxonomy first. Every
 * closed-vocabulary field the DB enforces with NOT NULL + CHECK must be re-validated
 * here, with a real fallback value, BEFORE it ever reaches db.insertDeal — a thrown
 * constraint violation is a worse outcome than a low-confidence guess, because
 * (per callModel's contract below) a thrown error looks identical to a genuine API
 * failure and blocks the URL from ever being marked seen, so it would just fail the
 * same way forever on every retry instead of landing in the review queue once.
 *
 * Each field's fallback is deliberately its own taxonomy's "doesn't fit elsewhere"
 * bucket (deal_type -> "other", capital_source -> "unclear", tech_category ->
 * "cross_cutting_or_other") rather than a made-up value, and always forces the deal to
 * low confidence / review — never auto-published on a guessed taxonomy field.
 */
function normalizeEnumField(value, allowed, fallback) {
  if (value && allowed.includes(value)) return { value, invalid: false };
  return { value: fallback, invalid: true };
}

function normalizeQualifier(parentValue, qualifierValue, qualifierMap) {
  if (!qualifierValue) return { value: null, invalid: false };
  const allowed = qualifierMap[parentValue];
  if (!allowed) return { value: null, invalid: true }; // parent value itself unrecognized
  if (allowed.length === 0) return { value: String(qualifierValue).slice(0, 120), invalid: false }; // free-text bucket
  if (allowed.includes(qualifierValue)) return { value: qualifierValue, invalid: false };
  return { value: null, invalid: true };
}

/**
 * Validates and repairs a raw extraction result in place so it can never violate a DB
 * constraint, regardless of what the model actually returned. Returns whether anything
 * had to be corrected, so the caller can force the deal to low confidence / review
 * rather than silently publishing something the taxonomy had to be guessed for.
 */
function sanitizeExtraction(result) {
  let invalidFound = false;

  const dealType = normalizeEnumField(result.deal_type, DEAL_TYPE, 'other');
  result.deal_type = dealType.value;
  invalidFound = invalidFound || dealType.invalid;

  const tech = normalizeEnumField(result.tech_category, TECH_CATEGORY, 'cross_cutting_or_other');
  result.tech_category = tech.value;
  invalidFound = invalidFound || tech.invalid;

  const deal = normalizeQualifier(result.deal_type, result.deal_type_qualifier, DEAL_TYPE_QUALIFIER);
  result.deal_type_qualifier = deal.value;
  invalidFound = invalidFound || deal.invalid;

  // investors is required to be an array by the schema, but that's exactly the kind of
  // constraint the model doesn't always honor (seen in production as a single object
  // instead of an array) — normalize its shape here rather than trusting it downstream.
  if (Array.isArray(result.investors)) {
    // ok as-is
  } else if (result.investors && typeof result.investors === 'object') {
    result.investors = [result.investors];
    invalidFound = true;
  } else {
    result.investors = [];
    invalidFound = true;
  }

  for (const inv of result.investors) {
    const cap = normalizeEnumField(inv.capital_source, CAPITAL_SOURCE, 'unclear');
    inv.capital_source = cap.value;
    invalidFound = invalidFound || cap.invalid;

    const qual = normalizeQualifier(inv.capital_source, inv.capital_source_qualifier, CAPITAL_SOURCE_QUALIFIER);
    inv.capital_source_qualifier = qual.value;
    invalidFound = invalidFound || qual.invalid;
  }

  return invalidFound;
}

/**
 * Run structured extraction on one article. Tries the cheap model first; if the result
 * comes back relevant but with weak confidence signals, re-runs once on the escalation
 * model (more capable models are less likely to mis-classify ambiguous phrasing) before
 * settling on a final answer. Returns null if the article is genuinely not relevant.
 *
 * Deliberately lets a call failure (network error, bad API key, rate limit, ...) THROW
 * rather than returning null — see callModel below for why this distinction matters.
 * The escalation call is the one exception: if the base call already succeeded and only
 * the escalation call fails, that's not worth losing a perfectly good base result over,
 * so that failure is caught and logged, falling back to the base result instead.
 */
async function extractDeal(article, articleText) {
  const userText = buildUserMessage(article, articleText);

  let result = await callModel(process.env.EXTRACTION_MODEL || 'claude-haiku-4-5', userText);
  if (result.is_relevant) {
    const signals = result.confidence_signals || {};
    const weakSignalCount = [signals.amount_stated, signals.recipient_named_specifically, signals.investor_named].filter((v) => v === false).length;
    if (weakSignalCount >= 2) {
      try {
        result = await callModel(process.env.ESCALATION_MODEL || 'claude-sonnet-4-5', userText);
      } catch (err) {
        console.error(`[extract] Escalation call failed, keeping base-model result: ${err.message}`);
      }
    }
  }

  if (!result.is_relevant) return null;

  // recipient is NOT NULL in the deals table and, unlike the taxonomy fields above,
  // has no sane fallback value to substitute — a deal with no named recipient isn't
  // usable data. Treat it the same as "not relevant" rather than letting the insert
  // fail on a constraint we could have caught here.
  if (!result.recipient || !String(result.recipient).trim()) return null;

  const hadInvalidField = sanitizeExtraction(result);

  return {
    ...result,
    confidence: computeConfidence(result, hadInvalidField),
  };
}

function buildUserMessage(article, articleText) {
  return [
    `Title: ${article.title}`,
    `Source: ${article.source_feed}`,
    `URL: ${article.source_url}`,
    article.publishedAt ? `Published: ${article.publishedAt}` : null,
    '',
    'Article text (may be truncated or, if fetch failed, only the RSS summary):',
    articleText || article.summary || '(no text available)',
  ].filter(Boolean).join('\n');
}

/**
 * Deliberately does NOT catch errors here — a failed API call (bad/missing key, network
 * error, rate limit, timeout) is a genuinely different situation from the model
 * successfully looking at an article and deciding it's not a deal, and conflating the
 * two was a real production bug: every article whose extraction call failed got
 * permanently recorded as "checked, not relevant" (see processArticle.js's use of
 * hasSeenUrl), which silently discarded them — a subsequent, correctly-configured run
 * would see them as already processed and skip them, even though they were never
 * actually looked at. Letting this throw means the caller's per-article try/catch (see
 * src/collector/index.js, src/backfill/index.js, src/backfill/processQueueFile.js) logs
 * it as an error WITHOUT recording the article as seen — so it's naturally retried on
 * the next run instead of being lost.
 */
async function callModel(model, userText) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
    tools: [{ ...toolFromSchema(extractionSchema) }],
    tool_choice: { type: 'tool', name: extractionSchema.name },
  });
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error(`No tool_use block in response from ${model}`);
  return toolUse.input;
}

function toolFromSchema(schema) {
  return { name: schema.name, description: schema.description, input_schema: schema.input_schema };
}

module.exports = { extractDeal, computeConfidence };
