import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBlend, rankTeams, type TeamInput } from "./rank";

const t = (id: number, name: string, zPred: number | null, zResume: number | null, pp = zPred, pr = zResume): TeamInput => ({
  id, name, conference: null, wins: 0, losses: 0, zPred, zResume, prevZPred: pp, prevZResume: pr,
});

const teams = [t(1, "A", 2, -1), t(2, "B", -1, 2), t(3, "C", 0.5, 0.5), t(4, "D", null, 3)];

test("blend 100 orders by predictive, 0 by resume", () => {
  assert.deepEqual(rankTeams(teams, 100).map((x) => x.name), ["A", "C", "B"]);
  assert.deepEqual(rankTeams(teams, 0).map((x) => x.name), ["B", "C", "A"]);
});

test("teams missing a side are excluded from the blend", () => {
  assert.equal(rankTeams(teams, 50).some((x) => x.name === "D"), false);
});

test("component ranks and change", () => {
  const moved = [t(1, "A", 2, -1, -1, -1), t(2, "B", 1, 1, 1, 1)];
  const r = rankTeams(moved, 100);
  assert.equal(r[0].name, "A");
  assert.equal(r[0].change, 1); // was 2nd (prev pred -1 vs 1), now 1st
  assert.equal(r[0].predRank, 1);
  assert.equal(r[0].resumeRank, 2);
});

test("parseBlend clamps and falls back", () => {
  assert.equal(parseBlend("70", 50), 70);
  assert.equal(parseBlend("999", 50), 100);
  assert.equal(parseBlend("-5", 50), 0);
  assert.equal(parseBlend("abc", 50), 50);
  assert.equal(parseBlend(null, 50), 50);
});
