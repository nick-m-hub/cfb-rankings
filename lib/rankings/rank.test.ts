import assert from "node:assert/strict";
import { test } from "node:test";
import { blendLabel, parseBlend, rankG6, rankTeams, rankView, type TeamInput } from "./rank";

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

test("rankG6 renumbers within G6 and keeps FBS rank", () => {
  const g = (id: number, name: string, conf: string, z: number): TeamInput => ({ ...t(id, name, z, z), conference: conf });
  const all = [g(1, "Big", "SEC", 3), g(2, "Mid", "Sun Belt", 2), g(3, "Low", "Mid-American", 1), g(4, "UConn", "FBS Independents", 0.5), g(5, "Pac", "Pac-12", 0.2)];
  const rows = (season: number) => rankG6(all, 50, season).map((x) => [x.name, x.rank, x.fbsRank, x.predRank]);
  assert.deepEqual(rows(2026), [["Mid", 1, 2, 1], ["Low", 2, 3, 2], ["UConn", 3, 4, 3], ["Pac", 4, 5, 4]]);
  // Before 2026 the Pac-12 is a power conference.
  assert.deepEqual(rows(2025), [["Mid", 1, 2, 1], ["Low", 2, 3, 2], ["UConn", 3, 4, 3]]);
});

test("rankView matches rankTeams when unfiltered", () => {
  const view = rankView(teams, 50, 2026, false);
  assert.deepEqual(view.map((r) => [r.id, r.rank, r.fbsRank]), rankTeams(teams, 50).map((r) => [r.id, r.rank, r.rank]));
});

test("blendLabel uses the slider's words", () => {
  assert.equal(blendLabel(0), "100% most deserving");
  assert.equal(blendLabel(100), "100% best team");
  assert.equal(blendLabel(60), "40% most deserving · 60% best team");
});
