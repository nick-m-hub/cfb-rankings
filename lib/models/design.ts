// Shared regression layout for the rating models (best.ts, resume.ts).
//
// Columns: one per FBS team, one FCS pool (the average FCS team), then optionally one offset per FCS team
// (its rating = pool + offset, offsets ridge-shrunk toward the pool), then home field for games with an FBS
// side, then home field for FCS-vs-FCS games (kept separate so FCS games don't move the FBS home field).
// With `fcsRidge = Infinity` there are no offsets and FCS-vs-FCS games are dropped: every FCS opponent is
// the pool, as in the original notebook models.

import type { ModelGame } from "./types";

export interface Design {
  /** FBS ids, ascending; FBS team i is column i. */
  fbs: number[];
  /** Column of the FCS pool. */
  pool: number;
  /** Offset column per individually rated FCS team. */
  fcsCol: Map<number, number>;
  /** Home-field columns: games with an FBS side, and FCS-vs-FCS games. */
  H: number;
  HF: number;
  nCols: number;
  /** Games used: every game with an FBS side, plus FCS-vs-FCS games when FCS teams are rated individually. */
  used: ModelGame[];
  /** Design row for each used game (home minus away, plus home field). */
  rows: [number, number][][];
  /** Rating of any team from a coefficient vector, centered on the FBS average (`center` = that average). */
  ratingOf: (beta: readonly number[], id: number, center: number) => number;
  /** FBS average of a coefficient vector (optionally excluding one team). */
  fbsMean: (beta: readonly number[], exclude?: number) => number;
  /** Ridge penalties: `teamRidge` for FBS columns (callers override per team), `poolRidge`, `fcsRidge`. */
  lambda: (teamRidge: number, poolRidge: number, fcsRidge: number) => number[];
}

export function buildDesign(games: readonly ModelGame[], fbsIds: ReadonlySet<number>, fcsRidge: number): Design {
  const fbs = [...fbsIds].sort((a, b) => a - b);
  const col = new Map<number, number>(fbs.map((id, i) => [id, i]));
  const pool = fbs.length;
  const individual = Number.isFinite(fcsRidge);
  const used = games.filter((g) => fbsIds.has(g.homeId) || fbsIds.has(g.awayId) || individual);
  const fcsIds = [...new Set(used.flatMap((g) => [g.homeId, g.awayId]).filter((id) => !fbsIds.has(id)))].sort((a, b) => a - b);
  const fcsCol = new Map<number, number>(individual ? fcsIds.map((id, i) => [id, pool + 1 + i]) : []);
  const H = pool + 1 + fcsCol.size;
  const HF = H + 1;
  const nCols = HF + 1;

  const terms = (id: number, sign: number): [number, number][] => {
    const c = col.get(id);
    if (c !== undefined) return [[c, sign]];
    const o = fcsCol.get(id);
    return o === undefined ? [[pool, sign]] : [[pool, sign], [o, sign]];
  };
  const rows = used.map((g) => {
    const r = [...terms(g.homeId, 1), ...terms(g.awayId, -1)];
    // Pool terms cancel in FCS-vs-FCS games; merge duplicate columns so the row stays sparse and exact.
    const merged = new Map<number, number>();
    for (const [c, v] of r) merged.set(c, (merged.get(c) ?? 0) + v);
    const row = [...merged].filter(([, v]) => v !== 0);
    if (!g.neutral) row.push([fbsIds.has(g.homeId) || fbsIds.has(g.awayId) ? H : HF, 1]);
    return row;
  });

  const fbsMean = (beta: readonly number[], exclude?: number) => {
    let s = 0;
    let k = 0;
    for (let i = 0; i < fbs.length; i++) {
      if (fbs[i] === exclude) continue;
      s += beta[i];
      k++;
    }
    return k ? s / k : 0;
  };
  const ratingOf = (beta: readonly number[], id: number, center: number) =>
    terms(id, 1).reduce((s, [c, v]) => s + v * beta[c], 0) - center;
  const lambda = (teamRidge: number, poolRidge: number, fcsR: number) => {
    const l = new Array<number>(nCols).fill(teamRidge);
    l[pool] = poolRidge;
    for (const c of fcsCol.values()) l[c] = fcsR;
    // Home field is unpenalized, but a column with no home/away games would be singular.
    const hasHome = rows.some((r) => r.some(([c]) => c === H));
    const hasFcsHome = rows.some((r) => r.some(([c]) => c === HF));
    l[H] = hasHome ? 0 : 1;
    l[HF] = hasFcsHome ? 0 : 1;
    return l;
  };
  return { fbs, pool, fcsCol, H, HF, nCols, used, rows, ratingOf, fbsMean, lambda };
}
