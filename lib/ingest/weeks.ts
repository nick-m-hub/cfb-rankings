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
