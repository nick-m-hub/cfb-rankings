// Server-side data for the rankings pages. Cached indefinitely and tagged; the cron route
// invalidates the tag after each ingest (no time-based revalidation).

import { cacheLife, cacheTag } from "next/cache";
import { createAdminDb, type Db } from "../ingest/db";
import type { TeamInput } from "./rank";

export const RANKINGS_TAG = "rankings";

export interface WeekRef {
  season: number;
  week: number;
}
export interface WeekData extends WeekRef {
  teams: TeamInput[];
  /** True when composite_scores has rows for this week. */
  found: boolean;
}

async function one(db: Db, col: "season" | "week", asc: boolean, filter?: { season: number }): Promise<number | null> {
  let q = db.from("composite_scores").select(col);
  if (filter) q = q.eq("season", filter.season);
  const { data, error } = await q.order(col, { ascending: asc }).limit(1);
  if (error) throw new Error(`composite_scores ${col}: ${error.message}`);
  const row = data?.[0] as Record<string, number> | undefined;
  return row ? row[col] : null;
}

/** Max stored week per season, newest season first. Weeks are contiguous from 1. */
export async function getAvailableWeeks(): Promise<{ season: number; maxWeek: number }[]> {
  "use cache";
  cacheLife("max");
  cacheTag(RANKINGS_TAG);
  const db = createAdminDb();
  const [first, last] = await Promise.all([one(db, "season", true), one(db, "season", false)]);
  if (first === null || last === null) return [];
  const out: { season: number; maxWeek: number }[] = [];
  for (let season = last; season >= first; season--) {
    const maxWeek = await one(db, "week", false, { season });
    if (maxWeek !== null) out.push({ season, maxWeek });
  }
  return out;
}

export async function getLatestWeek(): Promise<WeekRef | null> {
  const weeks = await getAvailableWeeks();
  return weeks.length ? { season: weeks[0].season, week: weeks[0].maxWeek } : null;
}

interface ScoreRow {
  team_id: number;
  z_pred: number | null;
  z_resume: number | null;
}

async function scoresFor(db: Db, season: number, week: number): Promise<ScoreRow[]> {
  const out: ScoreRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("composite_scores")
      .select("team_id, z_pred, z_resume")
      .eq("season", season)
      .eq("week", week)
      .order("team_id")
      .range(from, from + 999);
    if (error) throw new Error(`composite_scores: ${error.message}`);
    out.push(...(data as ScoreRow[]));
    if (data.length < 1000) return out;
  }
}

export async function getWeekData(season: number, week: number): Promise<WeekData> {
  "use cache";
  cacheLife("max");
  cacheTag(RANKINGS_TAG);
  const db = createAdminDb();

  const [cur, prev, teamsRes] = await Promise.all([
    scoresFor(db, season, week),
    week > 1 ? scoresFor(db, season, week - 1) : Promise.resolve([] as ScoreRow[]),
    db.from("teams").select("id, name, conference").eq("division", "fbs"),
  ]);
  if (teamsRes.error) throw new Error(`teams: ${teamsRes.error.message}`);
  if (cur.length === 0) return { season, week, teams: [], found: false };

  // Records: completed games through this week. FCS opponents count; FCS teams are never shown.
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("games")
      .select("home_team_id, away_team_id, home_points, away_points")
      .eq("season", season)
      .lte("week", week)
      .eq("completed", true)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`games: ${error.message}`);
    for (const g of data) {
      if (g.home_points === null || g.away_points === null || g.home_points === g.away_points) continue;
      const [w, l] = g.home_points > g.away_points ? [g.home_team_id, g.away_team_id] : [g.away_team_id, g.home_team_id];
      wins.set(w, (wins.get(w) ?? 0) + 1);
      losses.set(l, (losses.get(l) ?? 0) + 1);
    }
    if (data.length < 1000) break;
  }

  const prevBy = new Map(prev.map((r) => [r.team_id, r]));
  const curBy = new Map(cur.map((r) => [r.team_id, r]));
  const teams: TeamInput[] = [];
  for (const t of teamsRes.data) {
    const c = curBy.get(t.id);
    if (!c) continue;
    const p = prevBy.get(t.id);
    teams.push({
      id: t.id,
      name: t.name,
      conference: t.conference,
      wins: wins.get(t.id) ?? 0,
      losses: losses.get(t.id) ?? 0,
      zPred: c.z_pred,
      zResume: c.z_resume,
      prevZPred: p?.z_pred ?? null,
      prevZResume: p?.z_resume ?? null,
    });
  }
  return { season, week, teams, found: true };
}

/** Timestamp of the latest ingest, from ratings.retrieved_at. */
export async function getLastUpdated(): Promise<string | null> {
  "use cache";
  cacheLife("max");
  cacheTag(RANKINGS_TAG);
  const db = createAdminDb();
  const { data, error } = await db.from("ratings").select("retrieved_at").order("retrieved_at", { ascending: false }).limit(1);
  if (error) throw new Error(`ratings: ${error.message}`);
  return data?.[0]?.retrieved_at ?? null;
}

