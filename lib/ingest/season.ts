// Shared ingest for one season. Used by the backfill script now and the cron route later.
// All writes are upserts, so re-running is safe. Unmatched team names throw before any rating or
// committee row is written for the season.

import type { CfbdClient } from "../cfbd/client";
import type { AdvancedGameStat } from "../cfbd/types";
import {
  ALIAS_SOURCE,
  aliasEntriesFromCfbd,
  createCrosswalk,
  UnmatchedTeamsError,
  type AliasRow,
  type Unmatched,
} from "../crosswalk";
import { fetchAll, upsertRows, type Db } from "./db";
import {
  buildCommitteeRows,
  buildGameRows,
  buildGameStatRows,
  buildRatingRows,
  buildTeamSeasonInputRows,
  buildTeamSeasonRows,
  collectTeams,
  storedGames,
  type RatingRow,
} from "./transform";
import { buildWeekMap } from "./weeks";

export interface IngestSeasonOptions {
  cfbd: CfbdClient;
  db: Db;
  season: number;
  /**
   * Overwrite name/conference/division on existing teams. Otherwise only new teams are inserted.
   * teams has one row per team, so enable this for the newest season of a run only.
   */
  updateTeamMeta?: boolean;
  /**
   * Restrict rating writes (and Elo fetches) to these stored weeks. Used by the cron to snapshot only
   * the current week instead of copying season-level systems onto future weeks.
   */
  weeks?: number[];
  /**
   * Stored weeks to fetch advanced game stats for (best-team model input). Defaults to `weeks`.
   * The cron passes the current and previous week so late stat corrections are picked up.
   */
  statsWeeks?: number[];
  log?: (msg: string) => void;
}

export interface SeasonCounts {
  season: number;
  teams: number;
  games: number;
  committee: number;
  gameStats: number;
  priorInputs: number;
  ratings: Record<string, number>;
  /** FBS teams with no rating at all from a system this season (upstream gaps; never imputed). */
  gaps: { team: string; system: string }[];
}

/** Thrown after nothing rating- or committee-related was written; carries every miss for the report. */
export class SeasonUnmatchedError extends Error {
  constructor(
    readonly season: number,
    readonly unmatched: Unmatched[],
  ) {
    super(`Season ${season}: ${unmatched.length} unmatched team name(s)`);
    this.name = "SeasonUnmatchedError";
  }
}

const SRC = {
  sp: "cfbd:/ratings/sp",
  fpi: "cfbd:/ratings/fpi",
  srs: "cfbd:/ratings/srs",
  elo: "cfbd:/ratings/elo",
  rankings: "cfbd:/rankings",
  advanced: "cfbd:/stats/game/advanced",
  returning: "cfbd:/player/returning",
} as const;

