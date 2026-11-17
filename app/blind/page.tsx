import type { Metadata } from "next";
import { Suspense } from "react";
import { BlindRanking } from "@/components/BlindRanking";
import { PageHeader } from "@/components/ui";
import { getBlindData } from "@/lib/blind/data";

export const metadata: Metadata = {
  title: "Blind ranking",
  description: "Rank anonymous teams by their stats alone and see how your ranking compares to the models.",
};

async function BlindContent() {
  const data = await getBlindData();
  if (!data) return <p>No data yet. Run the backfill.</p>;
  // Only anonymous cards cross to the client; names are served later by /api/blind/results.
  return <BlindRanking season={data.season} week={data.week} cards={data.cards} />;
}

export default function BlindPage() {
  return (
    <>
      <PageHeader title="Blind ranking" />
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <BlindContent />
      </Suspense>
    </>
  );
}
