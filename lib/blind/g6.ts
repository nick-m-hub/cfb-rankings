// G6-only records for the blind ranking's G6 mode. Membership lives in lib/g6.ts. Pure and unit-tested.

export interface G6Game {
  homeId: number;
  awayId: number;
  homePoints: number | null;
  awayPoints: number | null;
  homePostgameWp?: number | null;
  awayPostgameWp?: number | null;
}

export interface G6Stats {
  w: number;
  l: number;
  /** Average postgame win probability over decided G6 games (null if none have it). */
  postgameWp: number | null;
  /** Average scoring margin over decided G6 games (null if none). */
  margin: number | null;
}

/**
 * Each G6 team's W-L, average scoring margin and average postgame win probability in decided games against other G6 teams (every
 * G6 team gets an entry, even 0-0). Ties are skipped, matching the all-games card stats.
 */
export function g6Records(games: readonly G6Game[], g6Ids: ReadonlySet<number>): Map<number, G6Stats> {
  const acc = new Map([...g6Ids].map((id) => [id, { w: 0, l: 0, marginSum: 0, wpSum: 0, wpN: 0 }]));
  for (const g of games) {
    if (!g6Ids.has(g.homeId) || !g6Ids.has(g.awayId)) continue;
    if (g.homePoints === null || g.awayPoints === null || g.homePoints === g.awayPoints) continue;
    const homeWon = g.homePoints > g.awayPoints;
    const homeMargin = g.homePoints - g.awayPoints;
    for (const [id, won, margin, wp] of [
      [g.homeId, homeWon, homeMargin, g.homePostgameWp],
      [g.awayId, !homeWon, -homeMargin, g.awayPostgameWp],
    ] as const) {
      const a = acc.get(id)!;
      a.marginSum += margin;
      if (won) a.w++;
      else a.l++;
      if (wp !== null && wp !== undefined) {
        a.wpSum += wp;
        a.wpN++;
      }
    }
  }
  return new Map(
    [...acc].map(([id, a]) => {
      const n = a.w + a.l;
      return [id, { w: a.w, l: a.l, postgameWp: a.wpN ? a.wpSum / a.wpN : null, margin: n ? a.marginSum / n : null }];
    }),
  );
}
