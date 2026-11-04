// Pure row builders for ingest. No I/O, so they are unit-tested.

import type { CfbdGame, CfbdTeam, Poll, RankingsWeek } from "../cfbd/types";
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

/** Games with at least one FBS side. FCS-vs-FCS games are never needed (FCS is hidden). */
export function fbsGames(games: readonly CfbdGame[], fbsCfbdIds: ReadonlySet<number>): CfbdGame[] {
  return games.filter((g) => fbsCfbdIds.has(g.homeId) || fbsCfbdIds.has(g.awayId));
}

/** FBS teams for the season, plus every non-FBS opponent they played (division 'fcs'). */
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
