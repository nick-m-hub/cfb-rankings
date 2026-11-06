import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BEST_PARAMS, computeBest, priorRatings, REFERENCE_BEST_PARAMS } from "./best";
import { cholesky, choleskySolve, normCdf, percentile } from "./math";
import { bestWinWorstLoss, computeResume, RATING_TIE_TOLERANCE } from "./resume";
import type { ModelGame, PriorInput, TeamGameStat } from "./types";

// Golden fixture: 2026 games through Nov 4 (CFBD), with outputs from the Python reference models
// used to build the CFB Fun workbook.
interface Fixture {
  fbs: number[];
  names: Record<string, string>;
  games: ModelGame[];
  stats: TeamGameStat[];
  priors: Record<string, PriorInput>;
  expected: {
    best: Record<string, Record<string, number | null>>;
    bestHfa: number;
    fcsBest: number;
    resume: Record<string, number>;
    resumeHfa: number;
    bench: number;
  };
}
const fx: Fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "season2026-week10.json"), "utf8"));
const fbs = new Set(fx.fbs);
const priors = new Map(Object.entries(fx.priors).map(([k, v]) => [Number(k), v]));
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

test("normCdf matches known values", () => {
  near(normCdf(0), 0.5, 1e-15, "0");
  near(normCdf(1.96), 0.9750021048517795, 1e-12, "1.96");
  near(normCdf(-3), 0.0013498980316301, 1e-14, "-3");
  near(normCdf(0.3), 0.6179114221889527, 1e-13, "0.3");
});

test("cholesky solve recovers x", () => {
  const a = [
    [4, 2, 0.4],
    [2, 3, 0.5],
    [0.4, 0.5, 2],
  ];
  const x = choleskySolve(cholesky(a), [1, 2, 3]);
  a.forEach((row, i) => near(row.reduce((s, v, j) => s + v * x[j], 0), [1, 2, 3][i], 1e-12, `row ${i}`));
});

test("percentile interpolates like numpy", () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  near(percentile([10, 20, 30], 10), 12, 1e-12, "p10");
});

test("best-team model reproduces the Python reference", () => {
  const res = computeBest(fx.games, fbs, priors, fx.stats, REFERENCE_BEST_PARAMS);
  near(res.hfa, fx.expected.bestHfa, 1e-6, "hfa");
  near(res.fcsRating, fx.expected.fcsBest, 1e-6, "fcs");
  for (const id of fx.fbs) {
    const got = res.teams.get(id)!;
    const exp = fx.expected.best[id];
    for (const k of ["rating", "offense", "defense", "ratingResultsOnly", "offSuccessRate", "defSuccessRate"] as const) {
      near(got[k]!, exp[k]!, 1e-6, `${fx.names[id]} ${k}`);
    }
    if (exp.prior === null) assert.equal(got.prior, null);
    else near(got.prior!, exp.prior, 1e-9, `${fx.names[id]} prior`);
  }
});

test("faded prior: weaker pull than the reference once games are played", () => {
  const cur = computeBest(fx.games, fbs, priors, fx.stats);
  const ref = computeBest(fx.games, fbs, priors, fx.stats, REFERENCE_BEST_PARAMS);
  // Mid-season the current rating sits closer to the results-only fit than the reference does.
  const gap = (r: typeof cur) => [...r.teams.values()].reduce((s, t) => s + Math.abs(t.rating - t.ratingResultsOnly), 0);
  assert.ok(gap(cur) < gap(ref));
  assert.ok(BEST_PARAMS.priorHalfLife > 0);
});

test("FCS teams: rated individually from FCS-vs-FCS games, pooled when fcsRidge is Infinity", () => {
  // Two FCS teams (900, 901) each lose to the same FBS teams by different margins, and 900 beats 901 badly.
  const ids = [...fbs].slice(0, 4);
  const games: ModelGame[] = [...fx.games];
  let gid = 9_000_000;
  for (const id of ids) {
    games.push({ id: gid++, week: 1, homeId: id, awayId: 900, homePoints: 24, awayPoints: 17, neutral: false });
    games.push({ id: gid++, week: 1, homeId: id, awayId: 901, homePoints: 56, awayPoints: 0, neutral: false });
  }
  games.push({ id: gid++, week: 2, homeId: 900, awayId: 901, homePoints: 42, awayPoints: 3, neutral: false });
  const ind = computeBest(games, fbs, priors, fx.stats);
  assert.ok(ind.fcsRatings.get(900)! > ind.fcsRatings.get(901)! + 10);
  const pooled = computeBest(games, fbs, priors, fx.stats, { fcsRidge: Infinity });
  assert.equal(pooled.fcsRatings.size, 0);
  // The resume model credits a win over the strong FCS team more than one over the weak one.
  const res = computeResume(games, fbs, { sims: 0 });
  const credit = (opp: number) => res.teams.get(ids[0])!.games.find((g) => g.opponentId === opp)!.credit;
  assert.ok(credit(900) > credit(901));
});

