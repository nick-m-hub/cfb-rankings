// Best-team model, version 2 (predictive power rating). Tuned in the CFB Fun notebook (Nov 2026)
// on 2016–2025 walk-forward predictions:
//  - Opponent-adjusted margin regression with fitted home field; FCS opponents pooled.
//  - Margin curve: full credit to 40 points, half credit beyond.
//  - Each game's margin is blended 85% score / 15% success-rate gap (when stats exist).
//  - Preseason prior from last season's FPI, returning production and talent, worth 6 games at the
//    start and halving every 6 games a team plays.
// Rating = points better than an average FBS team on a neutral field.

import { buildDesign } from "./design";
import { mean, ridge } from "./math";
import type { ModelGame, PriorInput, TeamGameStat } from "./types";

export interface BestParams {
  cap: number;
  tail: number;
  srWeight: number;
  srScale: number;
  priorWeight: number;
  priorHalfLife: number;
  noPriorRidge: number;
  fcsRidge: number;
  slope: number;
  priorCoef: readonly number[];
  pointsCap: number;
  pointsRidge: number;
  srRidge: number;
}

export const BEST_PARAMS: BestParams = {
  cap: 40,
  tail: 0.5,
  srWeight: 0.15,
  /** Points per unit of success-rate gap (a 10-point success-rate edge ≈ 8 points). */
  srScale: 80,
  /**
   * Ridge weight pulling a team toward its prior, in "games" of evidence, before any games are played.
   * It halves every `priorHalfLife` games the team plays (6 → 2.4 after 8 games, 1.5 after 12), so the
   * season's own results take over. Walk-forward 2016–2025 (2026-11-05): 6/6 averaged a 12.73-point miss
   * vs 12.75 for the old constant 4 (12.69 vs 12.73 from week 10 on), so fading costs no accuracy.
   * Dropping the prior entirely is much worse (13.53; 16.4 in weeks 1–3, 12.86 from week 10 on).
   */
  priorWeight: 6,
  priorHalfLife: 6,
  /** Ridge weight toward 0 for teams with no prior (and the FCS pool). */
  noPriorRidge: 0.5,
  /**
   * Ridge pulling each FCS team toward the FCS average, in games (Infinity = every FCS team is the
   * average). Walk-forward 2016–2025 with FCS-vs-FCS games (2026-11-05): FBS-vs-FCS games missed by
   * 13.61 points at 2 vs 14.76 pooled (11.36 vs 13.17 after week 4); FBS-vs-FBS 12.71 vs 12.73.
   */
  fcsRidge: 2,
  /** Walk-forward calibration: scales fitted ratings to predicted points (refit for the faded prior). */
  slope: 1.0656878930185778,
  /** prior = c0·FPI + c1·FPI·(ret − .5) + c2·(ret − .5) + c3·talentZ + c4 (fit on 2023–25). */
  priorCoef: [0.6849775541000922, 0.24565587189136873, 5.654992084193486, 2.617101445972425, 0.35648468827636587],
  /** Offense/defense split: points capped here, ridge on each side. */
  pointsCap: 63,
  pointsRidge: 2,
  /** Success-rate profile ridge. */
  srRidge: 3,
};

/** The CFB Fun notebook's original settings (constant prior), which the golden Python fixture uses. */
export const REFERENCE_BEST_PARAMS: Partial<BestParams> = { priorWeight: 4, priorHalfLife: Infinity, slope: 1.1140720417936771, fcsRidge: Infinity };

export interface BestTeam {
  teamId: number;
  rating: number;
  offense: number;
  defense: number;
  /** Same fit with no preseason prior: what this season's results alone say. */
  ratingResultsOnly: number;
  /** Preseason prior relative to the FBS average; null when the team has no prior. */
  prior: number | null;
  /** Opponent-adjusted offensive and defensive success rate; null without stats. */
  offSuccessRate: number | null;
  defSuccessRate: number | null;
}

export interface BestResult {
  hfa: number;
  fcsRating: number;
  /** Individually rated FCS teams (see BestRatings). */
  fcsRatings: Map<number, number>;
  teams: Map<number, BestTeam>;
}

const POOL = -1;

function curve(m: number, cap: number, tail: number) {
  const a = Math.abs(m);
  return Math.sign(m) * (Math.min(a, cap) + tail * Math.max(a - cap, 0));
}

