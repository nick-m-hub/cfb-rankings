// Inputs and outputs shared by the resume and best-team models. Ids are `teams.id`.

export interface ModelGame {
  id: number;
  week: number;
  homeId: number;
  awayId: number;
  homePoints: number;
  awayPoints: number;
  neutral: boolean;
}

/** Per team-game offensive stats from CFBD advanced game stats. */
export interface TeamGameStat {
  gameId: number;
  teamId: number;
  plays: number;
  successRate: number;
}

/** Preseason prior inputs for one team-season. Any field may be missing. */
export interface PriorInput {
  /** Previous season's final FPI. */
  prevFpi: number | null;
  /** Share of last season's offensive PPA returning (0–1). */
  returningPpa: number | null;
  /** 247Sports team talent composite. */
  talent: number | null;
}

export interface GameCredit {
  gameId: number;
  week: number;
  opponentId: number;
  /** "home" | "away" | "neutral" from this team's side. */
  site: "home" | "away" | "neutral";
  pointsFor: number;
  pointsAgainst: number;
  won: boolean;
  /** Chance the benchmark team would have won this game. */
  benchmarkWinProb: number;
  /** won (1/0) minus benchmarkWinProb. */
  credit: number;
}