export async function ingestSeason(opts: IngestSeasonOptions): Promise<SeasonCounts> {
  const { cfbd, db, season, updateTeamMeta = false } = opts;
  const log = opts.log ?? (() => {});

  const [calendar, fbsTeams, allGames] = await Promise.all([
    cfbd.calendar(season),
    cfbd.teamsFbs(season),
    cfbd.games(season, { seasonType: "both" }),
  ]);
  const weekMap = buildWeekMap(calendar);
  const weeks = opts.weeks ?? weekMap.weeks;
  const badWeek = weeks.find((w) => !weekMap.weeks.includes(w));
  if (badWeek !== undefined) throw new Error(`Season ${season} has no stored week ${badWeek}`);
  const fbsCfbdIds = new Set(fbsTeams.map((t) => t.id));
  const games = storedGames(allGames, fbsCfbdIds);

  // 1. Teams (FBS plus the FCS opponents games reference).
  const teamRows = collectTeams(fbsTeams, games);
  await upsertRows(db, "teams", teamRows, "cfbd_id", { ignoreDuplicates: !updateTeamMeta });
  const dbTeams = await fetchAll<{ id: number; cfbd_id: number }>(db, "teams", "id,cfbd_id");
  const dbIdByCfbd = new Map(dbTeams.map((t) => [t.cfbd_id, t.id]));
  const fbsDbIds = new Set(fbsTeams.map((t) => dbIdByCfbd.get(t.id)!));

  // 2. Aliases, then the crosswalk from everything persisted so far (earlier seasons included).
  const aliasRows: AliasRow[] = aliasEntriesFromCfbd(fbsTeams, (t) => dbIdByCfbd.get(t.id));
  for (const t of teamRows) {
    aliasRows.push({ alias: t.name, source: ALIAS_SOURCE.cfbd, team_id: dbIdByCfbd.get(t.cfbd_id)! });
  }
  // A batch may not contain the same conflict key twice.
  const uniqueAliases = [...new Map(aliasRows.map((a) => [`${a.alias}\u0000${a.source}`, a])).values()];
  await upsertRows(db, "team_aliases", uniqueAliases, "alias,source");
  const crosswalk = createCrosswalk(await fetchAll<AliasRow>(db, "team_aliases", "alias,source,team_id"));

  // 3. Games, plus season membership (teams.division only reflects the newest season).
  const gameRows = buildGameRows(games, weekMap, dbIdByCfbd);
  await upsertRows(db, "games", gameRows, "id");
  await upsertRows(db, "team_seasons", buildTeamSeasonRows(season, teamRows, dbIdByCfbd), "season,team_id");

  // 4. Fetch ratings and committee polls, resolve every name before writing anything.
  const [sp, fpi, srs, rankings] = await Promise.all([
    cfbd.ratingsSp(season),
    cfbd.ratingsFpi(season),
    cfbd.ratingsSrs(season),
    cfbd.rankings(season, { seasonType: "both" }),
  ]);
  // Elo is the only weekly series. The postseason slot gets the end-of-season value.
  const eloByWeek = new Map<number, Awaited<ReturnType<typeof cfbd.ratingsElo>>>();
  for (const w of weeks) {
    eloByWeek.set(w, await cfbd.ratingsElo(season, w === weekMap.postseason ? undefined : w));
  }

  // Model inputs: advanced game stats (per stored week) and preseason prior inputs.
  const statsWeeks = opts.statsWeeks ?? weeks;
  const advanced: AdvancedGameStat[] = [];
  for (const w of statsWeeks) {
    if (w === weekMap.postseason) advanced.push(...(await cfbd.advancedGameStats(season, { seasonType: "postseason" })));
    else advanced.push(...(await cfbd.advancedGameStats(season, { week: w, seasonType: "regular" })));
  }
  const [returning, talent] = await Promise.all([cfbd.returningProduction(season), cfbd.talent(season)]);

  const unmatched: Unmatched[] = [];
  const resolve = (names: string[], source: string, skip?: (n: string) => boolean) => {
    try {
      return crosswalk.resolveAll(names, { source, skip });
    } catch (err) {
      if (!(err instanceof UnmatchedTeamsError)) throw err;
      unmatched.push(...err.unmatched);
      return new Map<string, number>();
    }
  };

  // SP+ appends a league-wide summary row that is not a team.
  const spIds = resolve(sp.map((r) => r.team), SRC.sp, (n) => n === "nationalAverages");
  const fpiIds = resolve(fpi.map((r) => r.team), SRC.fpi);
  // SRS lists ~140 FCS schools that never played an FBS team. Ignore unknown names only when their
  // conference isn't an FBS conference this season, so a misspelled FBS team still fails loudly.
  const fbsConferences = new Set(fbsTeams.map((t) => t.conference));
  const srsConference = new Map(srs.map((r) => [r.team, r.conference]));
  const srsIds = resolve(srs.map((r) => r.team), SRC.srs, (n) => !fbsConferences.has(srsConference.get(n) ?? null));
  const eloIds = resolve([...new Set([...eloByWeek.values()].flat().map((r) => r.team))], SRC.elo);

  const committee = buildCommitteeRows(rankings, weekMap, (r) => {
    const byId = r.teamId === null ? undefined : dbIdByCfbd.get(r.teamId);
    const id = byId ?? crosswalk.lookup(r.school);
    if (id === undefined) {
      unmatched.push({ name: r.school, source: SRC.rankings });
      return -1;
    }
    return id;
  });

  const gameStats = buildGameStatRows(advanced, games, dbIdByCfbd);
  unmatched.push(...gameStats.unmatched.map((name) => ({ name, source: SRC.advanced })));
  // Returning production lists FBS teams only; resolve loudly like SRS (skip non-FBS conferences).
  const returningConference = new Map(returning.map((r) => [r.team, r.conference]));
  resolve(returning.map((r) => r.team), SRC.returning, (n) => !fbsConferences.has(returningConference.get(n) ?? null));
  // Talent mixes in FCS programs with no conference field, so unknown names are skipped; FBS teams
  // missing a talent value show up in the gaps report below.
  const inputRows = buildTeamSeasonInputRows(season, returning, talent, (n) => crosswalk.lookup(n), fbsDbIds);

  if (unmatched.length > 0) {
    const seen = new Map(unmatched.map((u) => [`${u.source}\u0000${u.name}`, u]));
    throw new SeasonUnmatchedError(season, [...seen.values()]);
  }

  // 5. Ratings. SP+/FPI/SRS are season-level, so every stored week gets the end-of-season value
  // (look-ahead for backfilled weeks; the weekly cron snapshots them going forward).
  const systems = await fetchAll<{ id: number; name: string }>(db, "systems", "id,name");
  const systemId = (name: string) => {
    const s = systems.find((x) => x.name === name);
    if (!s) throw new Error(`System "${name}" missing from systems table`);
    return s.id;
  };
  const common = { season, allowedTeamIds: fbsDbIds };
  const ratingRows: Record<string, RatingRow[]> = {
    "SP+": buildRatingRows({ ...common, systemId: systemId("SP+"), weeks, rows: sp, name: (r) => r.team, value: (r) => r.rating, teamIdByName: spIds }),
    FPI: buildRatingRows({ ...common, systemId: systemId("FPI"), weeks, rows: fpi, name: (r) => r.team, value: (r) => r.fpi, teamIdByName: fpiIds }),
    SRS: buildRatingRows({ ...common, systemId: systemId("SRS"), weeks, rows: srs, name: (r) => r.team, value: (r) => r.rating, teamIdByName: srsIds }),
    Elo: [...eloByWeek].flatMap(([week, rows]) =>
      buildRatingRows({ ...common, systemId: systemId("Elo"), weeks: [week], rows, name: (r) => r.team, value: (r) => r.elo, teamIdByName: eloIds }),
    ),
  };

  // Coverage gaps are upstream data absences (name mismatches already threw above): CFBD has no 2020
  // SRS row for most teams, no 2017 SP+ for UAB, etc. Never imputed; reported as warnings.
  const nameOf = new Map(fbsTeams.map((t) => [dbIdByCfbd.get(t.id)!, t.school]));
  const gaps: { team: string; system: string }[] = [];
  for (const [system, rows] of Object.entries(ratingRows)) {
    const have = new Set(rows.map((r) => r.team_id));
    for (const id of fbsDbIds) if (!have.has(id)) gaps.push({ team: nameOf.get(id)!, system });
  }
  const inputsBy = new Map(inputRows.map((r) => [r.team_id, r]));
  for (const id of fbsDbIds) {
    if (inputsBy.get(id)?.returning_ppa_pct == null) gaps.push({ team: nameOf.get(id)!, system: "returning production" });
    if (inputsBy.get(id)?.talent == null) gaps.push({ team: nameOf.get(id)!, system: "talent" });
  }

  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(ratingRows)) {
    await upsertRows(db, "ratings", rows, "system_id,team_id,season,week");
    counts[name] = rows.length;
  }
  await upsertRows(db, "committee_ranks", committee, "season,week,team_id");
  await upsertRows(db, "game_team_stats", gameStats.rows, "game_id,team_id");
  await upsertRows(db, "team_season_inputs", inputRows, "season,team_id");

  const result = {
    season,
    teams: teamRows.length,
    games: gameRows.length,
    committee: committee.length,
    gameStats: gameStats.rows.length,
    priorInputs: inputRows.length,
    ratings: counts,
    gaps,
  };
  log(`${season}: ${JSON.stringify({ ...result, gaps: gaps.length })}`);
  return result;
}
