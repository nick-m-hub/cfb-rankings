// Strength of schedule from on-field results.
//
// For each team T we ask: how often would a playoff-cut team (the 12th-best FBS rating, the same benchmark
// as the resume model) win T's games? Each opponent is rated by
// the best-team model's overall fit (opponent-adjusted margins, with a preseason prior that fades as
// results come in), converted to a win chance for an average team, adjusted for who hosted. FCS
// opponents are the model's pooled FCS team, rated from actual FBS-vs-FCS results (no stand-in value).
//
// Leave-one-out: the ratings used for T's schedule are fit WITHOUT any of T's games. Otherwise an
// opponent's rating already contains the result against T (beat a team by 40 and it looks weak, which
// makes your own schedule look easy). Lower average win chance = harder schedule.
//
// Why a top-12 benchmark rather than an average team: for an average team, a schedule of mid-pack opponents
// looks hard; for a contender it doesn't, and what separates schedules is how many strong teams are on
// them. Using the resume model's benchmark keeps "schedule strength" and "most deserving" on one scale.

import { computeBestRatings } from "./best";
import { RESUME_PARAMS } from "./resume";
import { normCdf } from "./math";
import type { ModelGame, PriorInput, TeamGameStat } from "./types";

/**
 * Spread of game margins around the model's prediction, in points. The model's measured average miss
 * is 12.4 points (see /methodology); for a normal distribution sd = mean absolute miss * sqrt(pi / 2).
 */
export const SOS_SD = 15.5;

export interface SosOptions {
  /** Default true. False uses one shared fit (ratings include the result against each team). */
  leaveOneOut?: boolean;
  /** Benchmark team: the Nth-best FBS rating in the fit (default: the resume model's, 12). */
  benchmarkRank?: number;
}

/** W-L against one quadrant of opponents. */
export interface QuadrantRecord {
  w: number;
  l: number;
}

/**
 * Quadrant edges for a HOME game: the lowest opponent rank that still counts as Q1 / Q2 / Q3, out of
 * 136 FBS teams (scaled to the actual count). Neutral and road bands follow from home field: the edge is
 * a rating, so a road opponent clears it with `hfa` points to spare (Q1 reaches ~#33 on the road).
 * Chosen 2026-11-06 (Nick): bands widen toward the bottom, like basketball's NET quadrants.
 */
export const HOME_QUADRANT_RANKS = [15, 40, 75] as const;
const QUADRANT_REFERENCE_TEAMS = 136;

/**
 * Site-adjusted rating cutoffs for quadrants 1-3: the FBS ratings at the home-band ranks, minus home field
 * (a home opponent's rating is compared after subtracting `hfa`). `ratings` should exclude the team itself.
 */
export function quadrantCutoffs(ratings: readonly number[], hfa: number): [number, number, number] {
  const sorted = [...ratings].sort((a, b) => b - a);
  const n = sorted.length;
  const at = (rank: number) => {
    if (!n) return 0;
    const k = Math.min(n, Math.max(1, Math.round((rank * n) / QUADRANT_REFERENCE_TEAMS)));
    return sorted[k - 1] - hfa;
  };
  const [a, b, c] = HOME_QUADRANT_RANKS;
  return [at(a), at(b), at(c)];
}

/** 0-based quadrant (0 = Q1, hardest) for a site-adjusted opponent rating. */
export function quadrantOf(effRating: number, cutoffs: readonly [number, number, number]): number {
  if (effRating >= cutoffs[0]) return 0;
  if (effRating >= cutoffs[1]) return 1;
  if (effRating >= cutoffs[2]) return 2;
  return 3;
}

