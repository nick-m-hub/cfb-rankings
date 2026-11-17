// DB glue for the in-house models: loads a season's inputs once, then scores any week of it.
// Writes model ratings into `ratings` (so z-scores and composites work unchanged) and per-team
// display details into `model_details`. Idempotent upserts.

import type { Db } from "../ingest/db";
import { upsertRows } from "../ingest/db";
import { computeBest } from "./best";
import { bestWinWorstLoss, computeResume, RATING_TIE_TOLERANCE, RESUME_PARAMS } from "./resume";
import { computeSchedule, sosRanks, type QuadrantRecord } from "./sos";
import type { GameCredit, ModelGame, PriorInput, TeamGameStat } from "./types";

export const MODEL_SYSTEMS = { resume: "Resume Model", best: "Best-Team Model" } as const;

export interface ModelSeason {
  season: number;
  fbsIds: Set<number>;
  games: ModelGame[];
  stats: TeamGameStat[];
  priors: Map<number, PriorInput>;
  names: Map<number, string>;
}

type Query = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Page through a filtered select (PostgREST caps responses at 1,000 rows). */
async function pages<T>(make: (from: number, to: number) => Query, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = data as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function loadModelSeason(db: Db, season: number): Promise<ModelSeason> {
  const membership = await pages<{ team_id: number }>(
    (a, b) => db.from("team_seasons").select("team_id").eq("season", season).eq("division", "fbs").order("team_id").range(a, b),
    "team_seasons",
  );
  let fbs = membership.map((r) => r.team_id);
  if (fbs.length === 0) {
    // Season not re-ingested since team_seasons was added: fall back to current membership.
    const cur = await pages<{ id: number }>((a, b) => db.from("teams").select("id").eq("division", "fbs").order("id").range(a, b), "teams");
    fbs = cur.map((r) => r.id);
  }

  const gameRows = await pages<{
    id: number;
    week: number;
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
    neutral_site: boolean;
    completed: boolean;
  }>(
    (a, b) =>
      db
        .from("games")
        .select("id, week, home_team_id, away_team_id, home_points, away_points, neutral_site, completed")
        .eq("season", season)
        .order("id")
        .range(a, b),
    "games",
  );
  const games: ModelGame[] = gameRows
    .filter((g) => g.completed && g.home_points !== null && g.away_points !== null && g.home_points !== g.away_points)
    .map((g) => ({
      id: g.id,
      week: g.week,
      homeId: g.home_team_id,
      awayId: g.away_team_id,
      homePoints: g.home_points!,
      awayPoints: g.away_points!,
      neutral: g.neutral_site,
    }));

  const stats: TeamGameStat[] = [];
  const ids = games.map((g) => g.id);
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const rows = await pages<{ game_id: number; team_id: number; plays: number; success_rate: number }>(
      (a, b) => db.from("game_team_stats").select("game_id, team_id, plays, success_rate").in("game_id", chunk).order("game_id").range(a, b),
      "game_team_stats",
    );
    stats.push(...rows.map((r) => ({ gameId: r.game_id, teamId: r.team_id, plays: r.plays, successRate: r.success_rate })));
  }

  // Prior: last season's final FPI (latest stored week) plus returning production and talent.
  const { data: fpiSys, error: sysErr } = await db.from("systems").select("id").eq("name", "FPI").single();
  if (sysErr) throw new Error(`systems FPI: ${sysErr.message}`);
  const fpiRows = await pages<{ team_id: number; week: number; raw_value: number }>(
    (a, b) =>
      db
        .from("ratings")
        .select("team_id, week, raw_value")
        .eq("system_id", (fpiSys as { id: number }).id)
        .eq("season", season - 1)
        .order("week")
        .order("team_id")
        .range(a, b),
    "ratings FPI",
  );
  const prevFpi = new Map<number, { week: number; v: number }>();
  for (const r of fpiRows) {
    const cur = prevFpi.get(r.team_id);
    if (!cur || r.week > cur.week) prevFpi.set(r.team_id, { week: r.week, v: r.raw_value });
  }
  const inputs = await pages<{ team_id: number; returning_ppa_pct: number | null; talent: number | null }>(
    (a, b) => db.from("team_season_inputs").select("team_id, returning_ppa_pct, talent").eq("season", season).order("team_id").range(a, b),
    "team_season_inputs",
  );
  const inputBy = new Map(inputs.map((r) => [r.team_id, r]));
  const priors = new Map<number, PriorInput>(
    fbs.map((id) => [
      id,
      {
        prevFpi: prevFpi.get(id)?.v ?? null,
        returningPpa: inputBy.get(id)?.returning_ppa_pct ?? null,
        talent: inputBy.get(id)?.talent ?? null,
      },
    ]),
  );

  const teamRows = await pages<{ id: number; name: string }>((a, b) => db.from("teams").select("id, name").order("id").range(a, b), "teams");
  return { season, fbsIds: new Set(fbs), games, stats, priors, names: new Map(teamRows.map((t) => [t.id, t.name])) };
}

