// Pure row builders for ingest. No I/O, so they are unit-tested.

import type { AdvancedGameStat, CfbdGame, CfbdTeam, Poll, RankingsWeek, ReturningProduction, TeamTalent } from "../cfbd/types";
import { COMMITTEE_POLL } from "../cfbd/types";
import type { WeekMap } from "./weeks";

export interface TeamRow {
  cfbd_id: number;
  name: string;
  conference: string | null;
  division: "fbs" | "fcs";
}

export interface GameRow {
  id: number;
  season: number;
  week: number;
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
  neutral_site: boolean;
  completed: boolean;
  home_postgame_wp: number | null;
  away_postgame_wp: number | null;
}

export interface RatingRow {
  system_id: number;
  team_id: number;
  season: number;
  week: number;
  raw_value: number;
}

export interface CommitteeRow {
  season: number;
  week: number;
  team_id: number;
  rank: number;
}

/**
 * Games to store: every game with an FBS side, plus FCS-vs-FCS games. FCS teams are never shown, but
 * their games against each other let the models rate each FCS opponent individually instead of treating
 * them all as one average FCS team. Games between Division II/III teams are dropped.
 */
export function storedGames(games: readonly CfbdGame[], fbsCfbdIds: ReadonlySet<number>): CfbdGame[] {
  return games.filter(
    (g) =>
      fbsCfbdIds.has(g.homeId) ||
      fbsCfbdIds.has(g.awayId) ||
      (g.homeClassification === "fcs" && g.awayClassification === "fcs"),
  );
}

/** FBS teams for the season, plus every non-FBS team in `games` (division 'fcs'). */
export function collectTeams(fbsTeams: readonly CfbdTeam[], games: readonly CfbdGame[]): TeamRow[] {
  const out = new Map<number, TeamRow>();
  for (const t of fbsTeams) {
    out.set(t.id, { cfbd_id: t.id, name: t.school, conference: t.conference, division: "fbs" });
  }
  for (const g of games) {
    if (!out.has(g.homeId)) {
      out.set(g.homeId, { cfbd_id: g.homeId, name: g.homeTeam, conference: g.homeConference, division: "fcs" });
    }
    if (!out.has(g.awayId)) {
      out.set(g.awayId, { cfbd_id: g.awayId, name: g.awayTeam, conference: g.awayConference, division: "fcs" });
    }
  }
  return [...out.values()];
}

export function buildGameRows(
  games: readonly CfbdGame[],
  weekMap: WeekMap,
  dbIdByCfbd: ReadonlyMap<number, number>,
): GameRow[] {
  const rows = new Map<number, GameRow>();
  for (const g of games) {
    const home = dbIdByCfbd.get(g.homeId);
    const away = dbIdByCfbd.get(g.awayId);
    if (home === undefined || away === undefined) {
      throw new Error(`Game ${g.id}: team missing from teams table (${g.homeId}/${g.awayId})`);
    }
    rows.set(g.id, {
      id: g.id,
      season: g.season,
      week: weekMap.storedWeek(g.seasonType, g.week),
      home_team_id: home,
      away_team_id: away,
      home_points: g.homePoints,
      away_points: g.awayPoints,
      neutral_site: g.neutralSite,
      completed: g.completed,
      home_postgame_wp: g.homePostgameWinProbability ?? null,
      away_postgame_wp: g.awayPostgameWinProbability ?? null,
    });
  }
  return [...rows.values()];
}

/**
 * One rating row per resolved team for each week. Rows with a null/non-finite value or a team outside
 * `allowedTeamIds` (that season's FBS set) are dropped. Never imputes.
 */
export function buildRatingRows<T>(opts: {
  systemId: number;
  season: number;
  weeks: readonly number[];
  rows: readonly T[];
  name: (r: T) => string;
  value: (r: T) => number | null;
  teamIdByName: ReadonlyMap<string, number>;
  allowedTeamIds: ReadonlySet<number>;
}): RatingRow[] {
  const byTeam = new Map<number, number>();
  for (const r of opts.rows) {
    const v = opts.value(r);
    const teamId = opts.teamIdByName.get(opts.name(r));
    if (v === null || !Number.isFinite(v) || teamId === undefined) continue;
    if (!opts.allowedTeamIds.has(teamId)) continue;
    byTeam.set(teamId, v);
  }
  const out: RatingRow[] = [];
  for (const week of opts.weeks) {
    for (const [team_id, raw_value] of byTeam) {
      out.push({ system_id: opts.systemId, team_id, season: opts.season, week, raw_value });
    }
  }
  return out;
}

