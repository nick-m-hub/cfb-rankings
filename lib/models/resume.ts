// Resume ("most deserving") model. Tuned in the CFB Fun notebook (Nov 2026):
//  1. Rate every team from this season's capped margins (ridge regression, fitted home field,
//     FCS opponents pooled as one team). No preseason priors.
//  2. For each game, estimate the chance a benchmark team (the Nth-best FBS rating) would have won it
//     at the same site. Credit = result (1/0) − that chance. Opponents are rated without the team's own
//     games (leave-one-out), so a team's own margin never matters.
//  3. Resume score = sum of credits. Simulating rating uncertainty gives top-N odds and a rank range.

import { buildDesign } from "./design";
import { gaussian, mean, normCdf, percentile, ridge, seededRandom, choleskyInverse, cholesky } from "./math";
import type { GameCredit, ModelGame } from "./types";

export interface ResumeParams {
  cap: number;
  ridge: number;
  sigma: number;
  benchmarkRank: number;
  sims: number;
  seed: number;
  /** Rate each team's opponents without its own games (default true; false = the notebook's shared fit). */
  leaveOneOut: boolean;
  /** Ridge pulling each FCS team toward the FCS average (Infinity = every FCS team is the average). */
  fcsRidge: number;
}

export const RESUME_PARAMS: ResumeParams = {
  /** Margins capped at ±cap when rating opponents. */
  cap: 21,
  /** Ridge penalty on team ratings (shrinks toward average). Tuned by leave-one-out. */
  ridge: 1,
  /** Win-probability spread in points, calibrated by leave-one-out probit fit. */
  sigma: 11.4,
  /** Benchmark = the Nth-best FBS rating (12 = the playoff cut line). */
  benchmarkRank: 12,
  /** Simulations of rating uncertainty for top-N odds. */
  sims: 1000,
  seed: 7,
  leaveOneOut: true,
  /** Same shrinkage as the best-team model (where it was tuned). */
  fcsRidge: 2,
};

export interface ResumeTeam {
  teamId: number;
  score: number;
  /** Share of simulations finishing in the top `benchmarkRank`. */
  topOdds: number;
  /** 10th–90th percentile rank across simulations. */
  rankRange: [number, number];
  /** This team's own opponent-strength rating (points vs average FBS). */
  rating: number;
  games: GameCredit[];
}

export interface ResumeResult {
  hfa: number;
  benchmarkRating: number;
  fcsRating: number;
  teams: Map<number, ResumeTeam>;
}

