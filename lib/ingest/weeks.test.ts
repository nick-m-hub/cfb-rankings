import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarWeek } from "../cfbd/types";
import { buildWeekMap, currentStoredWeek, seasonForDate } from "./weeks";

const wk = (week: number, seasonType: string, start: string, end: string): CalendarWeek => ({
  season: 2025, week, seasonType, startDate: `${start}T08:00:00.000Z`, endDate: `${end}T07:59:00.000Z`,
  firstGameStart: `${start}T20:00:00.000Z`, lastGameStart: `${end}T01:00:00.000Z`,
});
const cal = [wk(1, "regular", "2025-08-26", "2025-09-02"), wk(2, "regular", "2025-09-02", "2025-09-09"), wk(1, "postseason", "2025-12-09", "2026-01-21")];
const map = buildWeekMap(cal);

describe("currentStoredWeek", () => {
  it("picks the started week, Sunday after Saturday games", () => {
    assert.equal(currentStoredWeek(cal, map, new Date("2025-09-07T10:00:00Z")), 2);
  });
  it("maps postseason to lastRegular + 1", () => {
    assert.equal(currentStoredWeek(cal, map, new Date("2025-12-20T10:00:00Z")), 3);
  });
  it("is null before the season and well after it", () => {
    assert.equal(currentStoredWeek(cal, map, new Date("2025-07-01T00:00:00Z")), null);
    assert.equal(currentStoredWeek(cal, map, new Date("2026-03-01T00:00:00Z")), null);
  });
  it("attributes January to the prior season", () => {
    assert.equal(seasonForDate(new Date("2026-01-05T00:00:00Z")), 2025);
    assert.equal(seasonForDate(new Date("2026-09-05T00:00:00Z")), 2026);
  });
});
