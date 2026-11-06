// Usage: npm run prior-fpi -- --season 2013
// Stores one season's final FPI so the following season's best-team model has a preseason prior
// (the backfill starts at 2014, so 2014 otherwise has none). One CFBD call, disk-cached; idempotent.
// Only teams already in the crosswalk are stored; others are listed (they can't be FBS teams we rank).

import { createCfbdClient } from "../lib/cfbd/client";
import { createDiskCache } from "../lib/cfbd/disk-cache";
import { createCrosswalk, type AliasRow } from "../lib/crosswalk";
import { fetchAll, upsertRows, createAdminDb } from "../lib/ingest/db";

async function main() {
  const i = process.argv.indexOf("--season");
  const season = Number(process.argv[i + 1]);
  if (i === -1 || !Number.isInteger(season)) throw new Error("Usage: npm run prior-fpi -- --season 2013");
  const cfbd = createCfbdClient({ apiKey: process.env.CFBD_API_KEY ?? "", cache: createDiskCache() });
  const db = createAdminDb();
  const fpi = await cfbd.ratingsFpi(season);
  const crosswalk = createCrosswalk(await fetchAll<AliasRow>(db, "team_aliases", "alias,source,team_id"));
  const { data: sys, error } = await db.from("systems").select("id").eq("name", "FPI").single();
  if (error) throw new Error(`systems FPI: ${error.message}`);
  const rows: { system_id: number; team_id: number; season: number; week: number; raw_value: number }[] = [];
  const skipped: string[] = [];
  for (const r of fpi) {
    const id = crosswalk.lookup(r.team);
    if (r.fpi === null || !Number.isFinite(r.fpi)) continue;
    if (id === undefined) skipped.push(r.team);
    else rows.push({ system_id: (sys as { id: number }).id, team_id: id, season, week: 1, raw_value: r.fpi });
  }
  await upsertRows(db, "ratings", rows, "system_id,team_id,season,week");
  console.log(`${season} FPI: stored ${rows.length} teams${skipped.length ? `; not in crosswalk: ${skipped.join(", ")}` : ""}`);
  console.log(`API calls: ${cfbd.stats.networkCalls} (cache hits: ${cfbd.stats.cacheHits})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
