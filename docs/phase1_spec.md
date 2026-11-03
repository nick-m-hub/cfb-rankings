# CFB Rankings — Phase 1 Build Spec

Nov 3, 2026 · @Nick

## Goal and scope

Phase 1 ships a public FBS power ranking that blends a predictive composite and a resume composite with a user-controlled slider, refreshed automatically each week from the CollegeFootballData (CFBD) API.

**In scope**

- Weekly ingest of CFBD ratings, games and CFP committee rankings
- One-time historical backfill of the CFP era (2014 onward)
- Team-name crosswalk and per-week z-score normalization
- Equal-weight predictive and resume composites
- Rankings page with blend slider and week selector; methodology page

**Not in Phase 1**

- Learned weights, backtesting and the public scorecard (Phase 2)
- Margin caps and per-game performance grades (Phase 2)
- In-house SRS engine and the comparison sandbox (Phase 3)
- Any non-CFBD rating source (Phase 4, with permission)

Build the data model so those later phases fit without migrations to existing tables.

## Stack and repo setup

Reuse the PortfolioDB stack, but every piece of infrastructure is a new, separate instance.

| Layer | Choice | Notes |
| --- | --- | --- |
| App | Next.js (App Router), TypeScript, Tailwind | New repo, e.g. `cfb-rankings` |
| Database | Supabase Postgres | New Supabase project, not a schema in PortfolioDB's |
| Hosting | Vercel | New Vercel project linked to the new repo |
| Scheduled jobs | Vercel Cron calling a protected API route | Secured with `CRON_SECRET` |
| Backfill | Local Node script (`scripts/backfill.ts`) | Runs from your machine, avoids serverless time limits |
| Data | CFBD API via `fetch`, typed responses | Free key to start |

**Environment variables** (in `.env.local` and the Vercel project; never committed)

