import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RankingsView } from "@/components/RankingsView";
import { getAvailableWeeks } from "@/lib/rankings/data";

export async function generateStaticParams() {
  const weeks = await getAvailableWeeks();
  // Cache Components requires at least one result; before the first backfill, emit a placeholder.
  if (weeks.length === 0) return [{ season: "0", week: "1" }];
  return weeks.slice(0, 1).flatMap(({ season, maxWeek }) =>
    Array.from({ length: maxWeek }, (_, i) => ({ season: String(season), week: String(i + 1) })),
  );
}

async function Content({ params }: Pick<PageProps<"/rankings/[season]/[week]">, "params">) {
  const { season, week } = await params;
  const s = Number(season);
  const w = Number(week);
  if (!Number.isInteger(s) || !Number.isInteger(w) || w < 1) notFound();
  return <RankingsView season={s} week={w} />;
}

export default function Page(props: PageProps<"/rankings/[season]/[week]">) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Content params={props.params} />
    </Suspense>
  );
}
