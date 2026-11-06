// Plackett-Luce fit for blind-ranking votes.
//
// Each vote ranks three teams (best first). Team strength is s_i = w . x_i + u_i: a weight vector over
// card features (what the voter values) plus a per-team offset. Both are L2-regularized (offsets much
// harder), so a handful of votes pins down w and every FBS team gets a score through its features, while
// many votes let the offsets express team-specific judgments. The objective is concave; plain gradient
// ascent with backtracking is deterministic and plenty fast for ~130 teams.

import type { Vote } from "./types";

export interface FitOptions {
  /** Weights the fit shrinks toward (default all zero): what a typical voter values, until votes say otherwise. */
  wPrior?: readonly number[];
  lambdaW?: number;
  lambdaU?: number;
  maxIter?: number;
  /** Per-vote weight (aligned with `votes`, default 1): the crowd fit caps each session's total influence. */
  voteWeights?: readonly number[];
}

export interface FitResult {
  scores: Map<number, number>;
  /** 1 = best. Ties broken by id for stable output. */
  ranks: Map<number, number>;
  weights: number[];
  votesUsed: number;
}

export function fitPlackettLuce(
  votes: readonly Vote[],
  ids: readonly number[],
  features: readonly (readonly number[])[],
  opts: FitOptions = {},
): FitResult {
  const lambdaW = opts.lambdaW ?? 0.1;
  const lambdaU = opts.lambdaU ?? 2;
  const maxIter = opts.maxIter ?? 400;
  const n = ids.length;
  const F = n ? features[0].length : 0;
  const index = new Map(ids.map((id, i) => [id, i]));
  const used: [number, number, number][] = [];
  const weight: number[] = [];
  votes.forEach((v, k) => {
    const idx = v.map((id) => index.get(id)) as (number | undefined)[];
    if (idx.every((i) => i !== undefined) && new Set(idx).size === 3) {
      used.push(idx as [number, number, number]);
      weight.push(opts.voteWeights?.[k] ?? 1);
    }
  });

  const strengths = (w: number[], u: number[]) => features.map((x, i) => x.reduce((a, xv, k) => a + xv * w[k], 0) + u[i]);

  /** Returns the objective and its gradient with respect to the strengths. */
  function evaluate(w: number[], u: number[]): { f: number; gw: number[]; gu: number[] } {
    const s = strengths(w, u);
    const gs = new Array<number>(n).fill(0);
    let ll = 0;
    used.forEach(([a, b, c], v) => {
      const wv = weight[v];
      for (const set of [[a, b, c], [b, c]]) {
        const m = Math.max(...set.map((i) => s[i]));
        const exps = set.map((i) => Math.exp(s[i] - m));
        const z = exps.reduce((p, q) => p + q, 0);
        ll += wv * (s[set[0]] - m - Math.log(z));
        gs[set[0]] += wv;
        set.forEach((i, k) => (gs[i] -= (wv * exps[k]) / z));
      }
    });
    const gw = new Array<number>(F).fill(0);
    for (let i = 0; i < n; i++) for (let k = 0; k < F; k++) gw[k] += features[i][k] * gs[i];
    let pen = 0;
    for (let k = 0; k < F; k++) {
      const d = w[k] - (opts.wPrior?.[k] ?? 0);
      gw[k] -= lambdaW * d;
      pen += lambdaW * d * d;
    }
    const gu = gs.map((g, i) => g - lambdaU * u[i]);
    for (let i = 0; i < n; i++) pen += lambdaU * u[i] * u[i];
    return { f: ll - pen / 2, gw, gu };
  }

  let w = Array.from({ length: F }, (_, k) => opts.wPrior?.[k] ?? 0);
  let u = new Array<number>(n).fill(0);
  if (used.length > 0) {
    let cur = evaluate(w, u);
    let step = 0.1;
    for (let iter = 0; iter < maxIter; iter++) {
      const gnorm = Math.sqrt([...cur.gw, ...cur.gu].reduce((a, g) => a + g * g, 0));
      if (gnorm < 1e-6) break;
      let accepted = false;
      for (let tries = 0; tries < 30; tries++) {
        const w2 = w.map((v, k) => v + step * cur.gw[k]);
        const u2 = u.map((v, i) => v + step * cur.gu[i]);
        const next = evaluate(w2, u2);
        if (next.f > cur.f) {
          w = w2;
          u = u2;
          cur = next;
          step *= 1.5;
          accepted = true;
          break;
        }
        step /= 2;
      }
      if (!accepted) break;
    }
  }

  const s = strengths(w, u);
  const scores = new Map(ids.map((id, i) => [id, s[i]]));
  const order = [...ids].sort((a, b) => scores.get(b)! - scores.get(a)! || a - b);
  return { scores, ranks: new Map(order.map((id, i) => [id, i + 1])), weights: w, votesUsed: used.length };
}
