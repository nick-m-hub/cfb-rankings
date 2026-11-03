# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

CFB Rankings (`package.json` name: `cfb-rankings`) is a public FBS power ranking that blends a predictive composite and a resume composite with a user-controlled slider. The repo is currently the untouched `create-next-app` scaffold (`app/page.tsx` and the layout metadata are still boilerplate). **[docs/phase1_spec.md](docs/phase1_spec.md) is the source of truth** for what to build; read it before starting any feature. It also lists open decisions (site name, system split, slider default, FCS handling, CFBD tier) — stop and ask rather than guessing those.

The spec's prescribed build order: migrations → CFBD client → team-name crosswalk → backfill → compute → cron → pages. Its first task is to verify which CFBD rating endpoints return week-by-week history before writing the schema.

## Working rules

- Read `docs/phase1_spec.md` before starting any task.
- This project is standalone: never reference, import from, or touch other repos, folders, or databases (the spec's mention of another project's stack is background only; don't act on it).
- Build in the spec's order (migrations → CFBD client → crosswalk → backfill → compute → cron → pages).
- Open decisions, resolved 2026-11-03: site name is the placeholder "CFB Rankings" (final name/domain still TBD, keep it in one constant); system split is the spec's (SP+/FPI predictive, Elo/SRS resume); slider default 50; FCS teams hidden entirely (still count FCS opponents in records); CFBD stays on the free tier (1,000 calls/month, shared pool), so the backfill must cache raw responses on disk and be re-runnable at zero API cost.
- CFBD history (verified 2026-11-03): only `/ratings/elo` honors `week`. SP+, FPI and SRS ignore it, so backfilled weeks use end-of-season values (look-ahead) and the weekly cron snapshots them going forward. Disclose this on `/methodology`.
- Week convention: CFBD restarts postseason at week 1; store postseason as (last regular week + 1).

## Commands

```bash
npm run dev      # next dev
npm run build    # next build
npm run lint     # eslint (flat config, eslint.config.mjs)
```

No test runner is configured yet. The spec calls for unit tests on `lib/compute/` and an `npm run backfill -- --from 2014 --to 2025` script (`scripts/backfill.ts`); add both when building those pieces.

Required env vars (copy `.env.example` to `.env.local`): `CFBD_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server/scripts only), `CRON_SECRET`, `REVALIDATE_SECRET`.

## Next.js version caveat

This is Next 16 / React 19 with breaking changes from older versions. Per AGENTS.md, read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code. `next.config.ts` enables `cacheComponents` and `partialPrefetching`, and wires Tailwind v4 through Turbopack (`@tailwindcss/turbopack`). Layout props use the global `LayoutProps<"/">` type.

## Planned architecture (from the spec)

- **Stack**: Next.js App Router + TypeScript + Tailwind, Supabase Postgres (new, dedicated project), Vercel hosting. Every piece of infrastructure is its own instance.
- **Layout**: `app/` pages and API routes; `lib/cfbd/` API client and typed responses; `lib/compute/` pure unit-tested normalization/composite functions; `supabase/migrations/` SQL; `scripts/` backfill and one-offs.
- **Ingest**: a single shared ingest module used by both the Vercel Cron route (`/api/cron/ingest`, protected by `CRON_SECRET`, runs Sunday and Wednesday mornings in UTC) and the local backfill script (local to avoid serverless time limits). All writes are upserts so re-runs are idempotent. Unmatched team names must fail loudly and be reported, never silently dropped.
- **Data model**: ratings are stored long (one row per system/team/season/week) so new rating systems need no schema change. Tables: `teams`, `team_aliases` (the name crosswalk), `systems`, `ratings`, `games`, `committee_ranks`, `composite_scores`. RLS: public read on `teams`, `systems`, `composite_scores` only.
- **Compute**: per-system, per-week z-scores across FBS teams only, with sign flipped for lower-is-better systems and no imputation of missing teams. Predictive = SP+, FPI; resume = Elo, SRS (equal weights). Each composite is re-standardized across FBS before blending. Blend `s·z_pred + (1−s)·z_resume` runs client-side only.
- **Frontend**: `/rankings` and `/rankings/[season]/[week]` are static per week, revalidated on demand after ingest (no time-based revalidation). The slider value lives in the URL (`?blend=70`). `/methodology` explains the inputs. Mobile-first.
- **Phase boundaries**: learned weights, backtesting, margin caps and game grades are Phase 2 (new `model_weights` table); don't add schema or code for them now, but don't make choices that would require migrating existing tables.
