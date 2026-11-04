// DB glue for compute: reads ratings for a week, writes ratings.z_value and composite_scores.
// Idempotent upserts; shared by the compute script and (later) the cron route.

import { upsertRows, type Db } from "../ingest/db";
import { computeWeek, type SystemKind } from "./composite";

interface SystemRow {
  id: number;
  kind: SystemKind;
  higher_is_better: boolean;
}
interface RatingDbRow {
  system_id: number;
  team_id: number;
  raw_value: number;
}

async function select<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T[];
}

/** Weeks that have any ratings for the season, ascending. */
export async function ratingWeeks(db: Db, season: number): Promise<number[]> {
  const weeks = new Set<number>();
  for (let from = 0; ; from += 1000) {
    const rows = await select<{ week: number }>(
      db.from("ratings").select("week").eq("season", season).order("week").range(from, from + 999),
      "select ratings weeks",
    );
    rows.forEach((r) => weeks.add(r.week));
    if (rows.length < 1000) break;
  }
  return [...weeks].sort((a, b) => a - b);
}

export async function computeAndStoreWeek(db: Db, season: number, week: number) {
  const systems = await select<SystemRow>(db.from("systems").select("id, kind, higher_is_better"), "select systems");
  const fbs = await select<{ id: number }>(db.from("teams").select("id").eq("division", "fbs"), "select teams");
  const fbsIds = new Set(fbs.map((t) => t.id));

  const ratings: RatingDbRow[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = await select<RatingDbRow>(
      db
        .from("ratings")
        .select("system_id, team_id, raw_value")
        .eq("season", season)
        .eq("week", week)
        .order("system_id")
        .order("team_id")
        .range(from, from + 999),
      "select ratings",
    );
    ratings.push(...rows);
    if (rows.length < 1000) break;
  }

  const { systemZ, composites } = computeWeek(
    systems.map((s) => ({ id: s.id, kind: s.kind, higherIsBetter: s.higher_is_better })),
    ratings.map((r) => ({ systemId: r.system_id, teamId: r.team_id, rawValue: r.raw_value })),
    fbsIds,
  );

  const rawBy = new Map(ratings.map((r) => [`${r.system_id}:${r.team_id}`, r.raw_value]));
  await upsertRows(
    db,
    "ratings",
    systemZ.map((r) => ({
      system_id: r.systemId,
      team_id: r.teamId,
      season,
      week,
      raw_value: rawBy.get(`${r.systemId}:${r.teamId}`)!,
      z_value: r.z,
    })),
    "system_id,team_id,season,week",
  );
  await upsertRows(
    db,
    "composite_scores",
    composites.map((c) => ({
      season,
      week,
      team_id: c.teamId,
      z_pred: c.zPred,
      z_resume: c.zResume,
      n_systems_pred: c.nSystemsPred,
      n_systems_resume: c.nSystemsResume,
    })),
    "season,week,team_id",
  );
  return { season, week, teams: composites.length };
}