export function computeResume(
  games: readonly ModelGame[],
  fbsIds: ReadonlySet<number>,
  params: Partial<ResumeParams> = {},
): ResumeResult {
  const p = { ...RESUME_PARAMS, ...params };
  const d = buildDesign(games, fbsIds, p.fcsRidge);
  const { fbs, used, rows, H } = d;
  const y = used.map((g) => Math.max(-p.cap, Math.min(p.cap, g.homePoints - g.awayPoints)));
  const byTeam = new Map<number, ModelGame[]>();
  for (const g of used) for (const id of [g.homeId, g.awayId]) if (fbsIds.has(id)) byTeam.set(id, [...(byTeam.get(id) ?? []), g]);
  const lambda = d.lambda(p.ridge, p.ridge, p.fcsRidge);

  if (used.length === 0) {
    return { hfa: 0, benchmarkRating: 0, fcsRating: 0, teams: new Map(fbs.map((id) => [id, emptyTeam(id)])) };
  }
  const { beta, chol } = ridge(rows, y, d.nCols, lambda);
  const hfa = beta[H];
  const nth = Math.min(p.benchmarkRank, fbs.length) - 1;
  /** The benchmark (Nth-best FBS rating) of a coefficient vector, relative to `center`. */
  const benchOf = (b: readonly number[], center: number) => [...b.slice(0, fbs.length)].sort((x, z) => z - x)[nth] - center;

  /** One team's game credits, with opponents rated from coefficients `b` (centered on `center`). */
  const creditsFor = (me: number, b: readonly number[], center: number, h: number, bench: number): GameCredit[] => {
    const out: GameCredit[] = [];
    for (const g of byTeam.get(me) ?? []) {
      const side = g.homeId === me ? "home" : "away";
      const opp = side === "home" ? g.awayId : g.homeId;
      const site = g.neutral ? "neutral" : side;
      const adj = site === "neutral" ? 0 : site === "home" ? h : -h;
      const prob = normCdf((bench - d.ratingOf(b, opp, center) + adj) / p.sigma);
      const pf = side === "home" ? g.homePoints : g.awayPoints;
      const pa = side === "home" ? g.awayPoints : g.homePoints;
      const won = pf > pa;
      out.push({ gameId: g.id, week: g.week, opponentId: opp, site, pointsFor: pf, pointsAgainst: pa, won, benchmarkWinProb: prob, credit: (won ? 1 : 0) - prob });
    }
    return out;
  };
  const sum = (cs: readonly GameCredit[]) => cs.reduce((t, c) => t + c.credit, 0);
  const scoreAll = (b: readonly number[]) => {
    const m = d.fbsMean(b);
    const bench = benchOf(b, m);
    return new Map(fbs.map((id) => [id, sum(creditsFor(id, b, m, b[H], bench))]));
  };

  // Leave-one-out: a team's opponents (and home field) are rated WITHOUT its own games, so a blowout win
  // doesn't make the beaten team look weaker and shrink the winner's credit (same idea as sos.ts). The
  // benchmark stays the full fit's Nth-best rating; both fits are centered on the other FBS teams' mean.
  const fbsMean = d.fbsMean(beta);
  const credits = new Map<number, GameCredit[]>();
  for (const id of fbs) {
    if (!p.leaveOneOut) {
      credits.set(id, creditsFor(id, beta, fbsMean, hfa, benchOf(beta, fbsMean)));
      continue;
    }
    const bench = benchOf(beta, d.fbsMean(beta, id));
    const keep = used.map((g, i) => (g.homeId === id || g.awayId === id ? -1 : i)).filter((i) => i >= 0);
    const lam = [...lambda];
    // Home-field columns left without home/away games would be singular.
    if (!keep.some((i) => rows[i].some(([c]) => c === H))) lam[H] = 1;
    if (!keep.some((i) => rows[i].some(([c]) => c === d.HF))) lam[d.HF] = 1;
    const loo = ridge(keep.map((i) => rows[i]), keep.map((i) => y[i]), d.nCols, lam).beta;
    credits.set(id, creditsFor(id, loo, d.fbsMean(loo, id), loo[H], bench));
  }
  const bench = benchOf(beta, fbsMean);
  const scores = new Map(fbs.map((id) => [id, sum(credits.get(id)!)]));
  // Simulations draw the full fit's ratings; each team's draw is shifted by its leave-one-out adjustment.
  const fullScores = scoreAll(beta);
  const looShift = new Map(fbs.map((id) => [id, scores.get(id)! - fullScores.get(id)!]));

  // Uncertainty: draw ratings from N(β, s²(XᵀX + Λ)⁻¹) and re-rank.
  const resid = used.map((_, i) => y[i] - rows[i].reduce((s, [c, v]) => s + v * beta[c], 0));
  const rm = mean(resid);
  const s2 = (mean(resid.map((e) => (e - rm) ** 2)) * used.length) / Math.max(used.length - (d.nCols - 2), 1);
  const cov = choleskyInverse(chol).map((row) => row.map((v) => v * s2));
  const L = cholesky(cov.map((row, i) => row.map((v, j) => (i === j ? v + 1e-9 : v))));
  const normal = gaussian(seededRandom(p.seed));
  const top = new Map<number, number>(fbs.map((id) => [id, 0]));
  const ranks = new Map<number, number[]>(fbs.map((id) => [id, []]));
  const z = new Array<number>(d.nCols);
  for (let s = 0; s < p.sims; s++) {
    for (let i = 0; i < d.nCols; i++) z[i] = normal();
    const draw = beta.map((b, i) => {
      let v = b;
      for (let k = 0; k <= i; k++) v += L[i][k] * z[k];
      return v;
    });
    const sim = scoreAll(draw);
    const order = fbs.map((id) => ({ id, sc: sim.get(id)! + looShift.get(id)! })).sort((a, b) => b.sc - a.sc);
    order.forEach(({ id }, i) => {
      ranks.get(id)!.push(i + 1);
      if (i < p.benchmarkRank) top.set(id, top.get(id)! + 1);
    });
  }

  const teams = new Map<number, ResumeTeam>();
  for (const id of fbs) {
    const rk = ranks.get(id)!;
    teams.set(id, {
      teamId: id,
      score: scores.get(id)!,
      topOdds: p.sims > 0 ? top.get(id)! / p.sims : 0,
      rankRange: p.sims > 0 ? [Math.floor(percentile(rk, 10)), Math.floor(percentile(rk, 90))] : [0, 0],
      rating: d.ratingOf(beta, id, fbsMean),
      games: credits.get(id)!,
    });
  }
  return { hfa, benchmarkRating: bench, fcsRating: beta[d.pool] - fbsMean, teams };
}

