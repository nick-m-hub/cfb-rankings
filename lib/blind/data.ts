// Server-side data for the blind ranking page. Cards are built from the latest rankings week and cached
// with the rankings tag, so each ingest refreshes them. Team names live only in `info`, which the page
// never passes to the client: the results route serves it after the visitor has finished ranking.

import { cacheLife, cacheTag } from "next/cache";
import { createAdminDb } from "../ingest/db";
import { getLatestWeek, getWeekData, RANKINGS_TAG } from "../rankings/data";
import { buildFeatures } from "./features";
import { isG6 } from "../g6";
import { g6Records } from "./g6";
import { matchBlend, type BlendMatch } from "./blend";
import { fitCrowd, sessionWeights } from "./model";
import { rankWith, type VoteGroup } from "./fit";
import { CROWD_TAG, MIN_CROWD_VOTES } from "./constants";
import { meanOrNull, rankBy, weightedMean } from "./stats";
import type { GameSummary } from "../models/run";
import type { BlindCard, OpponentTier, Vote } from "./types";

export interface BlindTeamInfo {
  id: number;
  name: string;
  conference: string | null;
  /** Logo and accent color: identifying, so only ever served with the name (never on a card). */
  cfbdId?: number;
  color?: string | null;
  resumeRank: number | null;
  bestRank: number | null;
  /** Composite z-scores the rankings slider blends; revealed with names, used for "Your blend". Never on a card. */
  zPred: number | null;
  zResume: number | null;
}

export interface BlindData {
  season: number;
  week: number;
  cards: BlindCard[];
  info: BlindTeamInfo[];
}

interface GameRow {
  id: number;
  home_postgame_wp: number | null;
  away_postgame_wp: number | null;
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
}

async function completedGames(season: number, week: number): Promise<GameRow[]> {
  const db = createAdminDb();
  const out: GameRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("games")
      .select("id, home_team_id, away_team_id, home_points, away_points, home_postgame_wp, away_postgame_wp")
      .eq("season", season)
      .lte("week", week)
      .eq("completed", true)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`games: ${error.message}`);
    out.push(...(data as GameRow[]));
    if (data.length < 1000) return out;
  }
}

interface StatRow {
  team_id: number;
  plays: number;
  off_ppa: number | null;
  def_ppa: number | null;
  def_plays: number | null;
}

/** Per team-game EPA rows for the given games (chunked: the `in` filter rides in the URL). */
async function gameStatsFor(gameIds: readonly number[]): Promise<StatRow[]> {
  const db = createAdminDb();
  const out: StatRow[] = [];
  for (let i = 0; i < gameIds.length; i += 300) {
    const chunk = gameIds.slice(i, i + 300);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("game_team_stats")
        .select("team_id, plays, off_ppa, def_ppa, def_plays")
        .in("game_id", chunk)
        .order("game_id")
        .order("team_id")
        .range(from, from + 999);
      if (error) throw new Error(`game_team_stats: ${error.message}`);
      out.push(...(data as StatRow[]));
      if (data.length < 1000) break;
    }
  }
  return out;
}

/** Cards and reveal info for the latest stored week; null before the first backfill. */
export async function getBlindData(): Promise<BlindData | null> {
  "use cache";
  cacheLife("max");
  cacheTag(RANKINGS_TAG);
  const latest = await getLatestWeek();
  if (!latest) return null;
  return getBlindWeek(latest.season, latest.week);
}

