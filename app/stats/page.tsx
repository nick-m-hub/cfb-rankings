import type { Metadata } from "next";
import { Suspense } from "react";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/ui";
import { getBlindData } from "@/lib/blind/data";

export const metadata: Metadata = {
  title: "Team stats",
  description: "Every FBS team's record, schedule strength, margin, efficiency and win probability in one sortable table.",
};

async function StatsContent() {
  const data = await getBlindData();
  if (!data) return <p>No data yet. Run the backfill.</p>;
  const info = new Map(data.info.map((t) => [t.id, t]));
  const rows: StatsRow[] = data.cards.map((c) => {
    const t = info.get(c.id)!;
    return {
      id: c.id,
      name: t.name,
      conference: t.conference,
      cfbdId: t.cfbdId,
      color: t.color,
      wins: c.wins,
      losses: c.losses,
      sos: c.sos,
      sosRank: c.sosRank,
      margin: c.margin,
      offEpa: c.offEpa,
      offEpaRank: c.offEpaRank,
      defEpa: c.defEpa,
      defEpaRank: c.defEpaRank,
      postgameWp: c.postgameWp,
      bestWin: c.bestWin,
      worstLoss: c.worstLoss,
      quadrants: c.quadrants,
      resumeRank: t.resumeRank,
      bestRank: t.bestRank,
    };
  });
  return (
    <>
      <p className="-mt-4 mb-4 text-sm text-muted">
        {data.season} season through week {data.week}. Click a column header to sort; click again to reverse.
      </p>
      <StatsTable rows={rows} />
    </>
  );
}

export default function StatsPage() {
  return (
    <>
      <PageHeader title="Team stats" dek="Every FBS team's record, schedule, efficiency and model ranks in one sortable table." />
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <StatsContent />
      </Suspense>
    </>
  );
}