/** Prior rating for each FBS team (raw, before centering). Missing prevFpi → no prior. */
export function priorRatings(
  fbs: readonly number[],
  inputs: ReadonlyMap<number, PriorInput>,
  coef: readonly number[] = BEST_PARAMS.priorCoef,
): Map<number, number> {
  const talents = fbs.map((id) => inputs.get(id)?.talent).filter((t): t is number => t !== null && t !== undefined);
  const mu = mean(talents);
  const sd = Math.sqrt(mean(talents.map((t) => (t - mu) ** 2)));
  const out = new Map<number, number>();
  for (const id of fbs) {
    const inp = inputs.get(id);
    if (!inp || inp.prevFpi === null) continue;
    const a = inp.prevFpi;
    const r = inp.returningPpa || 0.5;
    const z = inp.talent !== null && inp.talent !== undefined && sd > 0 ? (inp.talent - mu) / sd : 0;
    out.set(id, coef[0] * a + coef[1] * a * (r - 0.5) + coef[2] * (r - 0.5) + coef[3] * z + coef[4]);
  }
  return out;
}

/** Shared setup for the rating fit: design matrix, margin targets, prior and the ridge `fit`. */
function setupFit(
  games: readonly ModelGame[],
  fbsIds: ReadonlySet<number>,
  priors: ReadonlyMap<number, PriorInput>,
  stats: readonly TeamGameStat[],
  p: BestParams,
) {
  const d = buildDesign(games, fbsIds, p.fcsRidge);
  const { fbs, used, rows } = d;
  const col = new Map<number, number>(fbs.map((id, i) => [id, i]));
  col.set(POOL, d.pool);
  const n = fbs.length + 1;
  const colOf = (id: number) => col.get(fbsIds.has(id) ? id : POOL)!;
  const gamesOf = new Map<number, number>();
  for (const g of used) for (const id of [g.homeId, g.awayId]) gamesOf.set(id, (gamesOf.get(id) ?? 0) + 1);

  const srBy = new Map(stats.map((s) => [`${s.gameId}:${s.teamId}`, s]));
  const target = used.map((g) => {
    let t = curve(g.homePoints - g.awayPoints, p.cap, p.tail);
    const hs = srBy.get(`${g.id}:${g.homeId}`);
    const as = srBy.get(`${g.id}:${g.awayId}`);
    if (hs && as) t = (1 - p.srWeight) * t + p.srWeight * p.srScale * (hs.successRate - as.successRate);
    return t;
  });

  const prior = priorRatings(fbs, priors, p.priorCoef);
  /** Ratings in points (FBS average = 0): `r` holds the FBS teams then the FCS pool; `rating(id)` covers anyone. */
  const fit = (usePrior: boolean) => {
    const lambda = d.lambda(p.noPriorRidge, p.noPriorRidge, p.fcsRidge);
    const center = new Array<number>(d.nCols).fill(0);
    if (usePrior) {
      for (const [id, v] of prior) {
        lambda[col.get(id)!] = p.priorWeight * 0.5 ** ((gamesOf.get(id) ?? 0) / p.priorHalfLife);
        center[col.get(id)!] = v;
      }
    }
    const { beta } = ridge(rows, target, d.nCols, lambda, center);
    const m = d.fbsMean(beta);
    const rating = (id: number) => d.ratingOf(beta, id, m) * p.slope;
    const r = [...fbs.map(rating), (beta[d.pool] - m) * p.slope];
    return { r, rating, hfa: beta[d.H] * p.slope };
  };
  return { fbs, col, n, colOf, used, srBy, prior, fit, fcsIds: [...d.fcsCol.keys()] };
}

export interface BestRatings {
  hfa: number;
  /** The FCS pool: the average FCS team. */
  fcsRating: number;
  ratings: Map<number, number>;
  /** Individually rated FCS teams (empty when FCS is pooled); others fall back to `fcsRating`. */
  fcsRatings: Map<number, number>;
}

/**
 * Just the overall rating fit (with the preseason prior): FBS ratings, the pooled FCS rating and home
 * field, all in points. Much cheaper than computeBest, so it can be refit per team (see sos.ts).
 */
export function computeBestRatings(
  games: readonly ModelGame[],
  fbsIds: ReadonlySet<number>,
  priors: ReadonlyMap<number, PriorInput>,
  stats: readonly TeamGameStat[] = [],
  params: Partial<BestParams> = {},
): BestRatings {
  const s = setupFit(games, fbsIds, priors, stats, { ...BEST_PARAMS, ...params });
  if (s.used.length === 0) return { hfa: 0, fcsRating: 0, ratings: new Map(s.fbs.map((id) => [id, 0])), fcsRatings: new Map() };
  const full = s.fit(true);
  return {
    hfa: full.hfa,
    fcsRating: full.r[s.col.get(POOL)!],
    ratings: new Map(s.fbs.map((id) => [id, full.r[s.col.get(id)!]])),
    fcsRatings: new Map(s.fcsIds.map((id) => [id, full.rating(id)])),
  };
}