function emptyTeam(id: number): ResumeTeam {
  return { teamId: id, score: 0, topOdds: 0, rankRange: [0, 0], rating: 0, games: [] };
}

/**
 * Opponents whose ratings are within this many points count as tied when picking best win / worst loss.
 * Ratings mid-season are only good to a few points (a team's rating is uncertain by roughly 4), so
 * ordering teams closer than that is noise.
 */
export const RATING_TIE_TOLERANCE = 4;

export interface WinLossOptions {
  /** Ratings within this many points of the best win's (worst loss's) opponent are tied with it. Default 0. */
  tolerance?: number;
  /** Opponent's win fraction this season (0 to 1). Breaks ties: the better record is the best win, the worse the worst loss. */
  recordOf?: (opponentId: number) => number;
}

/**
 * The best team a team beat and the worst team it lost to, judged by opponent strength (`strengthOf`:
 * higher = better team), which is what people mean by "best win" and "worst loss". Opponents within
 * `tolerance` rating points of the extreme are treated as tied and settled by their record (best win: the
 * better record; worst loss: the worse one), then by rating, then by the earlier game. Tied games count
 * as neither a win nor a loss.
 */
export function bestWinWorstLoss(
  games: readonly GameCredit[],
  strengthOf: (opponentId: number) => number,
  opts: WinLossOptions = {},
): { bestWin: GameCredit | null; worstLoss: GameCredit | null } {
  const tolerance = opts.tolerance ?? 0;
  const recordOf = opts.recordOf ?? (() => 0.5);
  const ordered = [...games].sort((a, b) => a.week - b.week || a.gameId - b.gameId);
  const rated = (pick: (g: GameCredit) => boolean) =>
    ordered.filter(pick).map((g) => ({ g, s: strengthOf(g.opponentId), rec: recordOf(g.opponentId) }));

  const wins = rated((g) => g.pointsFor > g.pointsAgainst);
  const losses = rated((g) => g.pointsFor < g.pointsAgainst);

  // `ordered` is chronological, so on a full tie the first game found (the earlier one) is kept.
  const bestWin = wins.length
    ? (() => {
        const top = Math.max(...wins.map((w) => w.s));
        return wins.filter((w) => w.s >= top - tolerance).reduce((a, b) => (b.rec > a.rec || (b.rec === a.rec && b.s > a.s) ? b : a));
      })()
    : null;
  const worstLoss = losses.length
    ? (() => {
        const bottom = Math.min(...losses.map((l) => l.s));
        return losses.filter((l) => l.s <= bottom + tolerance).reduce((a, b) => (b.rec < a.rec || (b.rec === a.rec && b.s < a.s) ? b : a));
      })()
    : null;
  return { bestWin: bestWin?.g ?? null, worstLoss: worstLoss?.g ?? null };
}
