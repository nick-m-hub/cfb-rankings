// Usage: npm run sync-teams [-- --season 2026]
// Refreshes name/conference/division (and aliases) for that season's FBS teams from CFBD, e.g. after
// offseason realignment. teams holds one row per team, so this is the "current conference" source.

import { createCfbdClient } from "../lib/cfbd/client";
import { aliasEntriesFromCfbd, type AliasRow } from "../lib/crosswalk";
import { createAdminDb, fetchAll, upsertRows } from "../lib/ingest/db";
import { collectTeams } from "../lib/ingest/transform";

function currentSeason(now = new Date()) {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

async function main() {
  const i = process.argv.indexOf("--season");
  const season = i === -1 ? currentSeason() : Number(process.argv[i + 1]);
  if (!Number.isInteger(season)) throw new Error("Usage: npm run sync-teams [-- --season 2026]");

  const cfbd = createCfbdClient({ apiKey: process.env.CFBD_API_KEY ?? "" }); // uncached: membership changes
  const db = createAdminDb();

  const before = await fetchAll<{ cfbd_id: number; name: string; conference: string | null; division: string }>(
    db, "teams", "cfbd_id,name,conference,division");
  const prev = new Map(before.map((t) => [t.cfbd_id, t]));

  const fbsTeams = await cfbd.teamsFbs(season);
  const rows = collectTeams(fbsTeams, []);
  await upsertRows(db, "teams", rows, "cfbd_id");

  for (const r of rows) {
    const p = prev.get(r.cfbd_id);
    if (!p) console.log(`added  ${r.name}: ${r.conference} (${r.division})`);
    else if (p.conference !== r.conference || p.division !== r.division || p.name !== r.name) {
      console.log(`updated ${r.name}: ${p.conference}/${p.division} -> ${r.conference}/${r.division}`);
    }
  }

  const ids = new Map((await fetchAll<{ id: number; cfbd_id: number }>(db, "teams", "id,cfbd_id")).map((t) => [t.cfbd_id, t.id]));
  const aliases: AliasRow[] = aliasEntriesFromCfbd(fbsTeams, (t) => ids.get(t.id));
  const unique = [...new Map(aliases.map((a) => [`${a.alias}\u0000${a.source}`, a])).values()];
  await upsertRows(db, "team_aliases", unique, "alias,source");
  console.log(`${season}: ${rows.length} FBS teams synced`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
