// Reveal step: team names plus the season's crowd ranking. Only requested after a visitor opens results,
// so names never ship with the blind page itself.

import { connection } from "next/server";
import { getBlindData, getCrowdRanking } from "@/lib/blind/data";

export async function GET() {
  await connection(); // request-time only: the crowd ranking follows new votes
  const blind = await getBlindData();
  if (!blind) return Response.json({ error: "no data" }, { status: 503 });
  // The crowd ranking is optional: names and the personal ranking still load if the votes query fails.
  const crowd = await getCrowdRanking(blind.season, blind.week).catch((e) => {
    console.error("crowd ranking failed:", e);
    return { votes: 0, ranks: null, blend: null };
  });
  return Response.json({ season: blind.season, week: blind.week, teams: blind.info, crowd });
}
