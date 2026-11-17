import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSchedule, computeSos, quadrantCutoffs, quadrantOf, sosRanks } from "./sos";
import type { ModelGame } from "./types";

let nextId = 1;
const game = (home: number, away: number, hp: number, ap: number, neutral = false): ModelGame => ({
  id: nextId++, week: 1, homeId: home, awayId: away, homePoints: hp, awayPoints: ap, neutral,
});
const noPriors = new Map();

/** Six FBS teams (1-6) play a full round robin with ties on the scoreboard, except 1 beats 2 by 40. */
function league(extra: ModelGame[] = []): { games: ModelGame[]; fbs: Set<number> } {
  const fbs = new Set([1, 2, 3, 4, 5, 6]);
  const games: ModelGame[] = [];
  for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) games.push(game(a, b, 20, 20, true));
  return { games: [...games.filter((g) => !(g.homeId === 1 && g.awayId === 2)), game(1, 2, 47, 7, true), ...extra], fbs };
}

test("leave-one-out removes the head-to-head effect on a team's own schedule", () => {
  const { games, fbs } = league();
  // Benchmark = 3rd-best other team: one of the untouched teams 3-6, so only opponent ratings differ.
  const loo = computeSos(games, fbs, noPriors, [], { benchmarkRank: 3 });
  const shared = computeSos(games, fbs, noPriors, [], { leaveOneOut: false, benchmarkRank: 3 });
  // Team 1 crushed team 2, so with one shared fit team 2 looks weak and team 1's schedule looks easy.
  // Without team 1's games, team 2 is an ordinary opponent, so the schedule is harder (lower win rate).
  assert.ok(loo.get(1)! < shared.get(1)!, `loo ${loo.get(1)} should be below shared ${shared.get(1)}`);
  // Team 2 lost by 40 to team 1: the shared fit makes team 1 look great, so team 2's schedule looks hard.
  assert.ok(loo.get(2)! > shared.get(2)!, `loo ${loo.get(2)} should be above shared ${shared.get(2)}`);
});

test("a schedule of strong opponents is harder than one of weak opponents", () => {
  // Teams 1-3 beat everyone else by 30; teams 4-6 lose. Team 7 plays 1-3, team 8 plays 4-6.
  const fbs = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
  const games: ModelGame[] = [];
  for (const s of [1, 2, 3]) for (const w of [4, 5, 6]) games.push(game(s, w, 40, 10, true));
  for (const s of [1, 2, 3]) games.push(game(s, 7, 30, 20, true));
  for (const w of [4, 5, 6]) games.push(game(w, 8, 30, 20, true));
  const sos = computeSos(games, fbs, noPriors);
  assert.ok(sos.get(7)! < sos.get(8)!, `team 7 ${sos.get(7)} vs team 8 ${sos.get(8)}`);
});

test("home field: the same opponent is easier for an average team at home than on the road", () => {
  // Home teams always win by 10 in the core league, so the fitted home field is clearly positive.
  const core: ModelGame[] = [];
  for (const [h, a] of [[1, 2], [2, 3], [3, 4], [4, 1], [1, 3], [2, 4], [3, 1], [4, 2]]) core.push(game(h, a, 30, 20));
  // Team 5 hosts team 1; team 6 visits team 1. Same opponent, only the site differs. Shared fit keeps
  // team 1's rating identical for both.
  const games = [...core, game(5, 1, 20, 20), game(1, 6, 20, 20)];
  const sos = computeSos(games, new Set([1, 2, 3, 4, 5, 6]), noPriors, [], { leaveOneOut: false });
  assert.ok(sos.get(5)! > sos.get(6)!, `home ${sos.get(5)} should exceed road ${sos.get(6)}`);
});

test("FCS opponents are rated from results, not a fixed value, and count toward the schedule", () => {
  // Team 1 plays FCS team 90 (not in fbs) and loses badly: the pooled FCS team is strong, so that game is hard.
  // The same schedule where team 1 wins big against 90 makes the FCS pool weak, so the game is easy.
  const fbs = new Set([1, 2, 3, 4]);
  const common = [game(2, 3, 20, 20, true), game(3, 4, 20, 20, true), game(2, 4, 20, 20, true), game(1, 2, 20, 20, true), game(1, 3, 20, 20, true)];
  const fcsStrong = computeSos([...common, game(1, 90, 3, 45, true), game(2, 91, 7, 38, true), game(3, 92, 10, 41, true)], fbs, noPriors);
  const fcsWeak = computeSos([...common, game(1, 90, 45, 3, true), game(2, 91, 38, 7, true), game(3, 92, 41, 10, true)], fbs, noPriors);
  assert.ok(fcsStrong.get(1)! < fcsWeak.get(1)!, `strong FCS pool ${fcsStrong.get(1)} vs weak ${fcsWeak.get(1)}`);
});

