import assert from "node:assert/strict";
import { test } from "node:test";
import { crowdWeekStart } from "./constants";
import { buildFeatures } from "./features";
import { fitPlackettLuce } from "./fit";
import { fitVoter, sessionWeights } from "./model";
import { pickTriple, tripleKey } from "./pick";
import { meanOrNull, rankBy, weightedMean } from "./stats";
import { sortRows } from "./table";
import type { BlindCard, Vote } from "./types";

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rng: () => number) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

function kendall(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) s += Math.sign(a[i] - a[j]) * Math.sign(b[i] - b[j]);
  return s / ((a.length * (a.length - 1)) / 2);
}

/** Synthetic world: 130 teams with 7 stats, a voter with their own random tastes, and hidden per-team offsets. */
function world(seed: number) {
  const rng = mulberry32(seed);
  const n = 130;
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const rows = ids.map(() => Array.from({ length: 7 }, () => normal(rng)));
  const w = Array.from({ length: 7 }, () => Math.max(-0.2, 0.6 + 0.5 * normal(rng)));
  const truth = rows.map((x) => x.reduce((a, v, k) => a + v * w[k], 0) + 0.3 * normal(rng));
  return { rng, ids, rows, truth };
}

/**
 * Plays `rounds` rounds; the voter ranks by truth + Gumbel noise (Plackett-Luce).
 * "app" = what the page does (default stat weights + information-driven cards);
 * "plain" = the original no-prior fit with closeness-based cards.
 */
function simulate(seed: number, rounds: number, mode: "app" | "plain" = "app") {
  const { rng, ids, rows, truth } = world(seed);
  const f = { ids, rows };
  const fit = (v: Vote[]) => (mode === "app" ? fitVoter(v, f) : fitPlackettLuce(v, ids, rows));
  const features = new Map(ids.map((id, i) => [id, rows[i]]));
  const votes: Vote[] = [];
  const counts = new Map<number, number>();
  const seen = new Set<string>();
  let scores: Map<number, number> | undefined;
  let weights: number[] = new Array(7).fill(0.6);
  for (let r = 0; r < rounds; r++) {
    const t = pickTriple({ ids, counts, seen, rng, ...(mode === "app" ? { features, weights } : { scores }) })!;
    seen.add(tripleKey(t));
    t.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    const noisy = t.map((id) => ({ id, v: truth[id - 1] - Math.log(-Math.log(rng())) }));
    noisy.sort((a, b) => b.v - a.v);
    votes.push([noisy[0].id, noisy[1].id, noisy[2].id]);
    if (votes.length >= 3) {
      const cur = fit(votes);
      scores = cur.scores;
      weights = cur.weights;
    }
  }
  const final = fit(votes);
  return { tau: kendall(ids.map((id) => final.scores.get(id)!), truth), votes };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

test("the page's model recovers a hidden ranking from 15 rounds, and improves with more", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const taus15 = seeds.map((s) => simulate(s, 15).tau);
  const taus40 = seeds.map((s) => simulate(s, 40).tau);
  console.log(`  mean tau: 15 rounds ${mean(taus15).toFixed(2)}, 40 rounds ${mean(taus40).toFixed(2)}`);
  assert.ok(mean(taus15) > 0.6, `15 rounds mean tau ${mean(taus15)}`);
  assert.ok(mean(taus40) > mean(taus15), `40 rounds ${mean(taus40)} should beat 15 rounds ${mean(taus15)}`);
});

test("default stat weights plus information-driven cards beat the plain fit at 15 rounds", () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
  const app = mean(seeds.map((s) => simulate(s, 15, "app").tau));
  const plain = mean(seeds.map((s) => simulate(s, 15, "plain").tau));
  console.log(`  mean tau at 15 rounds: page model ${app.toFixed(2)} vs plain fit ${plain.toFixed(2)}`);
  assert.ok(app > plain + 0.03, `page model ${app} vs plain ${plain}`);
});

test("fit is deterministic and ranks by id with no votes", () => {
  const { ids, rows } = world(7);
  const empty = fitPlackettLuce([], ids, rows);
  assert.deepEqual([...empty.ranks.values()].slice(0, 3), [1, 2, 3]);
  const { votes } = simulate(7, 30, "plain");
  const a = fitPlackettLuce(votes, ids, rows);
  const b = fitPlackettLuce(votes, ids, rows);
  assert.deepEqual([...a.scores], [...b.scores]);
});

