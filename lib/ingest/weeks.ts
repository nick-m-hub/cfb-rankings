import type { CalendarWeek, SeasonType } from "../cfbd/types";

/**
 * Week convention: CFBD restarts numbering at 1 for the postseason. We store a single integer per
 * season, with the postseason as (last regular week + 1).
 */
export interface WeekMap {
  lastRegular: number;
  /** Stored week for the postseason, or null if the season has none in the calendar. */
  postseason: number | null;
  /** Every stored week for the season, ascending. */
  weeks: number[];
  storedWeek(seasonType: SeasonType, cfbdWeek: number): number;
}

export function buildWeekMap(calendar: readonly CalendarWeek[]): WeekMap {
  const regular = calendar.filter((c) => c.seasonType === "regular").map((c) => c.week);
  if (regular.length === 0) throw new Error("Calendar has no regular-season weeks");
  if (Math.min(...regular) < 1) {
    throw new Error(`Calendar has regular week ${Math.min(...regular)}; schema requires week >= 1`);
  }
  const lastRegular = Math.max(...regular);
  const hasPost = calendar.some((c) => c.seasonType === "postseason");
  const postseason = hasPost ? lastRegular + 1 : null;
  const weeks = Array.from({ length: lastRegular }, (_, i) => i + 1);
  if (postseason !== null) weeks.push(postseason);

  return {
    lastRegular,
    postseason,
    weeks,
    storedWeek(seasonType, cfbdWeek) {
      if (seasonType === "postseason") {
        if (postseason === null) throw new Error("Postseason data but no postseason in calendar");
        return postseason;
      }
      if (cfbdWeek < 1 || cfbdWeek > lastRegular) {
        throw new Error(`Regular-season week ${cfbdWeek} outside 1..${lastRegular}`);
      }
      return cfbdWeek;
    },
  };
}

/** CFBD seasons start in late August; January games belong to the previous season. */
export function seasonForDate(now: Date): number {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const DAY_MS = 86_400_000;

/**
 * The stored week "in progress" at `now`: the latest calendar week that has started. Null before the
 * season starts or more than two weeks after its last week ended (offseason; nothing to snapshot).
 */
export function currentStoredWeek(calendar: readonly CalendarWeek[], weekMap: WeekMap, now: Date): number | null {
  const started = calendar
    .filter((c) => Date.parse(c.startDate) <= now.getTime())
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  const latest = started.at(-1);
  if (!latest) return null;
  const lastEnd = Math.max(...calendar.map((c) => Date.parse(c.endDate)));
  if (now.getTime() > lastEnd + 14 * DAY_MS) return null;
  return weekMap.storedWeek(latest.seasonType as SeasonType, latest.week);
}