export function committeePolls(rankings: readonly RankingsWeek[]): { entry: RankingsWeek; poll: Poll }[] {
  const out: { entry: RankingsWeek; poll: Poll }[] = [];
  for (const entry of rankings) {
    for (const poll of entry.polls) if (poll.poll === COMMITTEE_POLL) out.push({ entry, poll });
  }
  return out;
}

export function buildCommitteeRows(
  rankings: readonly RankingsWeek[],
  weekMap: WeekMap,
  teamIdFor: (rank: { teamId: number | null; school: string }) => number,
): CommitteeRow[] {
  const rows = new Map<string, CommitteeRow>();
  for (const { entry, poll } of committeePolls(rankings)) {
    const week = weekMap.storedWeek(entry.seasonType, entry.week);
    for (const r of poll.ranks) {
      const team_id = teamIdFor(r);
      rows.set(`${week}:${team_id}`, { season: entry.season, week, team_id, rank: r.rank });
    }
  }
  return [...rows.values()];
}

export interface TeamSeasonRow {
  season: number;
  team_id: number;
  conference: string | null;
  division: "fbs" | "fcs";
}

/** Season membership: every team row collected for the season (FBS plus FCS opponents). */
export function buildTeamSeasonRows(season: number, teams: readonly TeamRow[], dbIdByCfbd: ReadonlyMap<number, number>): TeamSeasonRow[] {
  return teams.map((t) => ({ season, team_id: dbIdByCfbd.get(t.cfbd_id)!, conference: t.conference, division: t.division }));
}

const finiteOrNull = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface GameTeamStatRow {
  game_id: number;
  team_id: number;
  plays: number;
  success_rate: number;
  off_ppa: number | null;
  def_ppa: number | null;
  def_plays: number | null;
}

/**
 * Advanced stats rows for our games. The team is identified through the game itself (CFBD game id
 * plus the home/away names on that game), so no crosswalk lookup is needed. Rows for games we don't
 * store (FCS vs FCS) are skipped; a row whose name matches neither side of a stored game is returned
 * in `unmatched` so ingest can fail loudly.
 */
export function buildGameStatRows(
  stats: readonly AdvancedGameStat[],
  games: readonly CfbdGame[],
  dbIdByCfbd: ReadonlyMap<number, number>,
): { rows: GameTeamStatRow[]; unmatched: string[] } {
  const byId = new Map(games.map((g) => [g.id, g]));
  const out = new Map<string, GameTeamStatRow>();
  const unmatched: string[] = [];
  for (const s of stats) {
    const g = byId.get(s.gameId);
    if (!g) continue;
    const cfbdId = s.team === g.homeTeam ? g.homeId : s.team === g.awayTeam ? g.awayId : undefined;
    if (cfbdId === undefined) {
      unmatched.push(s.team);
      continue;
    }
    const sr = s.offense?.successRate;
    const plays = s.offense?.plays;
    if (sr === null || sr === undefined || !plays) continue;
    const teamId = dbIdByCfbd.get(cfbdId)!;
    out.set(`${g.id}:${teamId}`, {
      game_id: g.id,
      team_id: teamId,
      plays,
      success_rate: sr,
      off_ppa: finiteOrNull(s.offense?.ppa),
      def_ppa: finiteOrNull(s.defense?.ppa),
      def_plays: s.defense?.plays ?? null,
    });
  }
  return { rows: [...out.values()], unmatched };
}

export interface TeamSeasonInputRow {
  season: number;
  team_id: number;
  returning_ppa_pct: number | null;
  talent: number | null;
}

/** Merge returning production and talent into one row per team (FBS teams only). */
export function buildTeamSeasonInputRows(
  season: number,
  returning: readonly ReturningProduction[],
  talent: readonly TeamTalent[],
  idByName: (name: string) => number | undefined,
  allowedTeamIds: ReadonlySet<number>,
): TeamSeasonInputRow[] {
  const out = new Map<number, TeamSeasonInputRow>();
  const row = (id: number) => {
    let r = out.get(id);
    if (!r) {
      r = { season, team_id: id, returning_ppa_pct: null, talent: null };
      out.set(id, r);
    }
    return r;
  };
  for (const r of returning) {
    const id = idByName(r.team);
    if (id !== undefined && allowedTeamIds.has(id) && r.percentPPA !== null) row(id).returning_ppa_pct = r.percentPPA;
  }
  for (const t of talent) {
    const id = idByName(t.team);
    if (id !== undefined && allowedTeamIds.has(id) && t.talent !== null) row(id).talent = Number(t.talent);
  }
  return [...out.values()];
}
