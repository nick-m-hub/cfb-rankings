import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarWeek, CfbdGame } from "../cfbd/types";
import {
  buildCommitteeRows,
  buildGameRows,
  buildGameStatRows,
  buildRatingRows,
  buildTeamSeasonInputRows,
  collectTeams,
  storedGames,
} from "./transform";
import { buildWeekMap } from "./weeks";

const cal = (type: string, weeks: number[]): CalendarWeek[] =>
  weeks.map((week) => ({ season: 2024, week, seasonType: type, startDate: "", endDate: "", firstGameStart: "", lastGameStart: "" }));

test("postseason maps to last regular week + 1", () => {
  const wm = buildWeekMap([...cal("regular", [1, 2, 3, 4]), ...cal("postseason", [1])]);
  assert.equal(wm.postseason, 5);
  assert.deepEqual(wm.weeks, [1, 2, 3, 4, 5]);
  assert.equal(wm.storedWeek("postseason", 1), 5);
  assert.equal(wm.storedWeek("regular", 4), 4);
  assert.throws(() => wm.storedWeek("regular", 9));
});

test("no postseason in calendar", () => {
  const wm = buildWeekMap(cal("regular", [1, 2]));
  assert.equal(wm.postseason, null);
  assert.deepEqual(wm.weeks, [1, 2]);
});

const game = (id: number, homeId: number, awayId: number, seasonType: "regular" | "postseason" = "regular"): CfbdGame => ({
  id, season: 2024, week: 1, seasonType, completed: true, neutralSite: false,
  homeId, homeTeam: `T${homeId}`, homeClassification: null, homeConference: null, homePoints: 10,
  awayId, awayTeam: `T${awayId}`, awayClassification: null, awayConference: null, awayPoints: 3,
  homePostgameWinProbability: 0.8, awayPostgameWinProbability: 0.2,
});

test("FCS-vs-FCS games kept, lower divisions dropped; non-FBS teams become fcs teams", () => {
  const fbs = new Set([1, 2]);
  const fcsGame = { ...game(13, 98, 99), homeClassification: "fcs" as const, awayClassification: "fcs" as const };
  const d2Game = { ...game(14, 97, 99), homeClassification: "ii" as const, awayClassification: "fcs" as const };
  const all = storedGames([game(10, 1, 2), game(11, 1, 99), game(12, 98, 99), fcsGame, d2Game], fbs);
  assert.deepEqual(all.map((g) => g.id), [10, 11, 13]);
  const games = all.filter((g) => g.id !== 13);
  const teams = collectTeams(
    [1, 2].map((id) => ({ id, school: `T${id}`, mascot: null, abbreviation: null, alternateNames: null, conference: "C", division: null, classification: "fbs" as const })),
    games,
  );
  assert.deepEqual(teams.map((t) => [t.cfbd_id, t.division]), [[1, "fbs"], [2, "fbs"], [99, "fcs"]]);
});

test("game rows use stored weeks and db ids", () => {
  const wm = buildWeekMap([...cal("regular", [1]), ...cal("postseason", [1])]);
  const rows = buildGameRows([game(10, 1, 2, "postseason")], wm, new Map([[1, 100], [2, 200]]));
  assert.equal(rows[0].week, 2);
  assert.equal(rows[0].home_team_id, 100);
});

test("rating rows: season values repeat per week; nulls, unknown and non-FBS teams dropped", () => {
  const rows = buildRatingRows({
    systemId: 7, season: 2024, weeks: [1, 2],
    rows: [{ t: "A", v: 1.5 }, { t: "B", v: null }, { t: "C", v: 2 }, { t: "D", v: 3 }],
    name: (r) => r.t, value: (r) => r.v,
    teamIdByName: new Map([["A", 1], ["B", 2], ["C", 3]]),
    allowedTeamIds: new Set([1, 2]),
  });
  assert.deepEqual(rows.map((r) => [r.team_id, r.week, r.raw_value]), [[1, 1, 1.5], [1, 2, 1.5]]);
});

