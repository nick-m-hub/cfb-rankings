// Usage: npm run backfill -- --from 2014 --to 2025
// Re-runnable: raw CFBD responses are cached in .cache/cfbd (zero API calls on repeat) and every
// write is an upsert. Unmatched team names are written to .cache/backfill-report.json and the
// process exits 1 after attempting every season.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCfbdClient } from "../lib/cfbd/client";
import { createDiskCache } from "../lib/cfbd/disk-cache";
import { createAdminDb } from "../lib/ingest/db";
import { ingestSeason, SeasonUnmatchedError } from "../lib/ingest/season";
import type { Unmatched } from "../lib/crosswalk";

function arg(name: string): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = Number(process.argv[i + 1]);
  if (i === -1 || !Number.isInteger(n)) throw new Error(`Usage: npm run backfill -- --from 2014 --to 2025 (missing --${name})`);
  return n;
}

/** CFBD seasons start in late August. */
function currentSeason(now = new Date()) {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

async function main() {
  const from = arg("from");
  const to = arg("to");
  if (from < 2014 || to < from) throw new Error("Need 2014 <= --from <= --to");
  if (to >= currentSeason()) {
    throw new Error(`Season ${to} is in progress: its responses change weekly and must not be disk-cached. Use the cron ingest.`);
  }

  const cfbd = createCfbdClient({ apiKey: process.env.CFBD_API_KEY ?? "", cache: createDiskCache() });
  const db = createAdminDb();

  const info = await cfbd.info();
  console.log(`CFBD quota: ${info.remainingCalls}/${info.monthlyLimit} calls remaining (resets ${info.resetAt})`);

  const report: { season: number; unmatched: Unmatched[] }[] = [];
  const failures: number[] = [];
  const gaps: { season: number; team: string; system: string }[] = [];
  for (let season = from; season <= to; season++) {
    try {
      const counts = await ingestSeason({ cfbd, db, season, updateTeamMeta: season === to, log: console.log });
      gaps.push(...counts.gaps.map((g) => ({ season, ...g })));
    } catch (err) {
      if (err instanceof SeasonUnmatchedError) {
        report.push({ season, unmatched: err.unmatched });
        console.error(`${err.message}: ${err.unmatched.map((u) => `"${u.name}" (${u.source})`).join(", ")}`);
        failures.push(season);
        continue;
      }
      throw err; // quota/DB/network errors stop the run; re-run resumes from cache
    }
  }

  console.log(`API calls this run: ${cfbd.stats.networkCalls} (cache hits: ${cfbd.stats.cacheHits})`);
  const file = path.join(process.cwd(), ".cache", "backfill-report.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ unmatched: report, gaps }, null, 2));
  if (gaps.length > 0) console.warn(`${gaps.length} FBS team/system gaps (upstream data, not imputed). See ${file}`);
  if (failures.length > 0) {
    console.error(`FAILED seasons ${failures.join(", ")}: add aliases to MANUAL_ALIASES, then re-run. Report: ${file}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