/** Last week with a completed game, or 0. */
export function lastPlayedWeek(data: ModelSeason): number {
  return data.games.reduce((m, g) => Math.max(m, g.week), 0);
}

export interface GameSummary {
  week: number;
  /** Absent on weeks computed before it was stored. */
  opponentId?: number;
  opponent: string;
  site: GameCredit["site"];
  score: string;
  credit: number;
}

export interface ModelDetails {
  resume: {
    score: number;
    rank: number;
    topOdds: number;
    rankRange: [number, number];
    bestWin: GameSummary | null;
    worstLoss: GameSummary | null;
  };
  best: {
    rating: number;
    rank: number;
    offense: number;
    offenseRank: number;
    defense: number;
    defenseRank: number;
    resultsOnlyRank: number;
    prior: number | null;
    offSuccessRateRank: number | null;
    defSuccessRateRank: number | null;
  };
  /**
   * Schedule strength so far: how often a top-12 FBS team would win these games (lower = harder),
   * from leave-one-out ratings (see sos.ts). Absent on weeks computed before it existed.
   */
  sos?: { winPct: number; rank: number };
  /**
   * Record against quadrants [Q1..Q4] of opponents (site-adjusted, leave-one-out best-team ratings; see
   * computeSchedule in sos.ts). Absent on weeks computed before it existed.
   */
  quadrants?: QuadrantRecord[];
}

function ranks(values: Map<number, number>): Map<number, number> {
  const order = [...values].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return new Map(order.map(([id], i) => [id, i + 1]));
}

