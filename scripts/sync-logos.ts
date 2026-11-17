// Usage: npm run sync-logos [-- --force]
// Stores each FBS team's CFBD colors on `teams` and downloads its logo (light + dark, 128px) into
// public/logos/{cfbd_id}.png and public/logos/dark/{cfbd_id}.png. Team lists come from the disk-cached
// /teams/fbs responses (2014 on), so a re-run costs at most one CFBD call (the current season, cached
// after the first run; pass --force to refetch it). Logos come from CFBD's image CDN, not the API, and
// existing files are skipped. Teams that were ever FBS since 2014 get a logo.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCfbdClient } from "../lib/cfbd/client";
import { createDiskCache } from "../lib/cfbd/disk-cache";
import type { CfbdTeam } from "../lib/cfbd/types";
import { createAdminDb, fetchAll } from "../lib/ingest/db";
import { hexColor, logoPath } from "../lib/teams/colors";

const FIRST_SEASON = 2014;
const CDN = "https://cdn.collegefootballdata.com";

function currentSeason(now = new Date()) {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

async function download(url: string, file: string): Promise<"ok" | "skip" | string> {
  if (existsSync(file)) return "skip";
  const res = await fetch(url);
  if (!res.ok) return `HTTP ${res.status}`;
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return `not an image (${type})`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return "ok";
}

async function main() {
  const force = process.argv.includes("--force");
  const cached = createCfbdClient({ apiKey: process.env.CFBD_API_KEY ?? "", cache: createDiskCache() });
  const live = createCfbdClient({ apiKey: process.env.CFBD_API_KEY ?? "" });
  const now = currentSeason();

  // Newest season wins, so colors follow the current CFBD values.
  const latest = new Map<number, CfbdTeam>();
  for (let y = FIRST_SEASON; y <= now; y++) {
    const teams = await (y === now && force ? live : cached).teamsFbs(y);
    for (const t of teams) latest.set(t.id, t);
  }
  console.log(`${latest.size} teams that were FBS in ${FIRST_SEASON}-${now} (API calls: ${cached.stats.networkCalls + live.stats.networkCalls})`);

  const failures: string[] = [];
  let fetched = 0;
  for (const t of latest.values()) {
    for (const dark of [false, true]) {
      const url = `${CDN}/${dark ? "logos-dark" : "logos"}/128/${t.id}.png`;
      const file = path.join(process.cwd(), "public", logoPath(t.id, dark));
      const r = await download(url, file);
      if (r === "ok") fetched++;
      else if (r !== "skip") failures.push(`${t.school} (${t.id}) ${dark ? "dark" : "light"}: ${r}`);
    }
  }
  console.log(`logos downloaded: ${fetched}`);
  const db = createAdminDb();
  const known = new Map(
    (await fetchAll<{ id: number; cfbd_id: number }>(db, "teams", "id,cfbd_id")).map((t) => [t.cfbd_id, t.id]),
  );
  let colored = 0;
  for (const t of latest.values()) {
    if (!known.has(t.id)) {
      console.warn(`not in teams table, skipped: ${t.school} (${t.id})`);
      continue;
    }
    const { error } = await db
      .from("teams")
      .update({ color: hexColor(t.color), alt_color: hexColor(t.alternateColor) })
      .eq("cfbd_id", t.id);
    if (error) {
      if (/color/.test(error.message)) {
        console.error(`colors not stored: ${error.message}. Apply supabase/migrations/20261117000000_team_colors.sql, then re-run.`);
        process.exitCode = 1;
        break;
      }
      throw new Error(`update colors for ${t.school}: ${error.message}`);
    }
    colored++;
  }
  console.log(`colors stored for ${colored} teams`);

  if (failures.length) {
    console.error(`FAILED (${failures.length}); these teams fall back to initials:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
