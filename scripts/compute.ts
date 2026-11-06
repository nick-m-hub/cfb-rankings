// Usage: npm run compute -- --from 2014 --to 2026 [--sims 1000]
// Runs the in-house models week by week, then z-scores and composites. No API calls; idempotent.

import { createAdminDb } from "../lib/ingest/db";
import { computeAndStoreWeek, computeWeeks } from "../lib/compute/run";
import { loadModelSeason } from "../lib/models/run";

function arg(name: string, fallback?: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 && fallback !== undefined) return fallback;
  const n = Number(process.argv[i + 1]);
  if (i === -1 || !Number.isInteger(n)) throw new Error(`Usage: npm run compute -- --from 2014 --to 2026 (missing --${name})`);
  return n;
}

async function main() {
  const from = arg("from");
  const to = arg("to");
  const sims = arg("sims", 1000);
  const db = createAdminDb();
  for (let season = from; season <= to; season++) {
    const model = await loadModelSeason(db, season);
    const weeks = await computeWeeks(db, season, model);
    for (const week of weeks) {
      const started = Date.now();
      const r = await computeAndStoreWeek(db, season, week, { model, sims });
      console.log(`${season} wk ${week}: ${r.teams} teams (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
