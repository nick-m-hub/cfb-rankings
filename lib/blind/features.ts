// Turns card stats into z-scored feature columns for the Plackett-Luce fit. Higher = better for every column.

import type { BlindCard } from "./types";

export const FEATURE_NAMES = [
  "Record",
  "Scoring margin",
  "Schedule strength",
  "Offense EPA",
  "Defense EPA",
  "Postgame win probability",
  "Best win",
  "Worst loss",
] as const;

const winPct = (w: number, l: number) => (w + l === 0 ? 0.5 : w / (w + l));

/** Raw feature value for an opponent's strength; FCS opponents count as weak. */
export function oppStrength(o: { wins: number; losses: number; fbs: boolean }): number {
  return o.fbs ? winPct(o.wins, o.losses) : 0.25;
}

/** Z-scores a column. Missing values (null) are filled with the column mean, so they contribute nothing. */
function zColumn(values: (number | null)[]): number[] {
  const known = values.filter((v): v is number => v !== null);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const filled = values.map((v) => v ?? mean);
  const sd = Math.sqrt(filled.reduce((a, b) => a + (b - mean) ** 2, 0) / filled.length);
  return filled.map((v) => (sd === 0 ? 0 : (v - mean) / sd));
}

export interface FeatureMatrix {
  ids: number[];
  /** rows[i] aligns with ids[i]; one column per FEATURE_NAMES entry. */
  rows: number[][];
}

export function buildFeatures(cards: readonly BlindCard[]): FeatureMatrix {
  const cols = [
    cards.map((c) => winPct(c.wins, c.losses)),
    cards.map((c) => c.margin),
    // Lower expected win rate = harder schedule = larger value.
    cards.map((c) => (c.sos === null ? null : -c.sos)),
    cards.map((c) => c.offEpa),
    // EPA allowed: lower is better, so flip the sign.
    cards.map((c) => (c.defEpa === null ? null : -c.defEpa)),
    cards.map((c) => c.postgameWp),
    cards.map((c) => (c.bestWin ? oppStrength(c.bestWin) : 0)),
    // No losses is best (1); otherwise a loss to a weaker opponent is worse.
    cards.map((c) => (c.worstLoss ? oppStrength(c.worstLoss) : 1)),
  ].map(zColumn);
  return { ids: cards.map((c) => c.id), rows: cards.map((_, i) => cols.map((col) => col[i])) };
}