test("benchmark: a schedule's strength is judged for a top team, so strong opponents dominate", () => {
  // Team 7 plays two strong teams and two very weak ones; team 8 plays four middling teams.
  const fbs = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const games: ModelGame[] = [];
  const strong = [1, 2];
  const mid = [3, 4, 5, 6];
  const weak = [9, 10];
  for (const s of strong) for (const m of mid) games.push(game(s, m, 35, 20, true));
  for (const m of mid) for (const w of weak) games.push(game(m, w, 35, 10, true));
  for (const s of strong) games.push(game(s, 7, 30, 20, true));
  for (const w of weak) games.push(game(7, w, 30, 20, true));
  for (const m of mid) games.push(game(m, 8, 27, 24, true));
  const top = computeSos(games, fbs, noPriors, [], { benchmarkRank: 1 });
  // For the best team, the two strong opponents make team 7's schedule the harder one.
  assert.ok(top.get(7)! < top.get(8)!, `team 7 ${top.get(7)} vs team 8 ${top.get(8)}`);
});

test("teams with no games are absent; ranks put the lowest expected win rate first", () => {
  const { games, fbs } = league();
  fbs.add(99);
  const sos = computeSos(games, fbs, noPriors);
  assert.equal(sos.has(99), false);
  const ranks = sosRanks(new Map([[1, 0.6], [2, 0.4], [3, 0.4], [4, 0.9]]));
  assert.deepEqual([...ranks], [[2, 1], [3, 2], [1, 3], [4, 4]]);
});

test("quadrant cutoffs are the home-band ranks minus home field, scaled to the FBS count", () => {
  // 136 teams rated 136 down to 1: home-band ranks 15/40/75 have ratings 122/97/62.
  const ratings = Array.from({ length: 136 }, (_, i) => 136 - i);
  assert.deepEqual(quadrantCutoffs(ratings, 0), [122, 97, 62]);
  assert.deepEqual(quadrantCutoffs(ratings, 3), [119, 94, 59]);
  // 68 teams: ranks scale to 8/20/38 (rounded).
  const half = Array.from({ length: 68 }, (_, i) => 68 - i);
  assert.deepEqual(quadrantCutoffs(half, 0), [61, 49, 31]);
  const cut: [number, number, number] = [7, 5, 3];
  assert.equal(quadrantOf(7, cut), 0);
  assert.equal(quadrantOf(6.9, cut), 1);
  assert.equal(quadrantOf(3, cut), 2);
  assert.equal(quadrantOf(-1, cut), 3);
});

test("with home field, the #15 team is Q1 at home and the road band reaches lower", () => {
  const ratings = Array.from({ length: 136 }, (_, i) => 136 - i); // rank k has rating 137 - k
  const hfa = 4;
  const cut = quadrantCutoffs(ratings, hfa);
  const rating = (rank: number) => 137 - rank;
  // Home game: compare rating - hfa. #15 is Q1, #16 is Q2.
  assert.equal(quadrantOf(rating(15) - hfa, cut), 0);
  assert.equal(quadrantOf(rating(16) - hfa, cut), 1);
  // Road game: compare rating + hfa. Q1 reaches #23 (8 rating points = 8 ranks below #15 here).
  assert.equal(quadrantOf(rating(23) + hfa, cut), 0);
  assert.equal(quadrantOf(rating(24) + hfa, cut), 1);
});

test("a site edge moves an opponent across a quadrant cutoff", () => {
  const cut: [number, number, number] = [10, 0, -10];
  const opp = 8;
  const hfa = 3;
  // Same opponent: on the road it plays like an 11 (Q1), at home like a 5 (Q2).
  assert.equal(quadrantOf(opp - -hfa, cut), 0);
  assert.equal(quadrantOf(opp - hfa, cut), 1);
});

test("quadrant records add up to decided games, skip ties, and put a weak FCS opponent in Q4", () => {
  // Other FBS teams rout FCS teams too (neutral site, so the margin isn't read as home field), so the FCS pool is rated even without team 1's games.
  const { games, fbs } = league([game(1, 90, 56, 0), game(3, 91, 45, 3, true), game(4, 92, 42, 7, true), game(5, 93, 48, 0, true), game(6, 94, 41, 10, true)]);
  const { quadrants } = computeSchedule(games, fbs, noPriors);
  for (const id of fbs) {
    const q = quadrants.get(id)!;
    const decided = games.filter((g) => (g.homeId === id || g.awayId === id) && g.homePoints !== g.awayPoints);
    assert.equal(q.reduce((a, r) => a + r.w + r.l, 0), decided.length, `team ${id}`);
  }
  const t1 = quadrants.get(1)!;
  assert.ok(t1[3].w >= 1, "FCS blowout win should be in Q4");
});

test("computeSos matches computeSchedule's win rates", () => {
  const { games, fbs } = league();
  assert.deepEqual([...computeSos(games, fbs, noPriors)], [...computeSchedule(games, fbs, noPriors).winPct]);
});