test("fit ignores votes with unknown or repeated ids", () => {
  const { ids, rows } = world(3);
  const r = fitPlackettLuce([[1, 2, 999], [1, 1, 2]], ids, rows);
  assert.equal(r.votesUsed, 0);
});

test("a voter who only values record gets a record-heavy weight vector", () => {
  const rng = mulberry32(11);
  const cards: BlindCard[] = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    wins: Math.floor(rng() * 13),
    losses: 0,
    games: 12,
    margin: rng() * 20 - 10,
    sos: 0.4 + rng() * 0.2,
    sosRank: i + 1,
    offEpa: rng() * 0.4 - 0.1,
    defEpa: rng() * 0.4 - 0.1,
    offEpaRank: i + 1,
    defEpaRank: i + 1,
    postgameWp: 0.3 + rng() * 0.5,
    bestWin: null,
    worstLoss: null,
  }));
  cards.forEach((c) => (c.losses = 12 - c.wins));
  const f = buildFeatures(cards);
  const ids = f.ids;
  const votes: Vote[] = [];
  for (let r = 0; r < 60; r++) {
    const t = pickTriple({ ids, counts: new Map(), seen: new Set(), rng })!;
    const sorted = [...t].sort((a, b) => cards[b - 1].wins - cards[a - 1].wins);
    votes.push([sorted[0], sorted[1], sorted[2]]);
  }
  const { weights } = fitPlackettLuce(votes, ids, f.rows);
  const biggest = weights.indexOf(Math.max(...weights.map((v) => v)));
  assert.equal(biggest, 0, `weights ${weights.map((v) => v.toFixed(2))}`);
});

test("pickTriple never repeats a seen triple, prefers unseen teams, and returns null for tiny pools", () => {
  const rng = mulberry32(5);
  const ids = Array.from({ length: 20 }, (_, i) => i + 1);
  const counts = new Map(ids.slice(3).map((id) => [id, 9]));
  const t = pickTriple({ ids, counts, seen: new Set(), rng })!;
  assert.equal(new Set(t).size, 3);
  assert.ok(t.filter((id) => id <= 3).length >= 2, `picked ${t}`);
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const p = pickTriple({ ids, counts: new Map(), seen, rng })!;
    assert.ok(!seen.has(tripleKey(p)));
    seen.add(tripleKey(p));
  }
  assert.equal(pickTriple({ ids: [1, 2], counts: new Map(), seen: new Set(), rng }), null);
});

test("crowdWeekStart is the Eastern Monday of the week", () => {
  assert.equal(crowdWeekStart(new Date("2026-11-04T15:00:00Z")), "2026-11-02"); // Wed
  assert.equal(crowdWeekStart(new Date("2026-11-02T05:30:00Z")), "2026-11-02"); // Mon 00:30 ET
  assert.equal(crowdWeekStart(new Date("2026-11-02T04:30:00Z")), "2026-10-26"); // Sun 23:30 ET (EST, UTC-5)
  assert.equal(crowdWeekStart(new Date("2026-11-09T02:00:00Z")), "2026-11-02"); // Sun 21:00 ET
  assert.equal(crowdWeekStart(new Date("2026-03-09T03:30:00Z")), "2026-03-02"); // Sun 23:30 EDT across DST
});

test("weighted mean skips missing values and zero weights; plain mean ignores nulls", () => {
  assert.equal(weightedMean([{ value: 1, weight: 1 }, { value: 3, weight: 3 }]), 2.5);
  assert.equal(weightedMean([{ value: null, weight: 5 }, { value: 2, weight: 1 }, { value: 9, weight: 0 }]), 2);
  assert.equal(weightedMean([{ value: null, weight: 5 }]), null);
  assert.equal(weightedMean([]), null);
  assert.equal(meanOrNull([0.5, null, 1]), 0.75);
  assert.equal(meanOrNull([null]), null);
});

test("rankBy ranks high or low first, skips nulls, breaks ties by id", () => {
  const v = new Map<number, number | null>([[1, 0.2], [2, null], [3, 0.5], [4, 0.2]]);
  assert.deepEqual([...rankBy(v, "high")], [[3, 1], [1, 2], [4, 3]]);
  assert.deepEqual([...rankBy(v, "low")], [[1, 1], [4, 2], [3, 3]]);
});

