-- Migration 002: simplify the technology taxonomy from the v2 two-tier scheme
-- (tech_category: resource_development/drilling_or_subsurface_technology/
-- equipment_or_components/other_enabling_technology, each with its own qualifier list)
-- down to a single flat field with six values: conventional, egs, ags, shr, direct_use,
-- cross_cutting_or_other. See src/shared/taxonomy.js for the reasoning — this matches
-- how the IEA itself tracks geothermal investment, and the narrower, flatter set of
-- boxes is meant to leave less room for the model to punt into free text the way it
-- did under v2's more granular split.
--
-- Every statement is idempotent, so this is also safe to run against a database that
-- was already created fresh from the current schema.sql (v3) — in that case the guard
-- below finds no tech_type_qualifier column and the whole file is a no-op.

-- Drop the OLD check constraint first — it only allows the four v2 category values, so
-- the remapping UPDATEs below (which write egs/ags/conventional/etc. into tech_category)
-- would violate it if it were still in place. The new constraint goes on at the end,
-- once every row has been remapped.
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_tech_category_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'tech_type_qualifier'
  ) THEN
    -- Best-effort mapping from the old category+qualifier pair to the new flat value.
    -- resource_development rows: the specific technology (if any) carries over directly;
    -- 'unspecified' or no qualifier falls back to 'conventional' as the baseline case.
    UPDATE deals SET tech_category = 'egs'
      WHERE tech_category = 'resource_development' AND tech_type_qualifier = 'egs';
    UPDATE deals SET tech_category = 'ags'
      WHERE tech_category = 'resource_development' AND tech_type_qualifier = 'ags';
    UPDATE deals SET tech_category = 'conventional'
      WHERE tech_category = 'resource_development' AND tech_type_qualifier = 'conventional_hydrothermal';
    UPDATE deals SET tech_category = 'direct_use'
      WHERE tech_category = 'resource_development'
        AND tech_type_qualifier IN ('direct_use', 'heat_pump_or_district_heating');
    UPDATE deals SET tech_category = 'conventional'
      WHERE tech_category = 'resource_development'
        AND (tech_type_qualifier IS NULL OR tech_type_qualifier = 'unspecified');

    -- Every other old category (the enabling-technology buckets) collapses into the
    -- new catch-all — none of them map to a specific resource type.
    UPDATE deals SET tech_category = 'cross_cutting_or_other'
      WHERE tech_category IN ('drilling_or_subsurface_technology', 'equipment_or_components', 'other_enabling_technology');

    ALTER TABLE deals DROP COLUMN tech_type_qualifier;
  END IF;
END $$;

-- Guards against any row that somehow still doesn't match the new list (shouldn't
-- happen given the backfill above, but keeps the CHECK constraint below from blocking
-- on a partially-migrated or hand-edited database).
UPDATE deals SET tech_category = 'cross_cutting_or_other'
  WHERE tech_category NOT IN ('conventional','egs','ags','shr','direct_use','cross_cutting_or_other');

ALTER TABLE deals ADD CONSTRAINT deals_tech_category_check
  CHECK (tech_category IN ('conventional','egs','ags','shr','direct_use','cross_cutting_or_other'));