/** Score one week (games through `week`). Pure apart from reading `data`. */
export function scoreWeek(data: ModelSeason, week: number, sims = RESUME_PARAMS.sims) {
  const games = data.games.filter((g) => g.week <= week);
  const gameIds = new Set(games.map((g) => g.id));
  const stats = data.stats.filter((s) => gameIds.has(s.gameId));
  const resume = computeResume(games, data.fbsIds, { sims });
  const best = computeBest(games, data.fbsIds, data.priors, stats);
  const schedule = computeSchedule(games, data.fbsIds, data.priors, stats);
  const sosWinPct = schedule.winPct;
  const sosRank = sosRanks(sosWinPct);

  const rankBy = <T>(m: Map<number, T>, f: (t: T) => number | null) => {
    const vals = new Map<number, number>();
    for (const [id, t] of m) {
      const v = f(t);
      if (v !== null) vals.set(id, v);
    }
    return ranks(vals);
  };
  const resumeRank = rankBy(resume.teams, (t) => t.score);
  const bestRank = rankBy(best.teams, (t) => t.rating);
  const offRank = rankBy(best.teams, (t) => t.offense);
  const defRank = rankBy(best.teams, (t) => t.defense);
  const resultsRank = rankBy(best.teams, (t) => t.ratingResultsOnly);
  const offSr = rankBy(best.teams, (t) => t.offSuccessRate);
  // Defense success rate is the rate allowed: lower is better.
  const defSr = rankBy(best.teams, (t) => (t.defSuccessRate === null ? null : -t.defSuccessRate));

  // Opponent strength for best win / worst loss: our best-team rating, with FCS opponents at the pooled FCS rating.
  const strengthOf = (id: number) => best.teams.get(id)?.rating ?? best.fcsRatings.get(id) ?? best.fcsRating;
  // Opponents within a few rating points are tied, and their record settles it (decided games only).
  const record = new Map<number, { w: number; l: number }>();
  for (const g of games) {
    if (g.homePoints === g.awayPoints) continue;
    const homeWon = g.homePoints > g.awayPoints;
    for (const [id, won] of [[g.homeId, homeWon], [g.awayId, !homeWon]] as const) {
      const r = record.get(id) ?? { w: 0, l: 0 };
      if (won) r.w++;
      else r.l++;
      record.set(id, r);
    }
  }
  const recordOf = (id: number) => {
    const r = record.get(id);
    return r && r.w + r.l > 0 ? r.w / (r.w + r.l) : 0.5;
  };
  const summary = (g: GameCredit | null): GameSummary | null =>
    g && {
      week: g.week,
      opponentId: g.opponentId,
      opponent: data.names.get(g.opponentId) ?? `#${g.opponentId}`,
      site: g.site,
      score: `${g.pointsFor}-${g.pointsAgainst}`,
      credit: g.credit,
    };

  const details = new Map<number, ModelDetails>();
  for (const id of data.fbsIds) {
    const r = resume.teams.get(id);
    const b = best.teams.get(id);
    if (!r || !b) continue;
    const { bestWin, worstLoss } = bestWinWorstLoss(r.games, strengthOf, { tolerance: RATING_TIE_TOLERANCE, recordOf });
    details.set(id, {
      resume: { score: r.score, rank: resumeRank.get(id)!, topOdds: r.topOdds, rankRange: r.rankRange, bestWin: summary(bestWin), worstLoss: summary(worstLoss) },
      best: {
        rating: b.rating,
        rank: bestRank.get(id)!,
        offense: b.offense,
        offenseRank: offRank.get(id)!,
        defense: b.defense,
        defenseRank: defRank.get(id)!,
        resultsOnlyRank: resultsRank.get(id)!,
        prior: b.prior,
        offSuccessRateRank: offSr.get(id) ?? null,
        defSuccessRateRank: defSr.get(id) ?? null,
      },
      ...(sosWinPct.has(id) ? { sos: { winPct: sosWinPct.get(id)!, rank: sosRank.get(id)! } } : {}),
      ...(schedule.quadrants.has(id) ? { quadrants: schedule.quadrants.get(id)! } : {}),
    });
  }
  return { resume, best, details };
}

/** Score a week and upsert model ratings + details. */
export async function storeModelWeek(db: Db, data: ModelSeason, week: number, sims?: number) {
  const { resume, best, details } = scoreWeek(data, week, sims);
  const { data: sys, error } = await db.from("systems").select("id, name").in("name", Object.values(MODEL_SYSTEMS));
  if (error) throw new Error(`systems: ${error.message}`);
  const idOf = (name: string) => {
    const s = (sys as { id: number; name: string }[]).find((x) => x.name === name);
    if (!s) throw new Error(`System "${name}" missing: apply supabase/migrations/20261106000000_models.sql`);
    return s.id;
  };
  const rows = [
    ...[...resume.teams.values()].map((t) => ({ system_id: idOf(MODEL_SYSTEMS.resume), team_id: t.teamId, season: data.season, week, raw_value: t.score })),
    ...[...best.teams.values()].map((t) => ({ system_id: idOf(MODEL_SYSTEMS.best), team_id: t.teamId, season: data.season, week, raw_value: t.rating })),
  ];
  await upsertRows(db, "ratings", rows, "system_id,team_id,season,week");
  await upsertRows(
    db,
    "model_details",
    [...details].map(([team_id, d]) => ({ season: data.season, week, team_id, details: d })),
    "season,week,team_id",
  );
  return { teams: details.size };
}