test("features: missing EPA and win probability fill with the mean and do not break the fit", () => {
  const base = (id: number, margin: number, epa: number | null): BlindCard => ({
    id, wins: 6, losses: 2, games: 8, margin, sos: 0.5, sosRank: id, offEpa: epa, defEpa: epa, offEpaRank: null,
    defEpaRank: null, postgameWp: epa === null ? null : 0.5 + epa, bestWin: null, worstLoss: null,
  });
  const f = buildFeatures([base(1, 5, 0.1), base(2, 10, null), base(3, -3, -0.1)]);
  assert.equal(f.rows[0].length, 8);
  assert.ok(f.rows.flat().every(Number.isFinite));
  assert.equal(f.rows[1][3], 0); // the team with no EPA sits at the column mean
  const allMissing = buildFeatures([base(1, 5, null), base(2, 7, null)]);
  assert.ok(allMissing.rows.every((r) => r[3] === 0 && r[4] === 0 && r[5] === 0));
});

test("sortRows sorts both ways, keeps missing values last, and breaks ties by the tie function", () => {
  const rows = [
    { name: "b", v: 2 as number | null },
    { name: "a", v: 2 as number | null },
    { name: "c", v: null },
    { name: "d", v: 9 as number | null },
  ];
  const tie = (x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name);
  assert.deepEqual(sortRows(rows, (r) => r.v, "asc", tie).map((r) => r.name), ["a", "b", "d", "c"]);
  assert.deepEqual(sortRows(rows, (r) => r.v, "desc", tie).map((r) => r.name), ["d", "a", "b", "c"]);
  assert.deepEqual(sortRows(rows, (r) => r.name, "desc", tie).map((r) => r.name), ["d", "c", "b", "a"]);
  assert.deepEqual(rows.map((r) => r.name), ["b", "a", "c", "d"]); // input untouched
});

test("information-driven picking prefers teams whose stats differ over near-identical clones", () => {
  // Teams 1-3 are clones (no information from ranking them); teams 4-6 differ in different stats.
  const features = new Map<number, number[]>([
    [1, [0, 0]], [2, [0, 0]], [3, [0, 0]],
    [4, [2, 0]], [5, [0, 2]], [6, [-2, -2]],
  ]);
  for (const seed of [1, 2, 3, 4, 5]) {
    const t = pickTriple({ ids: [1, 2, 3, 4, 5, 6], counts: new Map(), seen: new Set(), features, weights: [0, 0], rng: mulberry32(seed) })!;
    assert.equal(tripleKey(t), "4-5-6", `seed ${seed} picked ${t}`);
  }
});

test("minimum rounds is 15", async () => {
  const { MIN_PERSONAL_ROUNDS } = await import("./constants");
  assert.equal(MIN_PERSONAL_ROUNDS, 15);
});

test("crowd: one heavy session counts as at most the cap", () => {
  const sessions = [...Array(100).fill("spam"), "a", "b", "b"];
  const w = sessionWeights(sessions, 40);
  const total = (id: string) => w.filter((_, i) => sessions[i] === id).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(total("spam") - 40) < 1e-9);
  assert.equal(total("a"), 1);
  assert.equal(total("b"), 2);
});

test("crowd: down-weighted spam can't flip a pairwise ranking", () => {
  const ids = [1, 2, 3, 4];
  const features = ids.map(() => [0]);
  // 40 honest sessions say 1 > 2 > 3; one session says 2 > 1 > 4 three hundred times.
  const votes: Vote[] = [...Array(40).fill([1, 2, 3]), ...Array(300).fill([2, 1, 4])];
  const sessions = [...Array.from({ length: 40 }, (_, i) => `s${i}`), ...Array(300).fill("spam")];
  const plain = fitPlackettLuce(votes, ids, features);
  const capped = fitPlackettLuce(votes, ids, features, { voteWeights: sessionWeights(sessions, 10) });
  assert.ok(plain.ranks.get(2)! < plain.ranks.get(1)!, "unweighted, the spammer wins");
  assert.ok(capped.ranks.get(1)! < capped.ranks.get(2)!, "capped, the crowd wins");
});