/** Cards and reveal info as of one stored week (the season-long crowd scores each vote against its week). */
export async function getBlindWeek(season: number, week: number): Promise<BlindData | null> {
  "use cache";
  cacheLife("max");
  cacheTag(RANKINGS_TAG);
  const latest = { season, week };
  const [data, games] = await Promise.all([
    getWeekData(latest.season, latest.week),
    completedGames(latest.season, latest.week),
  ]);
  if (!data.found) return null;
  const statRows = new Map<number, StatRow[]>();
  // Stats exist only for games with an FBS side; skip FCS-vs-FCS games (stored for the FCS ratings).
  const fbsIds = new Set(data.teams.map((t) => t.id));
  const fbsGameIds = games.filter((g) => fbsIds.has(g.home_team_id) || fbsIds.has(g.away_team_id)).map((g) => g.id);
  for (const r of await gameStatsFor(fbsGameIds)) statRows.set(r.team_id, [...(statRows.get(r.team_id) ?? []), r]);

  // Records for every team that appears in a game (FCS opponents included, for opponent tiers).
  const rec = new Map<number, { w: number; l: number }>();
  const add = (id: number, won: boolean) => {
    const r = rec.get(id) ?? { w: 0, l: 0 };
    if (won) r.w++;
    else r.l++;
    rec.set(id, r);
  };
  interface Line {
    pf: number;
    pa: number;
    wp: number | null;
  }
  const lines = new Map<number, Line[]>();
  for (const g of games) {
    if (g.home_points === null || g.away_points === null || g.home_points === g.away_points) continue;
    const homeWon = g.home_points > g.away_points;
    add(g.home_team_id, homeWon);
    add(g.away_team_id, !homeWon);
    const push = (id: number, l: Line) => lines.set(id, [...(lines.get(id) ?? []), l]);
    push(g.home_team_id, { pf: g.home_points, pa: g.away_points, wp: g.home_postgame_wp });
    push(g.away_team_id, { pf: g.away_points, pa: g.home_points, wp: g.away_postgame_wp });
  }
  // The card shows the opponent only as a record. WHICH opponent is the model's call: the best team beaten
  // and worst team lost to by best-team rating (see bestWinWorstLoss), the same game the rankings page shows.
  const tier = (g: GameSummary | null | undefined): OpponentTier | null => {
    if (!g || g.opponentId === undefined) return null;
    const r = rec.get(g.opponentId) ?? { w: 0, l: 0 };
    return { wins: r.w, losses: r.l, fbs: fbsIds.has(g.opponentId), site: g.site };
  };

  const g6Ids = new Set(data.teams.filter((t) => isG6(t.conference, t.name, latest.season)).map((t) => t.id));
  const g6 = g6Records(
    games.map((g) => ({
      homeId: g.home_team_id,
      awayId: g.away_team_id,
      homePoints: g.home_points,
      awayPoints: g.away_points,
      homePostgameWp: g.home_postgame_wp,
      awayPostgameWp: g.away_postgame_wp,
    })),
    g6Ids,
  );

  const cards: BlindCard[] = [];
  const info: BlindTeamInfo[] = [];
  for (const t of data.teams) {
    const ls = lines.get(t.id) ?? [];
    const n = ls.length;
    if (n === 0) continue;
    const pf = ls.reduce((a, l) => a + l.pf, 0);
    const pa = ls.reduce((a, l) => a + l.pa, 0);
    const stats = statRows.get(t.id) ?? [];
    cards.push({
      id: t.id,
      wins: t.wins,
      losses: t.losses,
      games: n,
      margin: (pf - pa) / n,
      sos: t.details?.sos?.winPct ?? null,
      sosRank: t.details?.sos?.rank ?? null,
      offEpa: weightedMean(stats.map((r) => ({ value: r.off_ppa, weight: r.plays }))),
      defEpa: weightedMean(stats.map((r) => ({ value: r.def_ppa, weight: r.def_plays ?? 0 }))),
      offEpaRank: null, // ranks are filled in below, once every team's value is known
      defEpaRank: null,
      postgameWp: meanOrNull(ls.map((l) => l.wp)),
      bestWin: tier(t.details?.resume.bestWin),
      worstLoss: tier(t.details?.resume.worstLoss),
      quadrants: t.details?.quadrants ?? null,
      g6Record: g6.has(t.id) ? { w: g6.get(t.id)!.w, l: g6.get(t.id)!.l } : null,
      g6PostgameWp: g6.get(t.id)?.postgameWp ?? null,
      g6Margin: g6.get(t.id)?.margin ?? null,
    });
    info.push({
      id: t.id,
      name: t.name,
      conference: t.conference,
      cfbdId: t.cfbdId,
      color: t.color ?? null,
      resumeRank: t.details?.resume.rank ?? null,
      bestRank: t.details?.best.rank ?? null,
      zPred: t.zPred,
      zResume: t.zResume,
    });
  }
  const offRanks = rankBy(new Map(cards.map((c) => [c.id, c.offEpa])), "high");
  const defRanks = rankBy(new Map(cards.map((c) => [c.id, c.defEpa])), "low");
  for (const c of cards) {
    c.offEpaRank = offRanks.get(c.id) ?? null;
    c.defEpaRank = defRanks.get(c.id) ?? null;
  }
  return { season: latest.season, week: latest.week, cards, info };
}

