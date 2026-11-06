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
  /** Schedule strength rank among FBS teams, 1 = hardest; null when sos is missing. */
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
  bestWin: OpponentTier | null;
  worstLoss: OpponentTier | null;
}

/** A ranking of three team ids, best first. */
export type Vote = readonly [number, number, number];