export function computeBest(
  games: readonly ModelGame[],
  fbsIds: ReadonlySet<number>,
  priors: ReadonlyMap<number, PriorInput>,
  stats: readonly TeamGameStat[] = [],
  params: Partial<BestParams> = {},
): BestResult {
  const p = { ...BEST_PARAMS, ...params };
  const { fbs, col, n, colOf, used: allUsed, prior, fit, fcsIds } = setupFit(games, fbsIds, priors, stats, p);
  if (allUsed.length === 0 && prior.size === 0) {
    return { hfa: 0, fcsRating: 0, fcsRatings: new Map(), teams: new Map() };
  }
  // The offense/defense and success-rate splits describe FBS teams: games with an FBS side, FCS pooled.
  const used = allUsed.filter((g) => fbsIds.has(g.homeId) || fbsIds.has(g.awayId));
  const full = fit(true);
  const resultsOnly = allUsed.length ? fit(false).r : new Array<number>(n).fill(0);
  const priorMean = mean([...prior.values()]);

  // Offense/defense split from points scored, rescaled so offense + defense = rating.
  const ptsRows: [number, number][][] = [];
  const ptsY: number[] = [];
  const O = 0;
  const D = n;
  const INT = 2 * n;
  const HOME = 2 * n + 1;
  for (const g of used) {
    for (const side of ["home", "away"] as const) {
      const me = colOf(side === "home" ? g.homeId : g.awayId);
      const opp = colOf(side === "home" ? g.awayId : g.homeId);
      const row: [number, number][] = [
        [O + me, 1],
        [D + opp, -1],
        [INT, 1],
      ];
      if (!g.neutral) row.push([HOME, side === "home" ? 0.5 : -0.5]);
      ptsRows.push(row);
      ptsY.push(Math.min(side === "home" ? g.homePoints : g.awayPoints, p.pointsCap));
    }
  }
  let off = new Array<number>(n).fill(0);
  let def = new Array<number>(n).fill(0);
  if (used.length) {
    const lam = new Array<number>(2 * n + 2).fill(p.pointsRidge);
    lam[INT] = 0;
    lam[HOME] = 0;
    const { beta } = ridge(ptsRows, ptsY, 2 * n + 2, lam);
    const om = mean(beta.slice(O, O + fbs.length));
    const dm = mean(beta.slice(D, D + fbs.length));
    off = beta.slice(O, O + n).map((v) => v - om);
    def = beta.slice(D, D + n).map((v) => v - dm);
  }
  for (let i = 0; i < n; i++) {
    const adj = (full.r[i] - (off[i] + def[i])) / 2;
    off[i] += adj;
    def[i] += adj;
  }

  // Success-rate profile: offense SR = mu + O_t − D_opp, weighted by plays.
  const srO = new Map<number, number>();
  const srD = new Map<number, number>();
  const gameById = new Map(used.map((g) => [g.id, g]));
  const srRows: [number, number][][] = [];
  const srY: number[] = [];
  const srW: number[] = [];
  for (const s of stats) {
    const g = gameById.get(s.gameId);
    if (!g || s.plays <= 0 || !fbsIds.has(s.teamId)) continue;
    const opp = s.teamId === g.homeId ? g.awayId : s.teamId === g.awayId ? g.homeId : null;
    if (opp === null) continue;
    srRows.push([
      [colOf(s.teamId), 1],
      [n + colOf(opp), -1],
      [2 * n, 1],
    ]);
    srY.push(s.successRate);
    srW.push(s.plays);
  }
  if (srRows.length) {
    const wm = mean(srW);
    const lam = new Array<number>(2 * n + 1).fill(p.srRidge);
    lam[2 * n] = 0;
    const { beta } = ridge(srRows, srY, 2 * n + 1, lam, undefined, srW.map((w) => w / wm));
    const mu = beta[2 * n];
    for (const id of fbs) {
      const c = col.get(id)!;
      srO.set(id, mu + beta[c]);
      srD.set(id, mu - beta[n + c]);
    }
  }

  const teams = new Map<number, BestTeam>();
  for (const id of fbs) {
    const c = col.get(id)!;
    const pr = prior.get(id);
    teams.set(id, {
      teamId: id,
      rating: full.r[c],
      offense: off[c],
      defense: def[c],
      ratingResultsOnly: resultsOnly[c],
      prior: pr === undefined ? null : pr - priorMean,
      offSuccessRate: srO.get(id) ?? null,
      defSuccessRate: srD.get(id) ?? null,
    });
  }
  return { hfa: full.hfa, fcsRating: full.r[col.get(POOL)!], fcsRatings: new Map(fcsIds.map((id) => [id, full.rating(id)])), teams };
}
