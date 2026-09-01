const Anthropic = require('@anthropic-ai/sdk');
const { extractionSchema } = require('../shared/extractionSchema');
const { TECH_CATEGORY_QUALIFIER, DEAL_TYPE_QUALIFIER, CAPITAL_SOURCE_QUALIFIER } = require('../shared/taxonomy');

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

8. tech_category vs. tech_type_qualifier: tech_category is which part of the geothermal
   value chain the deal targets, not the specific technology. A company building or
   operating an actual geothermal power/heat project (EGS, conventional hydrothermal, AGS,
   direct-use, heat pump/district heating) is "resource_development" — the specific type
   goes in tech_type_qualifier. A company building drilling hardware, subsurface imaging,
   or exploration technology that could serve future resource-development projects but is
   not itself a resource project — e.g. Quaise Energy's millimeter-wave drilling — is
   "drilling_or_subsurface_technology", NOT resource_development, even if the article
   mentions EGS or superhot rock as the eventual application. A hardware/materials supplier
   (turbines, heat exchangers, high-temperature components) is "equipment_or_components".
   Only use "other_enabling_technology" when none of the above fit.`;

/**
 * Roll up the model's confidence_signals into a high/medium/low label. Deliberately
 * rule-based rather than trusting a self-reported score (see architecture-proposal.md §2):
 * a deal only counts as "high" confidence when the concrete, checkable signals all line up.
 * hadInvalidQualifier (see sanitizeQualifiers below) always caps it at "low" — a model
 * that couldn't fit its own answer into the closed taxonomy is not a deal to auto-publish.
 */
function computeConfidence(result, hadInvalidQualifier = false) {
  if (!result.is_relevant) return 'low';
  if (hadInvalidQualifier) return 'low';
  const s = result.confidence_signals || {};
  const hasCore = Boolean(result.recipient) && result.deal_type && result.tech_category;
  if (!hasCore) return 'low';

  const strongSignals = [s.amount_stated, s.recipient_named_specifically, s.investor_named].filter(Boolean).length;

  if (strongSignals === 3 && s.source_is_primary) return 'high';
  if (strongSignals >= 2) return 'medium';
  return 'low';
}

/**
 * The Claude API treats a tool-use JSON schema's "enum" list as guidance, not a hard
 * constraint — it does not reject a response that ignores it. In production this showed
 * up as tech_type_qualifier coming back as a full descriptive sentence (e.g. "Geothermal
 * boreholes with heat pumps for district heating...") instead of one of the closed-list
 * codes (e.g. "heat_pump_or_district_heating"), which then displayed raw in the dashboard.
 * Re-validate every qualifier here against the real taxonomy list for its parent value
 * rather than trusting the model. A parent value whose list is empty (deal_type "other",
 * tech_category "other_enabling_technology", capital_source "unclear") is a deliberate
 * free-text bucket — those pass through capped to a sane length, not rejected. Returns
 * whether anything had to be dropped, so the caller can force the deal to review instead
 * of silently publishing something whose own taxonomy fields didn't fit the taxonomy.
 */
function normalizeQualifier(parentValue, qualifierValue, qualifierMap) {
  if (!qualifierValue) return { value: null, invalid: false };
  const allowed = qualifierMap[parentValue];
  if (!allowed) return { value: null, invalid: true }; // parent value itself unrecognized
  if (allowed.length === 0) return { value: String(qualifierValue).slice(0, 120), invalid: false }; // free-text bucket
  if (allowed.includes(qualifierValue)) return { value: qualifierValue, invalid: false };
  return { value: null, invalid: true };
}

function sanitizeQualifiers(result) {
  let invalidFound = false;

  const tech = normalizeQualifier(result.tech_category, result.tech_type_qualifier, TECH_CATEGORY_QUALIFIER);
  result.tech_type_qualifier = tech.value;
  invalidFound = invalidFound || tech.invalid;

  const deal = normalizeQualifier(result.deal_type, result.deal_type_qualifier, DEAL_TYPE_QUALIFIER);
  result.deal_type_qualifier = deal.value;
  invalidFound = invalidFound || deal.invalid;

  for (const inv of result.investors || []) {
    const cap = normalizeQualifier(inv.capital_source, inv.capital_source_qualifier, CAPITAL_SOURCE_QUALIFIER);
    inv.capital_source_qualifier = cap.value;
    invalidFound = invalidFound || cap.invalid;
  }

  return invalidFound;
}

/**
 * Run structured extraction on one article. Tries the cheap model first; if the result
 * comes back relevant but with weak confidence signals, re-runs once on the escalation
 * model (more capable models are less likely to mis-classify ambiguous phrasing) before
 * settling on a final answer. Returns null if the article is not relevant.
 */
async function extractDeal(article, articleText) {
  const userText = buildUserMessage(article, articleText);

  let result = await callModel(process.env.EXTRACTION_MODEL || 'claude-haiku-4-5', userText);
  if (result && result.is_relevant) {
    const signals = result.confidence_signals || {};
    const weakSignalCount = [signals.amount_stated, signals.recipient_named_specifically, signals.investor_named].filter((v) => v === false).length;
    if (weakSignalCount >= 2) {
      const escalated = await callModel(process.env.ESCALATION_MODEL || 'claude-sonnet-4-5', userText);
      if (escalated) result = escalated;
    }
  }

  if (!result || !result.is_relevant) return null;

  const hadInvalidQualifier = sanitizeQualifiers(result);

  return {
    ...result,
    confidence: computeConfidence(result, hadInvalidQualifier),
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

async function callModel(model, userText) {
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
      tools: [{ ...toolFromSchema(extractionSchema) }],
      tool_choice: { type: 'tool', name: extractionSchema.name },
    });
    const toolUse = response.content.find((block) => block.type === 'tool_use');
    return toolUse ? toolUse.input : null;
  } catch (err) {
    console.error(`[extract] Model call failed (${model}): ${err.message}`);
    return null;
  }
}

function toolFromSchema(schema) {
  return { name: schema.name, description: schema.description, input_schema: schema.input_schema };
}

module.exports = { extractDeal, computeConfidence };
