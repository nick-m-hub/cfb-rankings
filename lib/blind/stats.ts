// Pure helpers for the per-team card stats built in data.ts.

export interface Weighted {
  value: number | null;
  weight: number;
}

/** Weighted mean over entries with a value and a positive weight; null when none qualify. */
export function weightedMean(items: readonly Weighted[]): number | null {
  let sum = 0;
  let total = 0;
  for (const { value, weight } of items) {
    if (value === null || !Number.isFinite(value) || !(weight > 0)) continue;
    sum += value * weight;
    total += weight;
  }
  return total > 0 ? sum / total : null;
}

/** Plain mean ignoring nulls; null when empty. */
export function meanOrNull(values: readonly (number | null)[]): number | null {
  return weightedMean(values.map((value) => ({ value, weight: 1 })));
}

/** 1-based ranks by value (`best` says which end is #1). Null values get no rank. Ties break by id. */
export function rankBy(values: ReadonlyMap<number, number | null>, best: "high" | "low"): Map<number, number> {
  const entries = [...values].filter((e): e is [number, number] => e[1] !== null);
  entries.sort((a, b) => (best === "high" ? b[1] - a[1] : a[1] - b[1]) || a[0] - b[0]);
  return new Map(entries.map(([id], i) => [id, i + 1]));
}
