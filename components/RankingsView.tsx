import { Suspense } from "react";
import { getAvailableWeeks, getWeekData } from "@/lib/rankings/data";
import { RankingsTable } from "./RankingsTable";
import { PageHeader } from "./ui";

export async function RankingsView({ season, week }: { season: number; week: number }) {
  const [data, seasons] = await Promise.all([getWeekData(season, week), getAvailableWeeks()]);
  if (!data.found) {
    return <p>No rankings for {season} week {week}.</p>;
  }
  return (
    <>
      <PageHeader
        title={<>{season} <span className="text-muted">·</span> Week {week}</>}
        dek="Every FBS team, ranked by a mix you control: what results have earned, or who is best right now."
      />
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <RankingsTable season={season} week={week} teams={data.teams} seasons={seasons} />
      </Suspense>
    </>
  );
}
