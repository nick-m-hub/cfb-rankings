// The blind-ranking model as the app uses it: the Plackett-Luce fit with default stat weights.

import { CROWD_SESSION_CAP, DEFAULT_STAT_WEIGHT, DEFAULT_WEIGHT_STRENGTH } from "./constants";
import type { FeatureMatrix } from "./features";
import { fitPlackettLuce, type FitResult } from "./fit";
import type { Vote } from "./types";

/** What a typical voter is assumed to value before their own rounds say otherwise. */
export const defaultWeights = (featureCount: number): number[] => new Array<number>(featureCount).fill(DEFAULT_STAT_WEIGHT);

export function fitVoter(votes: readonly Vote[], f: FeatureMatrix, voteWeights?: readonly number[]): FitResult {
  const count = f.rows[0]?.length ?? 0;
  return fitPlackettLuce(votes, f.ids, f.rows, { wPrior: defaultWeights(count), lambdaW: DEFAULT_WEIGHT_STRENGTH, voteWeights });
}

/**
 * Crowd vote weights: each session's votes together count as at most `cap` votes, so one visitor (or a
 * script) voting hundreds of times can't outvote everyone else. Sessions under the cap count in full.
 */
export function sessionWeights(sessions: readonly string[], cap = CROWD_SESSION_CAP): number[] {
  const n = new Map<string, number>();
  for (const s of sessions) n.set(s, (n.get(s) ?? 0) + 1);
  return sessions.map((s) => Math.min(1, cap / n.get(s)!));
}