test("offense + defense = rating", () => {
  const res = computeBest(fx.games, fbs, priors, fx.stats);
  for (const t of res.teams.values()) near(t.offense + t.defense, t.rating, 1e-9, String(t.teamId));
});

test("resume model reproduces the Python reference", () => {
  const res = computeResume(fx.games, fbs, { sims: 0, leaveOneOut: false, fcsRidge: Infinity });
  near(res.hfa, fx.expected.resumeHfa, 1e-6, "hfa");
  near(res.benchmarkRating, fx.expected.bench, 1e-6, "benchmark");
  for (const id of fx.fbs) near(res.teams.get(id)!.score, fx.expected.resume[id], 1e-6, fx.names[id]);
});

test("resume leave-one-out: beating a team doesn't lower your credit for it", () => {
  const shared = computeResume(fx.games, fbs, { sims: 0, leaveOneOut: false });
  const loo = computeResume(fx.games, fbs, { sims: 0 });
  // Wins lower the beaten team's in-sample rating, so leave-one-out credit is higher on average for winners.
  const top = [...shared.teams.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  const gain = top.reduce((s, t) => s + (loo.teams.get(t.teamId)!.score - t.score), 0) / top.length;
  assert.ok(gain > 0, `mean gain ${gain}`);
  // Same games and results either way; only the benchmark odds move, and only a little.
  for (const t of loo.teams.values()) {
    const s = shared.teams.get(t.teamId)!;
    assert.equal(t.games.length, s.games.length);
    near(t.score, s.score, 1, `${fx.names[t.teamId]} score`);
  }
});

test("resume simulation: odds in [0,1], reproducible, leaders near certain", () => {
  const a = computeResume(fx.games, fbs, { sims: 200 });
  const b = computeResume(fx.games, fbs, { sims: 200 });
  const order = [...a.teams.values()].sort((x, y) => y.score - x.score);
  for (const t of a.teams.values()) {
    assert.ok(t.topOdds >= 0 && t.topOdds <= 1);
    assert.equal(t.topOdds, b.teams.get(t.teamId)!.topOdds);
    assert.ok(t.rankRange[0] <= t.rankRange[1]);
  }
  assert.ok(order[0].topOdds > 0.95, "No. 1 resume should be a near-lock");
  assert.ok(order.at(-1)!.topOdds === 0, "last place never makes the top 12");
});

const credit = (gameId: number, week: number, opponentId: number, pf: number, pa: number) => ({
  gameId, week, opponentId, site: "home" as const, pointsFor: pf, pointsAgainst: pa, won: pf > pa, benchmarkWinProb: 0.5, credit: 0,
});

test("best win / worst loss are the best team beaten and worst team lost to", () => {
  const strength = new Map([[1, 10], [2, 0], [3, -5], [4, 7], [5, -5]]);
  const of = (id: number) => strength.get(id)!;
  const games = [
    credit(10, 1, 1, 30, 20), // beat the strongest (10)
    credit(11, 2, 4, 14, 21), // lost to 7
    credit(12, 3, 2, 17, 24), // lost to 0
    credit(13, 4, 3, 28, 10), // beat -5
    credit(14, 5, 5, 20, 27), // lost to -5: tied with game 15 on strength, so the earlier game wins
    credit(15, 6, 3, 10, 20), // lost to -5
    credit(16, 7, 4, 21, 21), // tie: counts as neither
  ];
  const { bestWin, worstLoss } = bestWinWorstLoss(games, of);
  assert.equal(bestWin!.opponentId, 1);
  assert.equal(worstLoss!.gameId, 14);
  assert.deepEqual(bestWinWorstLoss([], of), { bestWin: null, worstLoss: null });
  assert.equal(bestWinWorstLoss([credit(1, 1, 1, 20, 20)], of).worstLoss, null);
  // A loss to a good team is not the "worst" loss just because it was at home or by a lot.
  assert.equal(bestWinWorstLoss([credit(1, 1, 1, 0, 50), credit(2, 2, 2, 20, 21)], of).worstLoss!.opponentId, 2);
});

test("best win / worst loss: opponents within the tolerance are tied and the record decides", () => {
  const strength = new Map([[1, -5.5], [2, -7.6], [3, -12.5], [4, 12.4], [5, 13.7], [6, -0.3]]);
  const record = new Map([[1, 1 / 9], [2, 4 / 9], [3, 3 / 8], [4, 0.75], [5, 0.875], [6, 0.625]]);
  const of = (id: number) => strength.get(id)!;
  const opts = { tolerance: 4, recordOf: (id: number) => record.get(id)! };

  // Wins over opponents rated -5.5 (1-8) and -7.6 (4-5): 2.1 apart, inside the tolerance, so the better
  // record (4-5) is the best win. The -12.5 team is outside the tolerance, whatever its record.
  const wins = [credit(1, 1, 1, 30, 10), credit(2, 2, 2, 30, 10), credit(3, 3, 3, 30, 10)];
  assert.equal(bestWinWorstLoss(wins, of, opts).bestWin!.opponentId, 2);
  // Without a tolerance the stronger rating alone decides.
  assert.equal(bestWinWorstLoss(wins, of).bestWin!.opponentId, 1);

  // Losses to 12.4 (6-2), 13.7 (7-1) and -0.3 (5-3): only the -0.3 team is near the bottom.
  const losses = [credit(4, 1, 4, 10, 30), credit(5, 2, 5, 10, 30), credit(6, 3, 6, 10, 30)];
  assert.equal(bestWinWorstLoss(losses, of, opts).worstLoss!.opponentId, 6);

  // Two losses within the tolerance: the WORSE record is the worst loss, even with the higher rating.
  const close = [credit(7, 1, 1, 10, 30), credit(8, 2, 2, 10, 30)]; // -5.5 (1-8) and -7.6 (4-5)
  assert.equal(bestWinWorstLoss(close, of, opts).worstLoss!.opponentId, 1);
  // The tolerance is measured from the extreme, so a team 4.1 points above it is not tied.
  const far = new Map([[1, 0], [2, 4.1]]);
  const farRec = { tolerance: 4, recordOf: (id: number) => (id === 2 ? 0.1 : 0.9) };
  assert.equal(bestWinWorstLoss([credit(9, 1, 1, 10, 30), credit(10, 2, 2, 10, 30)], (id) => far.get(id)!, farRec).worstLoss!.opponentId, 1);
  // Full tie on rating and record: the earlier game wins.
  const tie = [credit(12, 5, 1, 10, 30), credit(11, 2, 1, 10, 30)];
  assert.equal(bestWinWorstLoss(tie, of, opts).worstLoss!.gameId, 11);
});

test("prior: teams without last season's FPI get none; talent z is centered", () => {
  const p = priorRatings([1, 2, 3], new Map<number, PriorInput>([
    [1, { prevFpi: 10, returningPpa: 0.5, talent: 900 }],
    [2, { prevFpi: -5, returningPpa: null, talent: 700 }],
    [3, { prevFpi: null, returningPpa: 0.7, talent: 800 }],
  ]));
  assert.equal(p.has(3), false);
  assert.ok(p.get(1)! > p.get(2)!);
});

test("no games: resume scores are zero", () => {
  const res = computeResume([], fbs, { sims: 0 });
  for (const t of res.teams.values()) assert.equal(t.score, 0);
});

test("scoreWeek: details, ranks and week filtering", async () => {
  const { scoreWeek } = await import("./run");
  const data = {
    season: 2026,
    fbsIds: fbs,
    games: fx.games,
    stats: fx.stats,
    priors,
    names: new Map(Object.entries(fx.names).map(([k, v]) => [Number(k), v])),
  };
  const full = scoreWeek(data, 99, 0);
  const ranksSeen = [...full.details.values()].map((d) => d.best.rank).sort((a, b) => a - b);
  assert.deepEqual(ranksSeen, Array.from({ length: fbs.size }, (_, i) => i + 1));
  const sos = [...full.details.values()].map((d) => d.sos).filter((s): s is NonNullable<typeof s> => s !== undefined);
  assert.equal(sos.length, fbs.size, "every FBS team with games has a schedule strength");
  assert.deepEqual(sos.map((s) => s.rank).sort((a, b) => a - b), Array.from({ length: sos.length }, (_, i) => i + 1));
  assert.ok(sos.every((s) => s.winPct > 0 && s.winPct < 1));
  const spread = Math.max(...sos.map((s) => s.winPct)) - Math.min(...sos.map((s) => s.winPct));
  assert.ok(spread > 0.05 && spread < 0.6, `schedule strength spread ${spread}`);
  // Best win / worst loss: the pick is within the tolerance of the strongest win / weakest loss, and no
  // other candidate inside that band has a better (best win) or worse (worst loss) record.
  const strengthOf = (id: number) => full.best.teams.get(id)?.rating ?? full.best.fcsRatings.get(id) ?? full.best.fcsRating;
  const rec = new Map<number, { w: number; l: number }>();
  for (const g of fx.games) {
    if (g.homePoints === g.awayPoints) continue;
    for (const [id, won] of [[g.homeId, g.homePoints > g.awayPoints], [g.awayId, g.awayPoints > g.homePoints]] as const) {
      const r = rec.get(id) ?? { w: 0, l: 0 };
      if (won) r.w++;
      else r.l++;
      rec.set(id, r);
    }
  }
  const pct = (id: number) => (rec.get(id) && rec.get(id)!.w + rec.get(id)!.l > 0 ? rec.get(id)!.w / (rec.get(id)!.w + rec.get(id)!.l) : 0.5);
  let checked = 0;
  for (const [id, d] of full.details) {
    const games = full.resume.teams.get(id)!.games;
    const wins = games.filter((g) => g.pointsFor > g.pointsAgainst).map((g) => g.opponentId);
    const losses = games.filter((g) => g.pointsFor < g.pointsAgainst).map((g) => g.opponentId);
    if (wins.length) {
      const top = Math.max(...wins.map(strengthOf));
      const band = wins.filter((o) => strengthOf(o) >= top - RATING_TIE_TOLERANCE);
      assert.ok(band.includes(d.resume.bestWin!.opponentId!), "best win is inside the tolerance band");
      assert.equal(pct(d.resume.bestWin!.opponentId!), Math.max(...band.map(pct)));
    } else assert.equal(d.resume.bestWin, null);
    if (losses.length) {
      const bottom = Math.min(...losses.map(strengthOf));
      const band = losses.filter((o) => strengthOf(o) <= bottom + RATING_TIE_TOLERANCE);
      assert.ok(band.includes(d.resume.worstLoss!.opponentId!), "worst loss is inside the tolerance band");
      assert.equal(pct(d.resume.worstLoss!.opponentId!), Math.min(...band.map(pct)));
    } else assert.equal(d.resume.worstLoss, null);
    checked++;
  }
  assert.equal(checked, fbs.size);
  const top = [...full.details].find(([, d]) => d.best.rank === 1)!;
  // The notebook's constant prior had Ohio State #1; with the prior fading (8 games in), Alabama leads.
  assert.equal(fx.names[top[0]], "Alabama");
  // Texas allows the lowest opponent-adjusted success rate (workbook: defense SR #1).
  const tex = [...full.details].find(([id]) => fx.names[id] === "Texas")!;
  assert.equal(tex[1].best.defSuccessRateRank, 1);
  const res1 = [...full.details].find(([, d]) => d.resume.rank === 1)!;
  assert.equal(fx.names[res1[0]], "Miami");
  assert.ok(res1[1].resume.worstLoss === null && res1[1].resume.bestWin !== null);
  // Week 1 only uses week-1 games.
  const w1 = scoreWeek(data, 1, 0);
  const w1Games = fx.games.filter((g) => g.week <= 1).length;
  const counted = [...w1.resume.teams.values()].reduce((s, t) => s + t.games.length, 0);
  assert.ok(counted <= 2 * w1Games && counted > 0);
});
