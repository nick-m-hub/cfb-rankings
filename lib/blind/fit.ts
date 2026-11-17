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

/**
 * One set of votes judged on one set of cards (e.g. one week's). `ids[i]` has feature row `features[i]`.
 * With `offsets: false` the group informs only the stat weights, not the per-team offsets: the season-long
 * crowd uses this for past weeks, whose cards no longer describe the teams.
 */
export interface VoteGroup {
  ids: readonly number[];
  features: readonly (readonly number[])[];
  votes: readonly Vote[];
  /** Per-vote weight (aligned with `votes`, default 1). */
  voteWeights?: readonly number[];
  offsets?: boolean;
}

export interface GroupFitResult {
  weights: number[];
  /** Per-team offsets, for every team in a group with offsets (0 for teams with no offset votes). */
  offsets: Map<number, number>;
  votesUsed: number;
}

export function fitPlackettLuce(
  votes: readonly Vote[],
  ids: readonly number[],
  features: readonly (readonly number[])[],
  opts: FitOptions = {},
): FitResult {
  const g = fitPlackettLuceGroups([{ ids, features, votes, voteWeights: opts.voteWeights, offsets: true }], opts);
  return rankWith(ids, features, g);
}

/** Scores and ranks `ids` (with feature rows `features`) under a fit's stat weights and team offsets. */
export function rankWith(ids: readonly number[], features: readonly (readonly number[])[], g: GroupFitResult): FitResult {
  const s = features.map((x, i) => x.reduce((a, xv, k) => a + xv * g.weights[k], 0) + (g.offsets.get(ids[i]) ?? 0));
  const scores = new Map(ids.map((id, i) => [id, s[i]]));
  const order = [...ids].sort((a, b) => scores.get(b)! - scores.get(a)! || a - b);
  return { scores, ranks: new Map(order.map((id, i) => [id, i + 1])), weights: g.weights, votesUsed: g.votesUsed };
}

/** Joint fit over several vote groups: shared stat weights, per-team offsets from the groups that allow them. */
export function fitPlackettLuceGroups(groups: readonly VoteGroup[], opts: Omit<FitOptions, "voteWeights"> = {}): GroupFitResult {
  const lambdaW = opts.lambdaW ?? 0.1;
  const lambdaU = opts.lambdaU ?? 2;
  const maxIter = opts.maxIter ?? 400;
  const F = groups.find((g) => g.features.length)?.features[0].length ?? 0;

  // Offsets live on the union of teams in offset groups.
  const teamIndex = new Map<number, number>();
  for (const g of groups) if (g.offsets ?? true) for (const id of g.ids) if (!teamIndex.has(id)) teamIndex.set(id, teamIndex.size);
  const n = teamIndex.size;

  interface Prepared {
    features: readonly (readonly number[])[];
    /** Offset index per row, or -1 when the group has no offsets. */
    team: number[];
    used: [number, number, number][];
    weight: number[];
  }
  let votesUsed = 0;
  const prepared: Prepared[] = groups.map((g) => {
    const index = new Map(g.ids.map((id, i) => [id, i]));
    const used: [number, number, number][] = [];
    const weight: number[] = [];
    g.votes.forEach((v, k) => {
      const idx = v.map((id) => index.get(id)) as (number | undefined)[];
      if (idx.every((i) => i !== undefined) && new Set(idx).size === 3) {
        used.push(idx as [number, number, number]);
        weight.push(g.voteWeights?.[k] ?? 1);
      }
    });
    votesUsed += used.length;
    const team = g.ids.map((id) => ((g.offsets ?? true) ? teamIndex.get(id)! : -1));
    return { features: g.features, team, used, weight };
  });

  /** Returns the objective and its gradients. */
  function evaluate(w: number[], u: number[]): { f: number; gw: number[]; gu: number[] } {
    let ll = 0;
    const gw = new Array<number>(F).fill(0);
    const gu = new Array<number>(n).fill(0);
    for (const p of prepared) {
      if (p.used.length === 0) continue;
      const s = p.features.map((x, i) => x.reduce((a, xv, k) => a + xv * w[k], 0) + (p.team[i] >= 0 ? u[p.team[i]] : 0));
      const gs = new Array<number>(s.length).fill(0);
      p.used.forEach(([a, b, c], v) => {
        const wv = p.weight[v];
        for (const set of [[a, b, c], [b, c]]) {
          const m = Math.max(...set.map((i) => s[i]));
          const exps = set.map((i) => Math.exp(s[i] - m));
          const z = exps.reduce((q, r) => q + r, 0);
          ll += wv * (s[set[0]] - m - Math.log(z));
          gs[set[0]] += wv;
          set.forEach((i, k) => (gs[i] -= (wv * exps[k]) / z));
        }
      });
      for (let i = 0; i < s.length; i++) {
        if (gs[i] === 0) continue;
        for (let k = 0; k < F; k++) gw[k] += p.features[i][k] * gs[i];
        if (p.team[i] >= 0) gu[p.team[i]] += gs[i];
      }
    }
    let pen = 0;
    for (let k = 0; k < F; k++) {
      const d = w[k] - (opts.wPrior?.[k] ?? 0);
      gw[k] -= lambdaW * d;
      pen += lambdaW * d * d;
    }
    for (let i = 0; i < n; i++) {
      gu[i] -= lambdaU * u[i];
      pen += lambdaU * u[i] * u[i];
    }
    return { f: ll - pen / 2, gw, gu };
  }

  let w = Array.from({ length: F }, (_, k) => opts.wPrior?.[k] ?? 0);
  let u = new Array<number>(n).fill(0);
  if (votesUsed > 0) {
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
  return { weights: w, offsets: new Map([...teamIndex].map(([id, i]) => [id, u[i]])), votesUsed };
}
