-- Geothermal Investment Tracker — schema v1 (taxonomy v3, agreed 2026-09-01)
-- Run via `npm run migrate` (db/migrate.js), idempotent (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS deals (
  id                    SERIAL PRIMARY KEY,
  recipient             TEXT NOT NULL,
  deal_type             TEXT NOT NULL CHECK (deal_type IN ('equity','debt','project_financing','acquisition','jv','grant','other')),
  deal_type_qualifier   TEXT,
  amount                NUMERIC,
  currency              TEXT,
  amount_usd            NUMERIC, -- normalized at write time for cross-currency aggregation; null if amount/currency undisclosed or conversion unavailable
  announced_date        DATE,
  tech_type             TEXT NOT NULL CHECK (tech_type IN ('egs','conventional_hydrothermal','ags','direct_use','heat_pump_or_district_heating','unspecified')),
  tech_type_qualifier   TEXT,
  geography_country     TEXT,
  geography_region      TEXT,
  source_url            TEXT NOT NULL,
  source_name           TEXT,
  excerpt               TEXT,
  confidence            TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  confidence_signals    JSONB,
  review_status         TEXT NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('auto_published','pending_review','approved','rejected')),
  dedup_key             TEXT,
  extraction_model      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevents the same underlying deal (same recipient + amount + date, roughly) from
-- being inserted twice when multiple sources cover the same announcement.
CREATE UNIQUE INDEX IF NOT EXISTS deals_dedup_key_idx ON deals (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS deals_announced_date_idx ON deals (announced_date);
CREATE INDEX IF NOT EXISTS deals_review_status_idx ON deals (review_status);
CREATE INDEX IF NOT EXISTS deals_deal_type_idx ON deals (deal_type);
CREATE INDEX IF NOT EXISTS deals_tech_type_idx ON deals (tech_type);

-- One row per investor per deal. A single-investor deal still gets exactly one row here.
-- capital_source lives per-investor (not on `deals`) so a mixed public+private round
-- isn't forced into a single bucket — the dashboard derives a deal-level label by
-- aggregating these rows (see src/web: deriveSourceMix).
CREATE TABLE IF NOT EXISTS deal_investors (
  id                          SERIAL PRIMARY KEY,
  deal_id                     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  investor_name               TEXT NOT NULL,
  capital_source              TEXT NOT NULL CHECK (capital_source IN ('public','private','unclear')),
  capital_source_qualifier    TEXT,
  amount_attributed           NUMERIC,
  is_lead_investor            BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS deal_investors_deal_id_idx ON deal_investors (deal_id);
CREATE INDEX IF NOT EXISTS deal_investors_capital_source_idx ON deal_investors (capital_source);

-- Every article the collector has looked at, relevant or not — keyed on source URL so
-- a re-appearing link (RSS re-publish, GDELT re-indexing) is never re-sent to the LLM.
CREATE TABLE IF NOT EXISTS ingested_articles (
  id            SERIAL PRIMARY KEY,
  source_url    TEXT UNIQUE NOT NULL,
  source_feed   TEXT,
  title         TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  passed_prefilter  BOOLEAN,
  is_relevant   BOOLEAN, -- null until an extraction call has actually run on it
  deal_id       INTEGER REFERENCES deals(id)
);

-- Tracks each daily collector run for observability (surfaced on the dashboard's
-- admin/status view rather than relying solely on Render's own job logs).
CREATE TABLE IF NOT EXISTS collector_runs (
  id                  SERIAL PRIMARY KEY,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  articles_fetched    INTEGER,
  articles_prefiltered_in INTEGER,
  extraction_calls    INTEGER,
  deals_created       INTEGER,
  deals_auto_published INTEGER,
  deals_queued_for_review INTEGER,
  errors              JSONB,
  status              TEXT CHECK (status IN ('running','completed','failed'))
);
