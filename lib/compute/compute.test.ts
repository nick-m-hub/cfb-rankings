import assert from "node:assert/strict";
import { test } from "node:test";
import { blendScore } from "./blend";
import { computeWeek, type SystemDef } from "./composite";
import { meanSd, zScores } from "./zscore";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

test("z-scores have mean 0 and sd 1", () => {
  const { mean, sd } = meanSd(zScores([3, 9, 12, 20, 41]));
  close(mean, 0);
  close(sd, 1);
});

test("sign flips for lower-is-better systems", () => {
  const hi = zScores([1, 2, 3], true);
  const lo = zScores([1, 2, 3], false);
  hi.forEach((z, i) => close(z, -lo[i]));
  assert.ok(lo[0] > lo[2]);
});

test("degenerate sets give zeros", () => {
  assert.deepEqual(zScores([5, 5, 5]), [0, 0, 0]);
  assert.deepEqual(zScores([7]), [0]);
});

const systems: SystemDef[] = [
  { id: 1, kind: "predictive", higherIsBetter: true },
  { id: 2, kind: "predictive", higherIsBetter: true },
  { id: 3, kind: "resume", higherIsBetter: true },
];
const fbs = new Set([1, 2, 3, 4]);

test("composites handle a team missing from one system, ignore non-FBS, never impute", () => {
  const ratings = [
    ...[10, 20, 30, 40].map((v, i) => ({ systemId: 1, teamId: i + 1, rawValue: v })),
    // team 4 missing from system 2
    ...[1, 2, 3].map((v, i) => ({ systemId: 2, teamId: i + 1, rawValue: v })),
    ...[5, 6, 7, 8].map((v, i) => ({ systemId: 3, teamId: i + 1, rawValue: v })),
    { systemId: 1, teamId: 99, rawValue: 1000 }, // FCS, excluded
  ];
  const { systemZ, composites } = computeWeek(systems, ratings, fbs);
  assert.ok(!systemZ.some((r) => r.teamId === 99));
  const t4 = composites.find((c) => c.teamId === 4)!;
  assert.equal(t4.nSystemsPred, 1);
  assert.equal(composites.find((c) => c.teamId === 1)!.nSystemsPred, 2);
  const z = composites.map((c) => c.zPred!);
  close(meanSd(z).mean, 0);
  close(meanSd(z).sd, 1);
  const zr = composites.map((c) => c.zResume!);
  close(meanSd(zr).sd, 1);
});

test("team with no system on a side is unranked there", () => {
  const ratings = [
    ...[10, 20, 30].map((v, i) => ({ systemId: 1, teamId: i + 1, rawValue: v })),
    ...[5, 6].map((v, i) => ({ systemId: 3, teamId: i + 1, rawValue: v })),
  ];
  const { composites } = computeWeek(systems, ratings, fbs);
  const t3 = composites.find((c) => c.teamId === 3)!;
  assert.equal(t3.zResume, null);
  assert.equal(t3.nSystemsResume, 0);
  assert.notEqual(t3.zPred, null);
});

test("duplicate ratings throw", () => {
  const r = { systemId: 1, teamId: 1, rawValue: 1 };
  assert.throws(() => computeWeek(systems, [r, r], fbs));
});

test("blend at s = 0, 0.5, 1", () => {
  assert.equal(blendScore(0, 2, -1), -1);
  assert.equal(blendScore(0.5, 2, -1), 0.5);
  assert.equal(blendScore(1, 2, -1), 2);
  assert.equal(blendScore(0.5, null, 1), null);
  assert.throws(() => blendScore(1.5, 1, 1));
});

test("reference systems get z-scores but stay out of composites", () => {
  const defs: SystemDef[] = [
    { id: 1, kind: "predictive", higherIsBetter: true },
    { id: 2, kind: "predictive", higherIsBetter: true, inComposite: false },
    { id: 3, kind: "resume", higherIsBetter: true },
  ];
  const ratings = [
    ...[10, 20, 30, 40].map((v, i) => ({ systemId: 1, teamId: i + 1, rawValue: v })),
    ...[40, 30, 20, 10].map((v, i) => ({ systemId: 2, teamId: i + 1, rawValue: v })),
    ...[1, 2, 3, 4].map((v, i) => ({ systemId: 3, teamId: i + 1, rawValue: v })),
  ];
  const { systemZ, composites } = computeWeek(defs, ratings, fbs);
  assert.equal(systemZ.filter((z) => z.systemId === 2).length, 4);
  const z1 = zScores([10, 20, 30, 40]);
  composites.forEach((c, i) => {
    close(c.zPred!, z1[i]);
    assert.equal(c.nSystemsPred, 1);
  });
});