- `CFBD_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server and scripts only)
- `CRON_SECRET`
- `REVALIDATE_SECRET`

**Repo layout**

- `app/` pages and API routes
- `lib/cfbd/` API client and response types
- `lib/compute/` normalization and composites (pure functions, unit-tested)
- `supabase/migrations/` SQL migrations
- `scripts/` backfill and one-off tools
- `docs/SPEC.md` this spec, exported as Markdown
- `CLAUDE.md` project instructions for Claude Code

## Data model

Seven tables. Ratings are stored long (one row per system, team and week) so new systems never need a schema change.

| Table | Key columns | Purpose |
| --- | --- | --- |
| `teams` | `id`, `name`, `conference`, `division` (fbs/fcs), `cfbd_id` | One canonical row per team |
| `team_aliases` | `alias`, `source`, `team_id` | The crosswalk: every name variant each source uses |
| `systems` | `id`, `name`, `kind` (predictive/resume), `source`, `higher_is_better` | Registry of rating systems |
| `ratings` | `system_id`, `team_id`, `season`, `week`, `raw_value`, `z_value`, `retrieved_at` | Raw and normalized ratings |
| `games` | `id`, `season`, `week`, `home_team_id`, `away_team_id`, `home_points`, `away_points`, `neutral_site`, `completed` | Results; future model targets |
| `committee_ranks` | `season`, `week`, `team_id`, `rank` | CFP committee rankings |
| `composite_scores` | `season`, `week`, `team_id`, `z_pred`, `z_resume`, `n_systems_pred`, `n_systems_resume` | Precomputed inputs for the slider |

- Unique keys: `ratings (system_id, team_id, season, week)`, `games (id)`, `committee_ranks (season, week, team_id)`, `composite_scores (season, week, team_id)`.
- All ingest writes are upserts, so re-running any job is safe.
- Row-level security: public read on `teams`, `systems`, `composite_scores`; everything else server-only.
- Phase 2 adds a `model_weights` table; nothing existing changes.

## Ingest

One shared ingest module, called by both the weekly cron and the backfill script.

**CFBD endpoints used** (Bearer token in the `Authorization` header)

| Endpoint | Data | Stored in |
| --- | --- | --- |
| `/teams/fbs` | FBS teams and conferences | `teams`, `team_aliases` |
| `/ratings/sp` | SP+ | `ratings` |
| `/ratings/fpi` | FPI | `ratings` |
| `/ratings/elo` | Elo (supports a `week` parameter) | `ratings` |
| `/ratings/srs` | SRS | `ratings` |
| `/games` | Scores and results | `games` |
| `/rankings` | Polls, including the Playoff Committee poll | `committee_ranks` |

**First task for Claude Code:** check which rating endpoints return week-by-week history and which return only a current or end-of-season value. For any that don't keep history, the weekly job snapshots them from now on, and the backfill stores end-of-season values only.

**Weekly job** (`/api/cron/ingest`, requires `CRON_SECRET`)

1. Runs twice a week: Sunday morning (after Saturday games) and Wednesday morning (after the Tuesday committee release). Vercel cron runs in UTC, so set times accordingly.
2. Determines the current season and week from CFBD.
3. Fetches each endpoint, maps team names through `team_aliases`, and upserts.
4. Recomputes z-scores and composites for that week.
5. Triggers on-demand revalidation of the rankings page (no time-based revalidation, to limit ISR writes).
6. Logs counts per system and any unmatched team names.

**Backfill script** (`npm run backfill -- --from 2014 --to 2025`)

- Loops seasons and weeks, reusing the ingest module.
- Throttles requests to stay within CFBD rate limits; resumable if interrupted.
- Fails loudly on unmatched team names and writes them to a report, so the crosswalk gets fixed rather than silently dropping teams.

## Normalization and composites

All math lives in `lib/compute/` as pure, unit-tested functions.

**Normalization**

- For each system, season and week, compute a z-score across FBS teams only: (rating − mean) ÷ standard deviation.
- Flip the sign for any system where lower is better, so higher z always means better.
- A team missing from a system that week simply has no z for it; never impute.

**Phase 1 system assignment** (equal weights)

| Composite | Systems |
| --- | --- |
| Predictive | SP+, FPI |
| Resume | Elo, SRS |

Elo and SRS are built from game results, so they serve as the Phase 1 resume proxy. Phase 2 replaces this with a resume model fit to committee rankings.

**Composites**

- `z_pred` = mean of the team's available predictive z-scores; `z_resume` likewise.
- Require at least one system on each side; otherwise mark the team unranked for that side.
- Re-standardize each composite across FBS teams so both sides share one scale before blending.

**Blend** (computed in the browser; `s` = slider value from 0 to 1)

```latex
\text{Score} = s \cdot z_{\text{pred}} + (1 - s) \cdot z_{\text{resume}}
```

## Frontend

Two pages in Phase 1. The rankings page is static per week, and the slider re-sorts in the browser with no server calls.

**`/rankings` (and `/rankings/[season]/[week]`)**

- Data: `composite_scores` for the week, joined to `teams`, plus each team's record from `games`. Fetched at build or revalidation time.
- Slider from "Resume" (0) to "Predictive" (100), default 50. Re-sorting is instant.
- Slider value lives in the URL (`?blend=70`) so a ranking can be shared exactly as seen.
- Table columns: rank, team, conference, record, blended score, predictive rank, resume rank, change from last week.
- Week and season selectors; the current week by default.
- Mobile-first: on narrow screens show rank, team, record and blended score; tap a row to expand the rest.

**`/methodology`**

- Plain-language explanation of each input system, the two composites and the blend.
- Attribution to CFBD and each underlying system.
- "Last updated" timestamp from the latest ingest.

**Not needed in Phase 1:** accounts, comments, team pages, the sandbox.

## Acceptance criteria and tests

Phase 1 is done when every box below is checked.

**Data**

- [ ] Backfill completes for 2014 through the current week with zero unmatched FBS team names
- [ ] Every FBS team has a row in `composite_scores` for every week it played
- [ ] Re-running ingest for the same week changes no rows (idempotent)

**Automation**

- [ ] Cron runs twice weekly without manual fixes for three consecutive weeks
- [ ] Cron route rejects requests without `CRON_SECRET`
- [ ] Rankings page shows new data within minutes of each ingest

**Site**

- [ ] Slider re-sorts instantly and the URL reflects its value
- [ ] At slider 100 the order matches the predictive composite; at 0, the resume composite
- [ ] Usable on a phone-width screen

**Unit tests** (`lib/compute/`)

- [ ] z-scores have mean 0 and standard deviation 1 across FBS each week
- [ ] Sign flip works for lower-is-better systems
- [ ] Composites handle a team missing from one system
- [ ] Blend math at s = 0, 0.5 and 1

## Open decisions for Nick

Settle these before handing the spec to Claude Code, or tell it to stop and ask.

- [ ] Site name and domain
- [ ] Phase 1 system split: SP+ and FPI predictive, Elo and SRS resume, or another split
- [ ] Slider default: 50/50, or lean toward resume during committee season
- [ ] FCS teams: hide entirely, or show when they play FBS opponents
- [ ] CFBD tier: free key to start, or Patreon if a needed endpoint requires it

**Instructions for Claude Code:** start in plan mode, verify CFBD endpoint behavior before writing the schema, and build in this order: migrations, CFBD client, crosswalk, backfill, compute, cron, pages.
