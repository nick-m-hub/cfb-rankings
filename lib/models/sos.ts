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

/** Benchmark team's expected win rate against each team's schedule so far. Teams with no games are absent. */
export function computeSos(
  games: readonly ModelGame[],
  fbsIds: ReadonlySet<number>,
  priors: ReadonlyMap<number, PriorInput>,
  stats: readonly TeamGameStat[] = [],
  opts: SosOptions = {},
): Map<number, number> {
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

  /** Nth-best FBS rating in a fit, not counting the team itself (whose own games may be left out). */
  const benchOf = (ratings: ReadonlyMap<number, number>, self: number) => {
    const others = [...ratings].filter(([id]) => id !== self).map(([, r]) => r).sort((a, b) => b - a);
    return others.length ? others[Math.min(nth, others.length) - 1] : 0;
  };
  const out = new Map<number, number>();
  for (const [teamId, teamGames] of byTeam) {
    const fit = shared ?? computeBestRatings(played.filter((g) => g.homeId !== teamId && g.awayId !== teamId), fbsIds, priors, stats);
    let total = 0;
    for (const g of teamGames) {
      const home = g.homeId === teamId;
      const opp = home ? g.awayId : g.homeId;
      const oppRating = fbsIds.has(opp) ? fit.ratings.get(opp)! : (fit.fcsRatings.get(opp) ?? fit.fcsRating);
      // Expected margin for the benchmark team standing in this team's place.
      const site = g.neutral ? 0 : home ? fit.hfa : -fit.hfa;
      total += normCdf((benchOf(fit.ratings, teamId) + site - oppRating) / SOS_SD);
    }
    out.set(teamId, total / teamGames.length);
  }
  return out;
}

/** 1 = hardest schedule (lowest expected win rate). Ties break by id. */
export function sosRanks(winPct: ReadonlyMap<number, number>): Map<number, number> {
  const order = [...winPct].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return new Map(order.map(([id], i) => [id, i + 1]));
}
