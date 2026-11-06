// Chooses the next three cards. Favours teams shown least so far, and the triples whose votes teach the
// fit the most. Given team features and the current weights, that is the sum over the three pairs of
// p(1-p)|d|^2 (p = predicted chance one team wins, d = difference in their stats): pairs that are close
// calls AND differ a lot in what they are good at, so the choice reveals what the voter values. Without
// features it falls back to preferring close predicted strengths. Randomness is injected.

import type { Vote } from "./types";

export const tripleKey = (ids: readonly number[]) => [...ids].sort((a, b) => a - b).join("-");

export interface PickOptions {
  ids: readonly number[];
  /** Times each team has appeared so far (missing = 0). */
  counts: ReadonlyMap<number, number>;
  /** tripleKey of every triple already shown. */
  seen: ReadonlySet<string>;
  /** Current predicted strengths, if a fit exists (used only when `features` is absent). */
  scores?: ReadonlyMap<number, number>;
  /** Team feature rows and the current stat weights: enables the information-driven choice. */
  features?: ReadonlyMap<number, readonly number[]>;
  weights?: readonly number[];
  rng: () => number;
  candidates?: number;
}

function sampleWeighted(ids: readonly number[], weight: (id: number) => number, k: number, rng: () => number): number[] {
  const pool = [...ids];
  const out: number[] = [];
  while (out.length < k && pool.length) {
    const ws = pool.map(weight);
    let r = rng() * ws.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < pool.length - 1 && (r -= ws[i]) > 0) i++;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Fisher information about the stat weights from ranking these teams: sum over pairs of p(1-p)|d|^2. */
function tripleInfo(triple: readonly number[], features: ReadonlyMap<number, readonly number[]>, weights: readonly number[]): number {
  let info = 0;
  for (let a = 0; a < triple.length; a++) {
    for (let b = a + 1; b < triple.length; b++) {
      const xa = features.get(triple[a]);
      const xb = features.get(triple[b]);
      if (!xa || !xb) continue;
      let dot = 0;
      let sq = 0;
      for (let k = 0; k < xa.length; k++) {
        const d = xa[k] - xb[k];
        dot += d * (weights[k] ?? 0);
        sq += d * d;
      }
      const p = sigmoid(dot);
      info += p * (1 - p) * sq;
    }
  }
  return info;
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Returns three distinct ids in random display order, or null if fewer than three teams exist. */
export function pickTriple(opts: PickOptions): Vote | null {
  const { ids, counts, seen, scores, features, weights, rng } = opts;
  if (ids.length < 3) return null;
  const count = (id: number) => counts.get(id) ?? 0;
  const weight = (id: number) => 1 / (1 + count(id)) ** 2;
  let best: { triple: number[]; cost: number } | null = null;
  for (let c = 0; c < (opts.candidates ?? (features ? 60 : 40)); c++) {
    const triple = sampleWeighted(ids, weight, 3, rng);
    if (triple.length < 3 || seen.has(tripleKey(triple))) continue;
    let cost = triple.reduce((a, id) => a + count(id), 0);
    if (features && weights) {
      cost = 0.3 * cost - tripleInfo(triple, features, weights);
    } else if (scores) {
      const ss = triple.map((id) => scores.get(id) ?? 0);
      cost += 2 * (Math.max(...ss) - Math.min(...ss));
    }
    if (!best || cost < best.cost) best = { triple, cost };
  }
  if (!best) return null;
  return shuffle(best.triple, rng) as unknown as Vote;
}
