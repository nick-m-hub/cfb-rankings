import { RankingsView } from "@/components/RankingsView";
import { getLatestWeek } from "@/lib/rankings/data";

export default async function RankingsPage() {
  const latest = await getLatestWeek();
  if (!latest) return <p>No rankings yet. Run the backfill.</p>;
  return <RankingsView season={latest.season} week={latest.week} />;
}