test("committee rows only from the committee poll", () => {
  const wm = buildWeekMap([...cal("regular", [1, 2]), ...cal("postseason", [1])]);
  const rows = buildCommitteeRows(
    [
      { season: 2024, seasonType: "regular", week: 2, polls: [{ poll: "AP Top 25", ranks: [{ rank: 1, teamId: 1, school: "A", conference: null }] }, { poll: "Playoff Committee Rankings", ranks: [{ rank: 1, teamId: 2, school: "B", conference: null }] }] },
      { season: 2024, seasonType: "postseason", week: 1, polls: [{ poll: "Playoff Committee Rankings", ranks: [{ rank: 2, teamId: 2, school: "B", conference: null }] }] },
    ],
    wm,
    (r) => r.teamId!,
  );
  assert.deepEqual(rows.map((r) => [r.week, r.team_id, r.rank]), [[2, 2, 1], [3, 2, 2]]);
});

test("game stat rows: team identified through the game; unknown games skipped; bad names reported", () => {
  const ids = new Map([[1, 100], [2, 200]]);
  const stat = (gameId: number, team: string, sr: number | null, plays = 60) => ({
    gameId, season: 2024, week: 1, seasonType: "regular" as const, team, opponent: "",
    offense: { plays, successRate: sr, ppa: 0.25 }, defense: { plays: 55, ppa: -0.1 },
  });
  const { rows, unmatched } = buildGameStatRows(
    [stat(10, "T1", 0.45), stat(10, "T2", 0.38), stat(99, "T5", 0.5), stat(10, "Typo U", 0.4), stat(10, "T1", null)],
    [game(10, 1, 2)],
    ids,
  );
  assert.deepEqual(rows.map((r) => [r.game_id, r.team_id, r.success_rate]), [[10, 100, 0.45], [10, 200, 0.38]]);
  assert.deepEqual(unmatched, ["Typo U"]);
  assert.deepEqual([rows[0].off_ppa, rows[0].def_ppa, rows[0].def_plays], [0.25, -0.1, 55]);
});

test("game stat rows keep missing EPA as null instead of zero", () => {
  const { rows } = buildGameStatRows(
    [{ gameId: 10, season: 2024, week: 1, seasonType: "regular", team: "T1", opponent: "", offense: { plays: 60, successRate: 0.4, ppa: null } }],
    [game(10, 1, 2)],
    new Map([[1, 100], [2, 200]]),
  );
  assert.deepEqual([rows[0].off_ppa, rows[0].def_ppa, rows[0].def_plays], [null, null, null]);
});

test("game rows carry postgame win probability, null when CFBD omits it", () => {
  const ids = new Map([[1, 100], [2, 200]]);
  const wm = buildWeekMap(cal("regular", [1]));
  const [a] = buildGameRows([game(10, 1, 2)], wm, ids);
  assert.deepEqual([a.home_postgame_wp, a.away_postgame_wp], [0.8, 0.2]);
  const bare = game(11, 1, 2);
  delete bare.homePostgameWinProbability;
  delete bare.awayPostgameWinProbability;
  const [b] = buildGameRows([bare], wm, ids);
  assert.deepEqual([b.home_postgame_wp, b.away_postgame_wp], [null, null]);
});

test("prior input rows merge returning and talent; non-FBS and unknown names ignored", () => {
  const byName = new Map([["A", 1], ["B", 2], ["F", 9]]);
  const rows = buildTeamSeasonInputRows(
    2024,
    [{ season: 2024, team: "A", conference: "SEC", percentPPA: 0.6 }],
    [{ year: 2024, team: "A", talent: 900 }, { year: 2024, team: "B", talent: 700 }, { year: 2024, team: "F", talent: 300 }, { year: 2024, team: "Zed", talent: 1 }],
    (n) => byName.get(n),
    new Set([1, 2]),
  );
  assert.deepEqual(rows.map((r) => [r.team_id, r.returning_ppa_pct, r.talent]), [[1, 0.6, 900], [2, null, 700]]);
});
