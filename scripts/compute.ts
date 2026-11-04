// Usage: npm run compute -- --from 2014 --to 2025
// Recomputes z-scores and composites from stored ratings. No API calls; idempotent.

import { createAdminDb } from "../lib/ingest/db";
import { computeAndStoreWeek, ratingWeeks } from "../lib/compute/run";

function arg(name: string): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = Number(process.argv[i + 1]);
  if (i === -1 || !Number.isInteger(n)) throw new Error(`Usage: npm run compute -- --from 2014 --to 2025 (missing --${name})`);
  return n;
}

async function main() {
  const from = arg("from");
  const to = arg("to");
  const db = createAdminDb();
  for (let season = from; season <= to; season++) {
    const weeks = await ratingWeeks(db, season);
    for (const week of weeks) {
      const r = await computeAndStoreWeek(db, season, week);
      console.log(`${season} wk ${week}: ${r.teams} teams`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