export interface Schedule {
  /** Benchmark team's expected win rate against each team's schedule (lower = harder). */
  winPct: Map<number, number>;
  /**
   * Record against each quadrant [Q1, Q2, Q3, Q4] of opponents, by the same leave-one-out ratings.
   * Home bands are opponent ranks 1-15 / 16-40 / 41-75 / 76+ (HOME_QUADRANT_RANKS); opponent ratings are
   * site-adjusted, so neutral and road bands reach further down (about 21/52/85 and 33/63/100), like
   * basketball's NET quadrants. FCS opponents are placed by their own rating.
   * Scoreboard ties count in neither column.
   */
  quadrants: Map<number, QuadrantRecord[]>;
}

/** Schedule strength and quadrant records; both use one fit per team. Teams with no games are absent. */
export function computeSchedule(
  games: readonly ModelGame[],
  fbsIds: ReadonlySet<number>,
  priors: ReadonlyMap<number, PriorInput>,
  stats: readonly TeamGameStat[] = [],
  opts: SosOptions = {},
): Schedule {
  const leaveOneOut = opts.leaveOneOut ?? true;
  const nth = opts.benchmarkRank ?? RESUME_PARAMS.benchmarkRank;
  const played = games.filter((g) => fbsIds.has(g.homeId) || fbsIds.has(g.awayId));
  const byTeam = new Map<number, ModelGame[]>();
  for (const g of played) {
    for (const id of [g.homeId, g.awayId]) {
      if (fbsIds.has(id)) byTeam.set(id, [...(byTeam.get(id) ?? []), g]);
    }
  }
  const shared = leaveOneOut ? null : computeBestRatings(played, fbsIds, priors, stats);

  const winPct = new Map<number, number>();
  const quadrants = new Map<number, QuadrantRecord[]>();
  for (const [teamId, teamGames] of byTeam) {
    const fit = shared ?? computeBestRatings(played.filter((g) => g.homeId !== teamId && g.awayId !== teamId), fbsIds, priors, stats);
    // FBS ratings in this fit, not counting the team itself (whose own games may be left out).
    const others = [...fit.ratings].filter(([id]) => id !== teamId).map(([, r]) => r).sort((a, b) => b - a);
    const bench = others.length ? others[Math.min(nth, others.length) - 1] : 0;
    const cutoffs = quadrantCutoffs(others, fit.hfa);
    const quad: QuadrantRecord[] = [0, 1, 2, 3].map(() => ({ w: 0, l: 0 }));
    let total = 0;
    for (const g of teamGames) {
      const home = g.homeId === teamId;
      const opp = home ? g.awayId : g.homeId;
      const oppRating = fbsIds.has(opp) ? fit.ratings.get(opp)! : (fit.fcsRatings.get(opp) ?? fit.fcsRating);
      // The team's edge from the site: positive at home.
      const site = g.neutral ? 0 : home ? fit.hfa : -fit.hfa;
      // Expected margin for the benchmark team standing in this team's place.
      total += normCdf((bench + site - oppRating) / SOS_SD);
      const pf = home ? g.homePoints : g.awayPoints;
      const pa = home ? g.awayPoints : g.homePoints;
      if (pf !== pa) {
        const q = quad[quadrantOf(oppRating - site, cutoffs)];
        if (pf > pa) q.w++;
        else q.l++;
      }
    }
    winPct.set(teamId, total / teamGames.length);
    quadrants.set(teamId, quad);
  }
  return { winPct, quadrants };
}

/** Benchmark team's expected win rate against each team's schedule so far. Teams with no games are absent. */
export function computeSos(
  games: readonly ModelGame[],
  fbsIds: ReadonlySet<number>,
  priors: ReadonlyMap<number, PriorInput>,
  stats: readonly TeamGameStat[] = [],
  opts: SosOptions = {},
): Map<number, number> {
  return computeSchedule(games, fbsIds, priors, stats, opts).winPct;
}

/** 1 = hardest schedule (lowest expected win rate). Ties break by id. */
export function sosRanks(winPct: ReadonlyMap<number, number>): Map<number, number> {
  const order = [...winPct].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return new Map(order.map(([id], i) => [id, i + 1]));
}
