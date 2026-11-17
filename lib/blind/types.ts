import type { QuadrantRecord } from "../models/sos";

export interface OpponentTier {
  wins: number;
  losses: number;
  /** False for FCS opponents (record shown as "an FCS team"). */
  fbs: boolean;
  site: "home" | "away" | "neutral";
}

/** One anonymous card. Deliberately has no name, conference or other identifying field. */
export interface BlindCard {
  id: number;
  wins: number;
  losses: number;
  games: number;
  /** Average scoring margin per game. */
  margin: number;
  /**
   * How often a top-12 FBS team would win this team's games so far (0 to 1; lower = harder schedule),
   * from leave-one-out best-team ratings. Null for weeks computed before it existed.
   */
  sos: number | null;
  /** Schedule strength rank among FBS teams, 1 = hardest; null when sos is missing. Stats page only (not on the blind cards). */
  sosRank: number | null;
  /** EPA (expected points added) per offensive play, play-weighted. Null until stats are ingested. */
  offEpa: number | null;
  /** EPA allowed per defensive play (lower is better). */
  defEpa: number | null;
  /** 1 = best offense / best defense among FBS teams; null when the stat is missing. */
  offEpaRank: number | null;
  defEpaRank: number | null;
  /** Average postgame win probability across played games (0 to 1). */
  postgameWp: number | null;
  /** Shown on the stats page; the blind cards show quadrant records instead. */
  bestWin: OpponentTier | null;
  worstLoss: OpponentTier | null;
  /**
   * W-L against opponent quadrants [Q1..Q4] (Q1 = top quarter of FBS by best-team rating, site-adjusted,
   * leave-one-out). Null for weeks computed before it existed.
   */
  quadrants: QuadrantRecord[] | null;
  /** W-L against other G6 teams (see g6.ts); null for non-G6 teams. Shown in the G6-only mode. */
  g6Record: { w: number; l: number } | null;
  /** Average postgame win probability in decided games against G6 teams; null for non-G6 teams or none. */
  g6PostgameWp: number | null;
  /** Average scoring margin in decided games against G6 teams; null for non-G6 teams or none. */
  g6Margin: number | null;
}

/** A ranking of three team ids, best first. */
export type Vote = readonly [number, number, number];
