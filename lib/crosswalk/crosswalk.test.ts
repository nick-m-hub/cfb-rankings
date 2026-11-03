import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CfbdTeam } from "../cfbd/types";
import {
  AmbiguousAliasError,
  UnmatchedTeamsError,
  aliasEntriesFromCfbd,
  createCrosswalk,
  normalizeName,
} from "./index";

const team = (id: number, school: string, alternateNames: string[] | null = null): CfbdTeam => ({
  id,
  school,
  mascot: null,
  abbreviation: null,
  alternateNames,
  conference: null,
  division: null,
  classification: "fbs",
});

describe("normalizeName", () => {
  it("folds case, accents, punctuation and whitespace", () => {
    assert.equal(normalizeName("San José  State"), "san jose state");
    assert.equal(normalizeName("Miami (OH)"), "miami oh");
    assert.equal(normalizeName("Texas A&M"), "texas a and m");
    assert.equal(normalizeName("Hawai'i"), "hawaii");
  });

  it("keeps distinguishing words", () => {
    assert.notEqual(normalizeName("Ohio"), normalizeName("Ohio State"));
  });
});

describe("createCrosswalk", () => {
  const entries = aliasEntriesFromCfbd(
    [team(1, "San José State", ["SJSU"]), team(2, "Ohio"), team(3, "Ohio State")],
    (t) => t.id,
    { Ohio: ["Ohio Bobcats"] },
  );
  const xw = createCrosswalk(entries);

  it("resolves school names, alternates, and manual aliases", () => {
    assert.equal(xw.lookup("San Jose State"), 1);
    assert.equal(xw.lookup("sjsu"), 1);
    assert.equal(xw.lookup("Ohio Bobcats"), 2);
    assert.equal(xw.lookup("Ohio State"), 3);
  });

  it("returns undefined for unknown names", () => {
    assert.equal(xw.lookup("Nowhere Tech"), undefined);
  });

  it("fails loudly, listing every unmatched name once", () => {
    assert.throws(
      () => xw.resolveAll(["Ohio", "Foo U", "Foo U", "Bar U"], { source: "elo" }),
      (err: unknown) =>
        err instanceof UnmatchedTeamsError && err.unmatched.map((u) => u.name).join() === "Foo U,Bar U",
    );
  });

  it("lets callers skip names that were never meant to match", () => {
    const map = xw.resolveAll(["Ohio", "Idaho State"], { source: "srs", skip: (n) => n === "Idaho State" });
    assert.deepEqual([...map], [["Ohio", 2]]);
  });

  it("rejects an alias that points at two teams", () => {
    assert.throws(
      () =>
        createCrosswalk([
          { alias: "Miami", source: "cfbd", team_id: 10 },
          { alias: "miami", source: "manual", team_id: 11 },
        ]),
      AmbiguousAliasError,
    );
  });

  it("emits one alias row per distinct (alias, source)", () => {
    const rows = createCrosswalk([
      { alias: "A", source: "cfbd", team_id: 1 },
      { alias: "A", source: "cfbd", team_id: 1 },
    ]).aliasRows;
    assert.equal(rows.length, 1);
  });
});
