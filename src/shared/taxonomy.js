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

// Technology taxonomy v2 (revised 2026-09-01 — the original single-axis TECH_TYPE
// conflated "what kind of geothermal resource/system" with "what part of the value
// chain" a deal targets. A deal like Quaise Energy's (millimeter-wave drilling tech
// to reach superhot rock) isn't EGS/AGS/hydrothermal/etc. itself — it's an enabling
// technology that could serve any future resource-development project. Split into a
// category (which part of the value chain) and a qualifier (the specific technology
// within that category), same pattern as capital source and deal type.
const TECH_CATEGORY = [
  'resource_development', // the actual generation/heat system — what TECH_TYPE used to mean entirely
  'drilling_or_subsurface_technology', // e.g. Quaise's millimeter-wave drilling, subsurface imaging/exploration
  'equipment_or_components', // turbines, heat exchangers, high-temperature materials, etc.
  'other_enabling_technology',
];

const TECH_CATEGORY_QUALIFIER = {
  resource_development: [
    'egs', // enhanced geothermal systems, includes open-loop
    'conventional_hydrothermal',
    'ags', // advanced geothermal systems, includes closed-loop
    'direct_use',
    'heat_pump_or_district_heating',
    'unspecified',
  ],
  drilling_or_subsurface_technology: [
    'millimeter_wave_drilling',
    'plasma_or_other_advanced_drilling',
    'subsurface_imaging_or_exploration',
    'other_drilling_or_subsurface',
  ],
  equipment_or_components: [
    'turbines_or_generation_equipment',
    'heat_exchangers',
    'high_temperature_materials',
    'other_equipment',
  ],
  other_enabling_technology: [], // free text — this bucket exists precisely for what doesn't fit elsewhere
};

const CONFIDENCE = ['high', 'medium', 'low'];

const REVIEW_STATUS = ['auto_published', 'pending_review', 'approved', 'rejected'];

module.exports = {
  CAPITAL_SOURCE,
  CAPITAL_SOURCE_QUALIFIER,
  DEAL_TYPE,
  DEAL_TYPE_QUALIFIER,
  TECH_CATEGORY,
  TECH_CATEGORY_QUALIFIER,
  CONFIDENCE,
  REVIEW_STATUS,
};
