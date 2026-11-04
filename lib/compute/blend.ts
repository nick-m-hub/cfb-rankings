/**
 * Slider blend: s·z_pred + (1−s)·z_resume, s in [0, 1]. Null if the team is unranked on either
 * side. Runs client-side; lives here so it stays unit-tested.
 */
export function blendScore(s: number, zPred: number | null, zResume: number | null): number | null {
  if (zPred === null || zResume === null) return null;
  if (!(s >= 0 && s <= 1)) throw new RangeError(`blend ${s} outside [0, 1]`);
  return s * zPred + (1 - s) * zResume;
}
