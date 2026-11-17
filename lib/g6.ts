// Group of 6 membership, shared by the rankings table's G6 toggle and the blind ranking's G6 mode. Pure and unit-tested.
//
// G6 (Nick, 2026-11-06): the non-power conferences as stored in `team_seasons.conference`, the Pac-12 only from 2026
// (the rebuilt league), plus UConn (an FBS independent since 2020; before that it played in the American).
// Notre Dame is the other FBS independent and is not G6.

export const G6_CONFERENCES: ReadonlySet<string> = new Set([
  "American Athletic",
  "Conference USA",
  "Mid-American",
  "Mountain West",
  "Sun Belt",
]);
export const G6_PAC12_FROM = 2026;
export const G6_INDEPENDENTS: ReadonlySet<string> = new Set(["UConn"]);

export function isG6(conference: string | null, name: string, season: number): boolean {
  if (G6_INDEPENDENTS.has(name)) return true;
  if (conference === null) return false;
  return G6_CONFERENCES.has(conference) || (conference === "Pac-12" && season >= G6_PAC12_FROM);
}
