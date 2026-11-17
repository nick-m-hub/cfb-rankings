import assert from "node:assert/strict";
import { test } from "node:test";
import { accentColor, hexColor, logoPath } from "./colors";

test("hexColor normalizes and rejects junk", () => {
  assert.equal(hexColor("#003594"), "#003594");
  assert.equal(hexColor("003594"), "#003594");
  assert.equal(hexColor(" #ABC "), "#aabbcc");
  assert.equal(hexColor(""), null);
  assert.equal(hexColor(null), null);
  assert.equal(hexColor("#12345"), null);
  assert.equal(hexColor("red"), null);
});

test("accentColor skips near-white and near-black", () => {
  assert.equal(accentColor("#003594", "#ffffff"), "#003594");
  assert.equal(accentColor("#ffffff", "#bb0000"), "#bb0000");
  assert.equal(accentColor("#000000", "#ffffff"), null);
  assert.equal(accentColor(null, null), null);
});

test("logoPath by CFBD id", () => {
  assert.equal(logoPath(2005), "/logos/2005.png");
  assert.equal(logoPath(2005, true), "/logos/dark/2005.png");
});
