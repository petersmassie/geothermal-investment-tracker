-- Migration 001: two-tier technology taxonomy (tech_category + tech_type_qualifier)
-- and fuzzy duplicate-detection support (pg_trgm + possible_duplicate_of_id).
--
-- Brings a database created under schema v1 (single tech_type column, no fuzzy dedup)
-- up to schema v2. Every statement is idempotent, so this is also safe to run against
-- a database that was already created fresh from the current schema.sql (v2) — in that
-- case every guard below finds nothing to do and the whole file is a no-op.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS tech_category TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS possible_duplicate_of_id INTEGER REFERENCES deals(id);

-- Backfill: every deal extracted under the old single-axis tech_type was necessarily a
-- resource-development classification (EGS/AGS/hydrothermal/direct-use/heat pump) —
-- the collector had no other category to put it in — so this backfill is lossless.
-- The DO block only runs its body if the old `tech_type` column still exists, so this
-- is safe to re-run after the column has already been dropped on a later run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'tech_type'
  ) THEN
    UPDATE deals SET
      tech_type_qualifier = COALESCE(tech_type_qualifier, tech_type),
      tech_category = 'resource_development'
    WHERE tech_category IS NULL;

    ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_tech_type_check;
    ALTER TABLE deals DROP COLUMN tech_type;
  END IF;
END $$;

-- Any row somehow still without a tech_category at this point (shouldn't happen given
-- the backfill above, but guards against a partially-migrated or hand-edited database)
-- gets the safest default rather than blocking the NOT NULL constraint below.
UPDATE deals SET tech_category = 'resource_development' WHERE tech_category IS NULL;

ALTER TABLE deals ALTER COLUMN tech_category SET NOT NULL;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_tech_category_check;
ALTER TABLE deals ADD CONSTRAINT deals_tech_category_check
  CHECK (tech_category IN ('resource_development','drilling_or_subsurface_technology','equipment_or_components','other_enabling_technology'));

DROP INDEX IF EXISTS deals_tech_type_idx;
CREATE INDEX IF NOT EXISTS deals_tech_category_idx ON deals (tech_category);
CREATE INDEX IF NOT EXISTS deals_recipient_trgm_idx ON deals USING gin (recipient gin_trgm_ops);
