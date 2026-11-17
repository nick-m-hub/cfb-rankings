// Shared constants and the calendar-week helper for the blind ranking feature.

/** Rounds a visitor must play before their personal ranking unlocks. */
export const MIN_PERSONAL_ROUNDS = 15;
/** Rounds at which the personal ranking is considered well-determined (progress meter target). */
export const TARGET_PERSONAL_ROUNDS = 40;
/**
 * Until a voter's own rounds say otherwise, assume they like every stat a bit (all are oriented so higher
 * is better). Shrinking toward this is what lets ~15 rounds give a usable ranking. Chosen by simulation
 * (24 voters per setting, 10 to 40 rounds): 0.6 with strength 1 beat no prior for typical and
 * independent-stat voters and was within 0.01 of it for contrarian voters at 10 rounds, better after.
 * A stronger pull (3) hurt contrarian voters badly at 10 rounds, so don't raise it.
 */
export const DEFAULT_STAT_WEIGHT = 0.6;
export const DEFAULT_WEIGHT_STRENGTH = 1;
/** Most votes one session counts as in the crowd ranking (its votes are down-weighted beyond this). */
export const CROWD_SESSION_CAP = TARGET_PERSONAL_ROUNDS;
/** Capped votes needed in the season before the crowd ranking is shown. */
export const MIN_CROWD_VOTES = 200;

/** Server-side abuse limits, per anonymous session. */
export const MIN_VOTE_INTERVAL_MS = 1000;
export const MAX_VOTES_PER_DAY = 500;

export const SESSION_COOKIE = "blind_session";
export const CROWD_TAG = "blind-crowd";

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * Calendar week a vote was cast in, stored as `crowd_week` (the crowd ranking reset on it until 2026-11-17; it now
 * spans the season). Returns the Monday 00:00 America/New_York that starts the week containing `now`, as YYYY-MM-DD.
 */
export function crowdWeekStart(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const back = WEEKDAY_INDEX[get("weekday")];
  const monday = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")) - back));
  return monday.toISOString().slice(0, 10);
}
