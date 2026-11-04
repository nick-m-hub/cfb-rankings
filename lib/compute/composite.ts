// Pure per-week computation: raw ratings -> per-system z-scores -> predictive/resume composites.
// FBS only, no imputation: a team missing from a system simply lacks that z.

import { zScores } from "./zscore";

export type SystemKind = "predictive" | "resume";

export interface SystemDef {
  id: number;
  kind: SystemKind;
  higherIsBetter: boolean;
}

export interface RawRating {
  systemId: number;
  teamId: number;
  rawValue: number;
}

export interface SystemZ {
  systemId: number;
  teamId: number;
  z: number;
}

export interface CompositeRow {
  teamId: number;
  zPred: number | null;
  zResume: number | null;
  nSystemsPred: number;
  nSystemsResume: number;
}

export interface WeekComputation {
  systemZ: SystemZ[];
  composites: CompositeRow[];
}

/** Re-standardize non-null entries across the set; nulls stay null. */
function restandardize(values: readonly (number | null)[]): (number | null)[] {
  const idx: number[] = [];
  const present: number[] = [];
  values.forEach((v, i) => {
    if (v !== null) {
      idx.push(i);
      present.push(v);
    }
  });
  const z = zScores(present);
  const out: (number | null)[] = values.map(() => null);
  idx.forEach((i, k) => (out[i] = z[k]));
  return out;
}

/**
 * Compute one season/week. `ratings` may include non-FBS teams; they are ignored. Duplicate
 * (system, team) pairs are an error rather than silently averaged.
 */
export function computeWeek(
  systems: readonly SystemDef[],
  ratings: readonly RawRating[],
  fbsTeamIds: ReadonlySet<number>,
): WeekComputation {
  const kindOf = new Map(systems.map((s) => [s.id, s] as const));
  const systemZ: SystemZ[] = [];
  const seen = new Set<string>();

  for (const sys of systems) {
    const rows = ratings.filter((r) => r.systemId === sys.id && fbsTeamIds.has(r.teamId));
    for (const r of rows) {
      const key = `${r.systemId}:${r.teamId}`;
      if (seen.has(key)) throw new Error(`Duplicate rating for system ${r.systemId}, team ${r.teamId}`);
      seen.add(key);
    }
    const z = zScores(rows.map((r) => r.rawValue), sys.higherIsBetter);
    rows.forEach((r, i) => systemZ.push({ systemId: sys.id, teamId: r.teamId, z: z[i] }));
  }

  // Equal-weight mean of available z per side.
  const sums = new Map<number, { pred: number[]; resume: number[] }>();
  for (const { systemId, teamId, z } of systemZ) {
    const entry = sums.get(teamId) ?? { pred: [], resume: [] };
    (kindOf.get(systemId)!.kind === "predictive" ? entry.pred : entry.resume).push(z);
    sums.set(teamId, entry);
  }

  const teamIds = [...sums.keys()].sort((a, b) => a - b);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const rawPred = teamIds.map((t) => mean(sums.get(t)!.pred));
  const rawResume = teamIds.map((t) => mean(sums.get(t)!.resume));
  const zPred = restandardize(rawPred);
  const zResume = restandardize(rawResume);

  const composites = teamIds.map((teamId, i) => ({
    teamId,
    zPred: zPred[i],
    zResume: zResume[i],
    nSystemsPred: sums.get(teamId)!.pred.length,
    nSystemsResume: sums.get(teamId)!.resume.length,
  }));
  return { systemZ, composites };
}
