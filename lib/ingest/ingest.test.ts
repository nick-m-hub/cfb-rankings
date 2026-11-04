import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarWeek, CfbdGame } from "../cfbd/types";
import { buildCommitteeRows, buildGameRows, buildRatingRows, collectTeams, fbsGames } from "./transform";
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
});

test("FCS-vs-FCS games dropped; FCS opponents become fcs teams", () => {
  const fbs = new Set([1, 2]);
  const games = fbsGames([game(10, 1, 2), game(11, 1, 99), game(12, 98, 99)], fbs);
  assert.deepEqual(games.map((g) => g.id), [10, 11]);
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
