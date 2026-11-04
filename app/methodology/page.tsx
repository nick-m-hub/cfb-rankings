import type { Metadata } from "next";
import { getLastUpdated } from "@/lib/rankings/data";

export const metadata: Metadata = { title: "Methodology" };

export default async function Methodology() {
  const updated = await getLastUpdated();
  return (
    <article className="space-y-4 leading-relaxed">
      <h1 className="text-2xl font-semibold">Methodology</h1>
      <p className="text-sm opacity-70">Last updated: {updated ? new Date(updated).toUTCString() : "no data yet"}</p>

      <h2 className="text-lg font-semibold">The blend</h2>
      <p>
        Every FBS team gets two scores: a <strong>predictive</strong> composite (how good the team is) and a{" "}
        <strong>resume</strong> composite (what the team has earned). The slider mixes them:
        score = s × predictive + (1 − s) × resume. Slide to 100 for pure predictive, 0 for pure resume. The value is
        in the URL so you can share a ranking exactly as you see it.
      </p>

      <h2 className="text-lg font-semibold">Inputs</h2>
      <ul className="list-disc space-y-1 pl-6">
        <li><strong>SP+</strong> (predictive): tempo- and opponent-adjusted efficiency ratings.</li>
        <li><strong>FPI</strong> (predictive): ESPN&apos;s Football Power Index.</li>
        <li><strong>Elo</strong> (resume): results-driven rating updated game by game.</li>
        <li><strong>SRS</strong> (resume): Simple Rating System, margin of victory adjusted for schedule.</li>
      </ul>
      <p>
        Each system is converted to a z-score across FBS teams each week (lower-is-better systems are sign-flipped).
        Systems within a composite are weighted equally, and each composite is re-standardized across FBS before
        blending. Teams missing from every system on one side are left out of the ranking. FCS teams are not shown,
        though games against them count in records.
      </p>

      <h2 className="text-lg font-semibold">Historical weeks and look-ahead</h2>
      <p>
        Only Elo is available week by week. For past seasons, SP+, FPI and SRS are end-of-season values, so earlier
        weeks of those seasons contain look-ahead information. Going forward, we snapshot these systems every week.
      </p>

      <h2 className="text-lg font-semibold">Attribution</h2>
      <p>
        Data from <a className="underline" href="https://collegefootballdata.com">CollegeFootballData.com</a>. SP+ is
        created by Bill Connelly, FPI by ESPN; Elo and SRS are computed by CFBD.
      </p>
    </article>
  );
}
