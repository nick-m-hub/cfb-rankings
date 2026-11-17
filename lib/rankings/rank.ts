// Pure slider math for the rankings table. Runs in the browser; unit-tested.

import { blendScore } from "../compute/blend";
import type { ModelDetails } from "../models/run";

/** Rank of the team in each reference system this week (SP+, FPI, Elo, SRS); null if missing. */
export type ReferenceRanks = Record<string, number | null>;

export interface TeamInput {
  id: number;
  name: string;
  conference: string | null;
  wins: number;
  losses: number;
  zPred: number | null;
  zResume: number | null;
  /** Same team's z-scores the previous week; null if absent. */
  prevZPred: number | null;
  prevZResume: number | null;
  /** In-house model output for the detail view (absent for weeks computed before the models). */
  details?: ModelDetails | null;
  reference?: ReferenceRanks;
}

export interface RankedTeam extends TeamInput {
  rank: number;
  blended: number;
  predRank: number | null;
  resumeRank: number | null;
  /** Positive = moved up. Null if unranked last week. */
  change: number | null;
}

export function parseBlend(raw: string | null | undefined, fallback: number): number {
  if (raw === null || raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Dense 1-based ranks, descending by score; ties broken by name for stable output. */
function ranksBy(items: readonly { id: number; name: string; score: number }[]): Map<number, number> {
  const sorted = [...items].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return new Map(sorted.map((t, i) => [t.id, i + 1]));
}

/** `blend` is the slider value 0..100 (0 = pure resume / most deserving, 100 = pure predictive / best team). */
export function rankTeams(teams: readonly TeamInput[], blend: number): RankedTeam[] {
  const s = blend / 100;
  const now: { id: number; name: string; score: number }[] = [];
  const prev: { id: number; name: string; score: number }[] = [];
  const pred: { id: number; name: string; score: number }[] = [];
  const resume: { id: number; name: string; score: number }[] = [];
  for (const t of teams) {
    const b = blendScore(s, t.zPred, t.zResume);
    if (b !== null) now.push({ id: t.id, name: t.name, score: b });
    const pb = blendScore(s, t.prevZPred, t.prevZResume);
    if (pb !== null) prev.push({ id: t.id, name: t.name, score: pb });
    if (t.zPred !== null) pred.push({ id: t.id, name: t.name, score: t.zPred });
    if (t.zResume !== null) resume.push({ id: t.id, name: t.name, score: t.zResume });
  }
  const rank = ranksBy(now);
  const prevRank = ranksBy(prev);
  const predRank = ranksBy(pred);
  const resumeRank = ranksBy(resume);
  const scoreOf = new Map(now.map((n) => [n.id, n.score]));

  return teams
    .filter((t) => rank.has(t.id))
    .map((t) => {
      const r = rank.get(t.id)!;
      const p = prevRank.get(t.id);
      return {
        ...t,
        rank: r,
        blended: scoreOf.get(t.id)!,
        predRank: predRank.get(t.id) ?? null,
        resumeRank: resumeRank.get(t.id) ?? null,
        change: p === undefined ? null : p - r,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

/** Group of Six conferences as stored in `team_seasons.conference`. The Pac-12 counts only from 2026, the rebuilt league. */
const G6_CONFERENCES = new Set(["American Athletic", "Conference USA", "Mid-American", "Mountain West", "Sun Belt"]);
export const G6_PAC12_FROM = 2026;

export function isG6(conference: string | null, season: number): boolean {
  if (conference === null) return false;
  return G6_CONFERENCES.has(conference) || (conference === "Pac-12" && season >= G6_PAC12_FROM);
}

export interface FilteredTeam extends RankedTeam {
  /** Rank among all FBS teams at this blend; equals `rank` when unfiltered. */
  fbsRank: number;
}

/** Ranks the G6 teams among themselves (rank, deserving, best and change all renumbered) and keeps each one's FBS rank. */
export function rankG6(teams: readonly TeamInput[], blend: number, season: number): FilteredTeam[] {
  const fbs = new Map(rankTeams(teams, blend).map((t) => [t.id, t.rank]));
  return rankTeams(teams.filter((t) => isG6(t.conference, season)), blend).map((t) => ({ ...t, fbsRank: fbs.get(t.id)! }));
}
