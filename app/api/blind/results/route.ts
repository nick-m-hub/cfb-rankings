// Reveal step: team names plus this week's crowd ranking. Only requested after a visitor opens results,
// so names never ship with the blind page itself.

import { connection } from "next/server";
import { crowdWeekStart } from "@/lib/blind/constants";
import { getBlindData, getCrowdRanking } from "@/lib/blind/data";

export async function GET() {
  await connection(); // request-time only: the crowd week depends on the current date
  const blind = await getBlindData();
  if (!blind) return Response.json({ error: "no data" }, { status: 503 });
  const crowdWeek = crowdWeekStart(new Date());
  // The crowd ranking is optional: names and the personal ranking still load if the votes query fails.
  const crowd = await getCrowdRanking(crowdWeek, blind.season).catch((e) => {
    console.error("crowd ranking failed:", e);
    return { crowdWeek, votes: 0, ranks: null, blend: null };
  });
  return Response.json({ season: blind.season, week: blind.week, teams: blind.info, crowd });
}
