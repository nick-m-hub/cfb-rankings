// Response shapes for the CFBD endpoints we use. Verified against live responses on 2026-11-03.
// Only fields we read are typed; CFBD returns more.

export type Classification = "fbs" | "fcs" | "ii" | "iii";

export interface CfbdTeam {
  id: number;
  school: string;
  mascot: string | null;
  abbreviation: string | null;
  alternateNames: string[] | null;
  conference: string | null;
  division: string | null;
  classification: Classification | null;
}

/** /ratings/sp. Season-level only: the `week` param is ignored. */
export interface SpRating {
  year: number;
  team: string;
  conference: string | null;
  rating: number | null;
  ranking: number | null;
}

/** /ratings/fpi. Season-level only. */
export interface FpiRating {
  year: number;
  team: string;
  conference: string | null;
  fpi: number | null;
}

/** /ratings/srs. Season-level only. Includes FCS teams, so filter to FBS after matching. */
export interface SrsRating {
  year: number;
  team: string;
  conference: string | null;
  division: string | null;
  ranking: number | null;
  rating: number | null;
}

/** /ratings/elo. The only rating endpoint that honors `week`. No team id, so names go through the crosswalk. */
export interface EloRating {
  year: number;
  team: string;
  conference: string | null;
  elo: number | null;
}

export type SeasonType = "regular" | "postseason";

export interface CfbdGame {
  id: number;
  season: number;
  week: number;
  seasonType: SeasonType;
  completed: boolean;
  neutralSite: boolean;
  homeId: number;
  homeTeam: string;
  homeClassification: Classification | null;
  homeConference: string | null;
  homePoints: number | null;
  awayId: number;
  awayTeam: string;
  awayClassification: Classification | null;
  awayConference: string | null;
  awayPoints: number | null;
  /** Chance each side "deserved" to win given the play-by-play. Absent/null for unplayed games. */
  homePostgameWinProbability?: number | null;
  awayPostgameWinProbability?: number | null;
}

export interface PollRank {
  rank: number;
  teamId: number | null;
  school: string;
  conference: string | null;
}

export interface Poll {
  poll: string;
  ranks: PollRank[];
}

/** /rankings returns one entry per season/week/seasonType. */
export interface RankingsWeek {
  season: number;
  seasonType: SeasonType;
  week: number;
  polls: Poll[];
}

export const COMMITTEE_POLL = "Playoff Committee Rankings";

export interface CalendarWeek {
  season: number;
  week: number;
  seasonType: string;
  startDate: string;
  endDate: string;
  firstGameStart: string;
  lastGameStart: string;
}

/** /info. Used to watch the monthly call quota. */
export interface CfbdInfo {
  patronLevel: number;
  tierName: string;
  monthlyLimit: number;
  remainingCalls: number;
  usedCalls: number;
  resetAt: string;
}

/** /stats/game/advanced: one row per team per game. Only fields we read are typed. */
export interface AdvancedGameStat {
  gameId: number;
  season: number;
  week: number;
  seasonType: SeasonType;
  team: string;
  opponent: string;
  offense: { plays: number; successRate: number | null; ppa: number | null };
  /** PPA allowed per defensive play (lower is better). */
  defense?: { plays: number; ppa: number | null };
}

/** /player/returning: share of last season's production returning. FBS teams only. */
export interface ReturningProduction {
  season: number;
  team: string;
  conference: string | null;
  percentPPA: number | null;
}

/** /talent: 247Sports team talent composite. Some seasons include FCS programs. */
export interface TeamTalent {
  year: number;
  team: string;
  talent: number | null;
}
