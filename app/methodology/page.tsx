import type { Metadata } from "next";
import { getLastUpdated } from "@/lib/rankings/data";

export const metadata: Metadata = { title: "Methodology" };

export default async function Methodology() {
  const updated = await getLastUpdated();
  return (
    <article className="space-y-4 leading-relaxed">
      <h1 className="text-2xl font-semibold">Methodology</h1>
      <p className="text-sm opacity-70">Last updated: {updated ? new Date(updated).toUTCString() : "no data yet"}</p>

      <h2 className="text-lg font-semibold">Two questions, one slider</h2>
      <p>
        Every FBS team gets two scores from our own models. <strong>Most deserving</strong> asks what a team&apos;s
        results have earned. <strong>Best team</strong> asks who would win the next game. The slider mixes them:
        score = s × best + (1 − s) × deserving, after putting both on the same scale (z-scores across FBS). Slide to 0
        for pure deserving, 100 for pure best team. The value is in the URL so you can share a ranking exactly as you
        see it.
      </p>
      <p>
        The two ends are the cleanest answers. Points in between are a judgment call about how much quality should
        count alongside results; there is no single right mix.
      </p>

      <h2 className="text-lg font-semibold">Most deserving (resume model)</h2>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          We rate every team&apos;s strength from this season&apos;s games only (no preseason expectations), using
          scoring margins capped at 21 points and a fitted home-field advantage.
        </li>
        <li>
          For each game, we estimate the chance that a <strong>benchmark team</strong>, the 12th-best team in the
          country (the playoff cut line), would have won it at the same site. Opponents are rated without the
          team&apos;s own games against them, so beating a team badly doesn&apos;t make that win look less impressive.
        </li>
        <li>
          Each game earns credit = result (1 for a win, 0 for a loss) minus that chance. Beating a top team on the road
          earns a lot; losing to a weak team costs a lot. A team&apos;s own margin never matters: a win is a win.
        </li>
        <li>The resume score is the sum of a team&apos;s credits.</li>
        <li>
          Top-12 odds and the likely rank range come from 1,000 simulations of the uncertainty in opponent ratings.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Best team (predictive model)</h2>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          A power rating: how many points better a team is than an average FBS team on a neutral field, adjusted for
          opponents and home field.
        </li>
        <li>
          Game margins get full credit up to 40 points and half credit beyond. Each game&apos;s margin is blended 85% with
          the final score and 15% with the success-rate gap, which filters out some luck.
        </li>
        <li>
          A preseason starting point from last season&apos;s FPI, returning production and recruiting talent. It
          counts as six games of evidence before the season and halves every six games a team plays (about 2.4 games
          after eight games), so by November this season&apos;s results carry most of the weight. We tested this
          against a fixed weight: it predicts as well or slightly better, and leaning less on reputation late in the
          season is fairer. Dropping the starting point entirely makes predictions clearly worse, even late in the
          season, so it stays. The team details show each team&apos;s rank from this season&apos;s results alone.
        </li>
        <li>Offense and defense ratings split the rating using points scored and allowed.</li>
        <li>
          Tested by predicting each week&apos;s FBS-vs-FBS games using only earlier games (week 2 on): a 12.0-point
          average miss and 70% of winners picked on 2026 games so far; 12.4 points and 72% across 2023–2025; 12.9
          points and 72% across 2016–2022. The settings were tuned on 2016–2025, so those seasons flatter the model
          a little; 2026 was not used for tuning.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Schedule strength</h2>
      <p>
        Schedule strength is how often the benchmark team (the 12th-best team, the same one the resume model uses)
        would win a team&apos;s games so far, at the same sites. Lower means harder. Opponents are rated by the
        best-team model without any of the team&apos;s own games. We judge schedules for a contender rather than an
        average team because what separates schedules for a playoff case is how many strong opponents are on them.
      </p>

      <h2 className="text-lg font-semibold">Other ratings</h2>
      <p>
        Team details also show where each team ranks in SP+, FPI, Elo and SRS for reference. They don&apos;t feed the
        slider. Only Elo is available week by week for past seasons; SP+, FPI and SRS are end-of-season values for
        historical weeks (look-ahead), and we snapshot them weekly going forward.
      </p>

      <h2 className="text-lg font-semibold">Blind ranking</h2>
      <p>
        On the blind ranking page you rank three anonymous teams at a time. Each card shows record, average scoring
        margin, schedule strength (how often a top-12 team would win that schedule, from our best-team ratings), offense and defense efficiency (EPA per play, ranked
        among FBS teams), postgame win probability (CollegeFootballData&apos;s estimate of how often a team would be
        expected to win with a similar underlying performance, based on efficiency measures rather than the final
        score, averaged over its games), and best win and worst loss with the opponent hidden. We fit a Plackett-Luce model to your
        rankings: it learns how much you weight each stat, plus a small per-team adjustment, then scores every FBS
        team. Until your own rounds say otherwise it assumes you like every stat a little, and it picks the next
        cards to be the ones that tell it the most about what you value. That is why about 15 rounds give a usable
        ranking, and more rounds sharpen it. Everyone&apos;s votes also feed a crowd
        ranking that resets every Monday. To keep one visitor from outvoting everyone, each browser session counts as
        at most 40 votes: beyond that its votes are scaled down, and the 200-vote threshold counts votes the same way. Our own model ranks are deliberately kept off the cards, so the ranking
        reflects your judgment rather than ours.
      </p>

      <h2 className="text-lg font-semibold">Fine print</h2>
      <p>
        A team&apos;s best win and worst loss are the best team it beat and the worst team it lost to, judged by our
        best-team ratings (FCS opponents are rated from how they actually performed against FBS teams). Ratings
        are only good to a few points, so opponents within 4 rating points of the best (or worst) are treated as tied
        and their records settle it: the better record is the best win, the worse record the worst loss. Where or how
        close the game was doesn&apos;t change which one is picked.{" "}
        FCS teams are not shown, though games against them count. Each FCS opponent is rated individually from its
        games against FBS and FCS teams, pulled toward the average FCS team when it has few games, so beating a
        strong FCS team counts for more than beating a weak one. Historical
        weeks are recomputed with only the games played through that week. The best-team model&apos;s starting point
        uses last season&apos;s final FPI, which is known before the season starts.
      </p>

      <h2 className="text-lg font-semibold">Attribution</h2>
      <p>
        Data from <a className="underline" href="https://collegefootballdata.com">CollegeFootballData.com</a>, including
        game results, advanced stats, returning production and 247Sports team talent. SP+ is created by Bill Connelly,
        FPI by ESPN; Elo and SRS are computed by CFBD.
      </p>
    </article>
  );
}
