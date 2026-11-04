import { Suspense } from "react";
import { getAvailableWeeks, getWeekData } from "@/lib/rankings/data";
import { RankingsTable } from "./RankingsTable";

export async function RankingsView({ season, week }: { season: number; week: number }) {
  const [data, seasons] = await Promise.all([getWeekData(season, week), getAvailableWeeks()]);
  if (!data.found) {
    return <p>No rankings for {season} week {week}.</p>;
  }
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">{season} Week {week}</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <RankingsTable season={season} week={week} teams={data.teams} seasons={seasons} />
      </Suspense>
    </>
  );
}
