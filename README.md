# Geothermal Investment Tracker

Standalone service that scans news daily for geothermal investment/funding activity,
extracts structured deal data with the Claude API, and serves a public dashboard at
geo.massieenergy.com. Companion project to the AESO grid dashboard (Electron
Macroscope) — see the Geothermal Investment project's `architecture-proposal.md` for
the full design rationale and decisions.

## What's here

```
db/schema.sql          Postgres schema (deals, deal_investors, ingested_articles, collector_runs)
db/migrate.js           Applies schema.sql — run once before first use
src/shared/             Taxonomy + Claude structured-output schema (single source of truth)
src/collector/          Daily batch job: fetch feeds -> prefilter -> extract -> dedup -> write
src/web/                Express app serving the API + geo.massieenergy.com dashboard
render.yaml              Render Blueprint: cron job + web service + Postgres, as 3 separate services
```

Collector and web service are deliberately separate processes (see architecture
proposal §5) — the collector runs once/day and exits, so it can never be starved by
frontend traffic the way the grid dashboard's combined process was.

## Local setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL (a local/dev Postgres) and ANTHROPIC_API_KEY
npm run migrate         # creates the schema
npm run collect          # runs one collection pass against real feeds + the Claude API
npm run web               # starts the dashboard at http://localhost:3000
```

You'll need a Postgres instance to point `DATABASE_URL` at for local dev — either a
local install, Docker (`docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`),
or Render's database using its *External* connection string (the Internal one only
works from inside Render).

## Before the first production run

1. **Verify the RSS feed URLs in `src/collector/sources.js`.** A few are marked with a
   comment because their feed URL wasn't confirmed live during the architecture
   research — check each resolves to a valid RSS/Atom feed before relying on it, and
   add any others you want covered (the list is the single highest-leverage lever for
   coverage).
2. **Review the taxonomy in `src/shared/taxonomy.js`** — it's the resolved v3 taxonomy
   from the architecture proposal, but it's a plain JS file, easy to adjust before data
   starts accumulating against it (changing it after real deals exist means a data
   migration, not just a code change).
3. **Decide `AUTO_PUBLISH_THRESHOLD`** (`.env` / `render.yaml`) — `high` means only
   high-confidence extractions auto-publish and everything else queues for review at
   geo.massieenergy.com's review section, matching what was agreed. Loosen to `medium`
   only if the review queue proves too conservative in practice.
4. **Currency conversion is a static approximation** (`src/collector/currency.js`) —
   fine to ship with, but flagged there as a TODO to swap for a live FX rate API before
   leaning on `amount_usd` for real trend analysis across many currencies.

## Deploying to Render

1. Push this repo to GitHub.
2. In Render: **New > Blueprint**, point it at the repo — it reads `render.yaml` and
   provisions the database, the cron job, and the web service together.
3. Set `ANTHROPIC_API_KEY` on the cron job's environment (Render won't have picked this
   up from the Blueprint — it's deliberately excluded from the file since it's a secret).
4. Run the migration once: open a Shell on the web service (or the cron job) in the
   Render dashboard and run `npm run migrate`, or run it from your own machine against
   the database's *External Database URL*.
5. Trigger the cron job manually once from the Render dashboard to confirm it runs
   clean before waiting for the schedule.
6. Add a CNAME for `geo.massieenergy.com` pointed at the web service's Render hostname,
   then add the custom domain under the web service's Settings — same steps used for
   grid.massieenergy.com.

## Cost (see architecture proposal for the full breakdown)

Render web service (~$7/mo) + cron job (~$1-3/mo) + Postgres starter (~$6-7/mo) +
Claude API usage (a few dollars/month at this volume) — comfortably under $20/month.
