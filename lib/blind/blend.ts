// "Your blend": where a voter's blind picks sit on the rankings slider (0 = most deserving, 100 = best team).
// Pure and unit-tested.
//
// Scores the RAW votes, not the fitted personal ranking: at ~15 rounds that ranking is pulled toward the default
// stat weights, so it would put almost everyone in the same place. For each slider value s, every team's score
// is the slider's own blendScore(s), a single scale k >= 0 is fitted (1-D Plackett-Luce, same likelihood as
// fit.ts: first of three, then first of two), and the best log-likelihood is kept. The blend is the s with the
// highest likelihood; the range is every s within 1.92 of it (profile likelihood, ~95%).

import { blendScore } from "../compute/blend";
import type { Vote } from "./types";

export interface BlendZ {
  zPred: number | null;
  zResume: number | null;
}

export interface BlendMatch {
  /** Best-matching slider value, 0..100. */
  blend: number;
  /** ~95% range of slider values the votes can't tell apart from the best one. */
  low: number;
  high: number;
  /** Share of the voter's pairwise orderings (3 per vote, weighted) the best blend agrees with; ties count half. */
  agreement: number;
  votesUsed: number;
}

/** Half the 95% chi-square(1) quantile: the profile-likelihood drop that bounds the range. */
const RANGE_DROP = 1.92;

/** Log-likelihood of the votes for strengths k·x, maximized over k >= 0 (concave in k; damped Newton). */
function bestScaleLogLik(x: Float64Array, weights: Float64Array): number {
  const n = weights.length;
  const evalAt = (k: number) => {
    let ll = 0;
    let d1 = 0;
    let d2 = 0;
    for (let v = 0; v < n; v++) {
      const w = weights[v];
      const a = x[3 * v];
      const b = x[3 * v + 1];
      const c = x[3 * v + 2];
      // First of three: a beats b and c.
      const m3 = Math.max(k * a, k * b, k * c);
      const ea = Math.exp(k * a - m3);
      const eb = Math.exp(k * b - m3);
      const ec = Math.exp(k * c - m3);
      const z3 = ea + eb + ec;
      const mean3 = (a * ea + b * eb + c * ec) / z3;
      ll += w * (k * a - m3 - Math.log(z3));
      d1 += w * (a - mean3);
      d2 -= w * ((a * a * ea + b * b * eb + c * c * ec) / z3 - mean3 * mean3);
      // Then first of two: b beats c.
      const m2 = Math.max(k * b, k * c);
      const fb = Math.exp(k * b - m2);
      const fc = Math.exp(k * c - m2);
      const z2 = fb + fc;
      const mean2 = (b * fb + c * fc) / z2;
      ll += w * (k * b - m2 - Math.log(z2));
      d1 += w * (b - mean2);
      d2 -= w * ((b * b * fb + c * c * fc) / z2 - mean2 * mean2);
    }
    return { ll, d1, d2 };
  };
  let k = 1;
  let cur = evalAt(k);
  for (let iter = 0; iter < 50; iter++) {
    if (Math.abs(cur.d1) < 1e-7 * Math.max(1, n)) break;
    if (k === 0 && cur.d1 <= 0) break; // optimum is at the boundary
    let next = k;
    if (cur.d2 < -1e-12) next = Math.max(0, k - cur.d1 / cur.d2);
    else next = cur.d1 > 0 ? k * 2 + 1 : 0;
    let cand = evalAt(next);
    // Newton on a concave function can overshoot far from the optimum; pull back toward k until it improves.
    for (let t = 0; t < 30 && cand.ll < cur.ll; t++) {
      next = (k + next) / 2;
      cand = evalAt(next);
    }
    if (cand.ll <= cur.ll) break;
    k = next;
    cur = cand;
  }
  return cur.ll;
}

/**
 * Matches votes to slider values 0..100. Votes naming a team without both z-scores are skipped; returns null if
 * fewer than `minVotes` are usable. `voteWeights` (aligned with `votes`, default 1) lets the crowd cap each session.
 */
export function matchBlend(
  votes: readonly Vote[],
  z: ReadonlyMap<number, BlendZ>,
  opts: { voteWeights?: readonly number[]; minVotes?: number } = {},
): BlendMatch | null {
  const used: Vote[] = [];
  const weights: number[] = [];
  votes.forEach((v, i) => {
    if (new Set(v).size !== 3) return;
    if (!v.every((id) => { const t = z.get(id); return t && t.zPred !== null && t.zResume !== null; })) return;
    const w = opts.voteWeights?.[i] ?? 1;
    if (!(w > 0)) return;
    used.push(v);
    weights.push(w);
  });
  if (used.length === 0 || used.length < (opts.minVotes ?? 1)) return null;

  const w = Float64Array.from(weights);
  const x = new Float64Array(3 * used.length);
  const lls: number[] = [];
  for (let s = 0; s <= 100; s++) {
    used.forEach((v, i) => v.forEach((id, j) => {
      const t = z.get(id)!;
      x[3 * i + j] = blendScore(s / 100, t.zPred, t.zResume)!;
    }));
    lls.push(bestScaleLogLik(x, w));
  }
  // Ties go to the setting nearest the middle, so flat evidence doesn't claim an extreme.
  let blend = 0;
  for (let s = 1; s <= 100; s++) {
    if (lls[s] > lls[blend] + 1e-9 || (Math.abs(lls[s] - lls[blend]) <= 1e-9 && Math.abs(s - 50) < Math.abs(blend - 50))) blend = s;
  }
  let low = blend;
  while (low > 0 && lls[low - 1] >= lls[blend] - RANGE_DROP) low--;
  let high = blend;
  while (high < 100 && lls[high + 1] >= lls[blend] - RANGE_DROP) high++;

  let agree = 0;
  let total = 0;
  used.forEach((v, i) => {
    const sc = v.map((id) => { const t = z.get(id)!; return blendScore(blend / 100, t.zPred, t.zResume)!; });
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      total += weights[i];
      agree += weights[i] * (sc[a] > sc[b] ? 1 : sc[a] === sc[b] ? 0.5 : 0);
    }
  });
  return { blend, low, high, agreement: agree / total, votesUsed: used.length };
}
