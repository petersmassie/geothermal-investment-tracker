const {
  CAPITAL_SOURCE,
  DEAL_TYPE,
  TECH_CATEGORY,
  CAPITAL_SOURCE_QUALIFIER,
  DEAL_TYPE_QUALIFIER,
} = require('./taxonomy');

// Flattened qualifier enums for the schema (Claude structured outputs don't support
// dynamic enum-per-parent-value, so the qualifier field is validated against the full
// union here and cross-checked against the deal_type/capital_source pairing in code —
// see collector/extract.js). tech_category has no qualifier tier as of taxonomy v3 —
// it's a single flat field, see taxonomy.js.
const ALL_CAPITAL_SOURCE_QUALIFIERS = [...new Set(Object.values(CAPITAL_SOURCE_QUALIFIER).flat())];
const ALL_DEAL_TYPE_QUALIFIERS = [...new Set(Object.values(DEAL_TYPE_QUALIFIER).flat())];

// One investor entry. A single-investor deal still produces an array of length 1.
const investorSchema = {
  type: 'object',
  properties: {
    investor_name: { type: 'string', description: 'Name of the investor/funding source as stated in the article.' },
    capital_source: { type: 'string', enum: CAPITAL_SOURCE },
    capital_source_qualifier: {
      type: ['string', 'null'],
      enum: [...ALL_CAPITAL_SOURCE_QUALIFIERS, null],
      description: 'Null when capital_source is "unclear" or the article gives no further detail.',
    },
    amount_attributed: {
      type: ['number', 'null'],
      description: "This investor's share of the total amount, only if the article breaks it out separately. Null otherwise (most cases).",
    },
    is_lead_investor: { type: 'boolean' },
  },
  required: ['investor_name', 'capital_source', 'capital_source_qualifier', 'amount_attributed', 'is_lead_investor'],
  additionalProperties: false,
};

// The full per-article extraction result. `is_relevant: false` short-circuits everything
// else — the prefilter is keyword-based and cheap, this is the model's own check on
// articles that passed the prefilter but turn out not to actually be a geothermal
// investment/funding announcement (e.g. a general geothermal news story with no deal).
const extractionSchema = {
  name: 'extract_geothermal_investment',
  description: 'Extract structured geothermal investment/funding details from a news article, or flag it as not a funding announcement.',
  input_schema: {
    type: 'object',
    properties: {
      is_relevant: {
        type: 'boolean',
        description: 'True only if this article announces or substantively reports a specific geothermal funding/investment/financing event (not general industry news, opinion, or a non-geothermal story that happened to match the keyword filter).',
      },
      recipient: { type: ['string', 'null'], description: 'Company, project, or organization receiving the funding.' },
      investors: {
        type: 'array',
        items: investorSchema,
        description: 'One entry per distinct investor/funding source. Array of length 1 for the common single-investor case.',
      },
      deal_type: { type: ['string', 'null'], enum: [...DEAL_TYPE, null] },
      deal_type_qualifier: { type: ['string', 'null'], enum: [...ALL_DEAL_TYPE_QUALIFIERS, null] },
      amount: { type: ['number', 'null'], description: 'Total deal amount if disclosed, in the original currency.' },
      currency: { type: ['string', 'null'], description: 'ISO 4217 currency code, e.g. USD, CAD, EUR. Null if amount is null.' },
      announced_date: { type: ['string', 'null'], description: 'ISO 8601 date (YYYY-MM-DD) of the announcement or the investment itself, whichever the article states.' },
      tech_category: {
        type: ['string', 'null'],
        enum: [...TECH_CATEGORY, null],
        description: 'The geothermal technology this deal targets: conventional (classic hydrothermal power, naturally accessible resource, no stimulation), egs (enhanced geothermal systems), ags (advanced/closed-loop geothermal systems), shr (superhot rock), direct_use (heat pump, district heating, or other non-power-generation resource use), or cross_cutting_or_other (enabling technology like drilling/subsurface imaging/equipment that serves resource-development projects rather than being one itself, e.g. Quaise Energy — plus anything else that does not fit the other values).',
      },
      geography_country: { type: ['string', 'null'] },
      geography_region: { type: ['string', 'null'], description: 'State/province/broader region if stated, e.g. "Nevada" or "Alberta".' },
      excerpt: { type: 'string', description: 'A short (1-3 sentence) direct excerpt from the article that supports the extracted facts, for traceability.' },
      confidence_signals: {
        type: 'object',
        description: 'Concrete, checkable signals used to compute confidence in code rather than trusting a single self-reported score.',
        properties: {
          amount_stated: { type: 'boolean', description: 'True if the amount was explicitly stated in the article, false if inferred/estimated/absent.' },
          recipient_named_specifically: { type: 'boolean', description: 'True if a specific company/project is named, false if the article describes a fund or program generally.' },
          investor_named: { type: 'boolean', description: 'True if at least one specific investor/funding source is named.' },
          source_is_primary: { type: 'boolean', description: 'True if this reads as the original announcement/press release, false if it is secondhand aggregation or a roundup mentioning the deal in passing.' },
        },
        required: ['amount_stated', 'recipient_named_specifically', 'investor_named', 'source_is_primary'],
        additionalProperties: false,
      },
    },
    required: [
      'is_relevant', 'recipient', 'investors', 'deal_type', 'deal_type_qualifier',
      'amount', 'currency', 'announced_date', 'tech_category',
      'geography_country', 'geography_region', 'excerpt', 'confidence_signals',
    ],
    additionalProperties: false,
  },
};

module.exports = { extractionSchema };
