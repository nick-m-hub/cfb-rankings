// Usage: npm run ingest-current [-- --all-weeks]
// Local equivalent of the cron route: snapshots the current week (ingest -> compute). No disk cache,
// since in-season responses change weekly. Spends CFBD quota; idempotent upserts.
// --all-weeks also fetches advanced stats for every week so far (one call per week) and recomputes
// the models for each of them. Use it once to fill in the current season's earlier weeks.

import { createCfbdClient } from "../lib/cfbd/client";
import { computeAndStoreWeek } from "../lib/compute/run";
import { loadModelSeason } from "../lib/models/run";
import { createAdminDb } from "../lib/ingest/db";
import { ingestSeason, SeasonUnmatchedError } from "../lib/ingest/season";
import { buildWeekMap, currentStoredWeek, seasonForDate } from "../lib/ingest/weeks";

async function main() {
  const now = new Date();
  const season = seasonForDate(now);
  const cfbd = createCfbdClient({ apiKey: process.env.CFBD_API_KEY ?? "" });
  const db = createAdminDb();

  const allWeeks = process.argv.includes("--all-weeks");
  const calendar = await cfbd.calendar(season);
  const week = currentStoredWeek(calendar, buildWeekMap(calendar), now);
  if (week === null) {
    console.log(`Offseason for ${season}; nothing to snapshot.`);
    return;
  }
  console.log(`Ingesting ${season} week ${week}`);
  const statsWeeks = allWeeks ? Array.from({ length: week }, (_, i) => i + 1) : [week - 1, week].filter((w) => w >= 1);
  const counts = await ingestSeason({ cfbd, db, season, weeks: [week], statsWeeks, updateTeamMeta: true, log: console.log });
  if (allWeeks) {
    const model = await loadModelSeason(db, season);
    for (let w = 1; w < week; w++) {
      const r = await computeAndStoreWeek(db, season, w, { model });
      console.log(`${season} wk ${w}: ${r.teams} teams`);
    }
  }
  const composite = await computeAndStoreWeek(db, season, week);
  console.log(JSON.stringify({ season, week, counts: { ...counts, gaps: counts.gaps.length }, composite }));
  console.log(`API calls: ${cfbd.stats.networkCalls}`);
}

main().catch((err) => {
  if (err instanceof SeasonUnmatchedError) {
    console.error(`${err.message}: ${err.unmatched.map((u) => `"${u.name}" (${u.source})`).join(", ")}`);
  } else console.error(err);
  process.exit(1);
});