export interface CrowdRanking {
  /** Votes cast this season (before the per-session cap). */
  votes: number;
  /** Team id -> crowd rank (1 = best); null until MIN_CROWD_VOTES capped votes have been cast this season. */
  ranks: Record<number, number> | null;
  /** Where the season's crowd votes sit on the rankings slider (session-capped like the ranking); null with `ranks`. */
  blend: Pick<BlendMatch, "blend" | "low" | "high"> | null;
}

/**
 * Season-long crowd ranking. Every vote this season refines what the crowd values (the stat weights), each
 * judged against the cards of the week it was cast in, and the current week's cards are ranked with those
 * weights. Team-specific offsets come only from votes on the current week's cards: a past week's card no longer
 * describes the team. Each session counts as at most CROWD_SESSION_CAP votes per card week.
 */
export async function getCrowdRanking(season: number, week: number): Promise<CrowdRanking> {
  "use cache";
  cacheLife("minutes");
  cacheTag(CROWD_TAG);
  const db = createAdminDb();
  const byWeek = new Map<number, { votes: Vote[]; sessions: string[] }>();
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("blind_votes")
      .select("first, second, third, session_id, week")
      .eq("season", season)
      .lte("week", week)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`blind_votes: ${error.message}`);
    for (const r of data) {
      const g = byWeek.get(r.week) ?? { votes: [], sessions: [] };
      g.votes.push([r.first, r.second, r.third]);
      g.sessions.push(r.session_id);
      byWeek.set(r.week, g);
      total++;
    }
    if (data.length < 1000) break;
  }
  const none = { votes: total, ranks: null, blend: null };
  // The threshold counts capped votes, so a single heavy voter can't unlock the crowd ranking alone.
  const weightsByWeek = new Map([...byWeek].map(([w, g]) => [w, sessionWeights(g.sessions)]));
  const capped = [...weightsByWeek.values()].flat().reduce((a, b) => a + b, 0);
  if (capped < MIN_CROWD_VOTES) return none;

  const weeks = [...new Set([...byWeek.keys(), week])].sort((a, b) => a - b);
  const cardWeeks = new Map(
    (await Promise.all(weeks.map(async (w) => [w, await getBlindWeek(season, w)] as const))).filter(
      (e): e is readonly [number, BlindData] => e[1] !== null,
    ),
  );
  const current = cardWeeks.get(week);
  if (!current) return none;

  const groups: VoteGroup[] = [];
  const votes: Vote[] = [];
  const voteWeights: number[] = [];
  const voteZ: Map<number, BlindTeamInfo>[] = [];
  for (const [w, g] of byWeek) {
    const cards = cardWeeks.get(w);
    if (!cards) continue;
    const f = buildFeatures(cards.cards);
    groups.push({ ids: f.ids, features: f.rows, votes: g.votes, voteWeights: weightsByWeek.get(w), offsets: w === week });
    const z = new Map(cards.info.map((t) => [t.id, t]));
    g.votes.forEach((v, i) => {
      votes.push(v);
      voteWeights.push(weightsByWeek.get(w)![i]);
      voteZ.push(z);
    });
  }
  const cur = buildFeatures(current.cards);
  const fit = fitCrowd(groups);
  const ranks = rankWith(cur.ids, cur.rows, fit).ranks;
  const m = matchBlend(votes, new Map(), { voteWeights, voteZ });
  const blend = m && { blend: m.blend, low: m.low, high: m.high };
  return { votes: total, ranks: Object.fromEntries(ranks), blend };
}
