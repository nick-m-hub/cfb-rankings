// Sorting for the team stats table. Pure and unit-tested.

export type SortDir = "asc" | "desc";

/**
 * Stable sort by `value`. Missing values (null) always sit at the bottom whichever way you sort, and
 * ties fall back to `tie` so the order never jumps around between clicks.
 */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => number | string | null,
  dir: SortDir,
  tie: (a: T, b: T) => number,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return tie(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb) : Number(va) - Number(vb);
    return c * sign || tie(a, b);
  });
}
