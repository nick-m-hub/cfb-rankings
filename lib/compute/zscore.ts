export interface Stats {
  mean: number;
  sd: number;
}

/** Population mean and standard deviation (the z-scores then have sd exactly 1 across the set). */
export function meanSd(values: readonly number[]): Stats {
  const n = values.length;
  if (n === 0) return { mean: NaN, sd: NaN };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * z-scores of `values`. With `higherIsBetter = false` the sign is flipped so higher z is always
 * better. A degenerate set (fewer than 2 values, or zero spread) yields 0 for every entry.
 */
export function zScores(values: readonly number[], higherIsBetter = true): number[] {
  const { mean, sd } = meanSd(values);
  const sign = higherIsBetter ? 1 : -1;
  return values.map((v) => (sd > 0 ? (sign * (v - mean)) / sd : 0));
}
