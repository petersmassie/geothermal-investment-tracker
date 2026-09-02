// Single source of truth for the dataset's controlled vocabularies (taxonomy v3,
// agreed 2026-09-01 — see the Geothermal Investment project's architecture-proposal.md
// for the reasoning behind each list). Both the Claude extraction schema and the
// Postgres CHECK constraints are generated from this file so the two can't drift.

const CAPITAL_SOURCE = ['public', 'private', 'unclear'];

const CAPITAL_SOURCE_QUALIFIER = {
  public: [
    'government_grant_program',
    'government_owned_entity',
    'multilateral_dfi',
    'public_pension_or_sovereign_wealth_fund',
    'public_research_funding_body',
    'other_public',
  ],
  private: [
    'venture_capital',
    'private_equity',
    'corporate_strategic_investor',
    'bank_or_commercial_lender',
    'family_office_or_individual',
    'private_foundation',
    'other_private',
  ],
  unclear: [],
};

const DEAL_TYPE = ['equity', 'debt', 'project_financing', 'acquisition', 'jv', 'grant', 'other'];

const DEAL_TYPE_QUALIFIER = {
  equity: ['seed', 'series_a_b_c_plus', 'growth_equity', 'strategic_equity_stake', 'ipo_or_follow_on', 'other_equity'],
  debt: ['senior_debt', 'subordinated_or_mezzanine_debt', 'convertible_debt', 'green_bond', 'revolving_credit_facility', 'other_debt'],
  project_financing: ['non_recourse', 'limited_recourse', 'blended_finance', 'other_project_financing'],
  acquisition: ['full_acquisition', 'majority_stake', 'minority_stake', 'asset_acquisition', 'other_acquisition'],
  jv: ['new_jv_formation', 'additional_investment_in_existing_jv'],
  grant: ['rd_grant', 'demonstration_or_deployment_grant', 'feasibility_study_grant', 'workforce_or_capacity_building_grant', 'other_grant'],
  other: [], // free text only — this bucket exists precisely for what doesn't fit elsewhere
};

// Technology taxonomy v3 (simplified 2026-09-02 — v2's category+qualifier split
// (resource_development / drilling_or_subsurface_technology / equipment_or_components,
// each with its own qualifier list) was more granular than how the technology's own
// standard-setter tracks it: the IEA's geothermal investment reporting uses just
// "conventional" vs. "next-generation" (EGS/AGS/superhot rock aggregated together),
// and doesn't track drilling-technology vendors as a separate funding category at all.
// That extra granularity is also the likely cause of the free-text qualifier failures
// seen in production (more boxes, blurrier edges, more chances for the model to punt
// rather than pick one). Flattened to a single field, six values, no qualifier tier.
const TECH_CATEGORY = [
  'conventional', // classic hydrothermal power generation — naturally accessible resource, no stimulation
  'egs', // enhanced geothermal systems, includes open-loop
  'ags', // advanced geothermal systems, includes closed-loop
  'shr', // superhot rock — increasingly tracked as its own frontier distinct from EGS (IEA, CATF)
  'direct_use', // heat pump / district heating / other non-power-generation resource use
  'cross_cutting_or_other', // enabling technology (drilling, subsurface imaging, equipment/materials)
                            // that serves resource-development projects rather than being one itself
                            // (e.g. Quaise Energy's drilling tech), plus anything else that doesn't fit above
];

const CONFIDENCE = ['high', 'medium', 'low'];

const REVIEW_STATUS = ['auto_published', 'pending_review', 'approved', 'rejected'];

module.exports = {
  CAPITAL_SOURCE,
  CAPITAL_SOURCE_QUALIFIER,
  DEAL_TYPE,
  DEAL_TYPE_QUALIFIER,
  TECH_CATEGORY,
  CONFIDENCE,
  REVIEW_STATUS,
};
