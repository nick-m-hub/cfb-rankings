import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { getLastUpdated } from "@/lib/rankings/data";

export const metadata: Metadata = { title: "Methodology" };

/** Best-team model, walk-forward on FBS-vs-FBS games from week 2 (same numbers as the text below). */
const ACCURACY = [
  { label: "2026 (out of sample)", miss: "12.0", winners: "70%" },
  { label: "2023–2025", miss: "12.4", winners: "72%" },
  { label: "2016–2022", miss: "12.9", winners: "72%" },
];

export default async function Methodology() {
  const updated = await getLastUpdated();
  return (
    <article>
      <PageHeader
        title="Methodology"
        dek="Two models, one slider: how each team's score is built, how accurate it is, and what it leaves out."
      >
        <p className="mt-2 text-xs text-muted">Last updated: {updated ? new Date(updated).toUTCString() : "no data yet"}</p>
      </PageHeader>

      <dl className="mb-8 grid max-w-3xl grid-cols-3 gap-3">
        {ACCURACY.map((a) => (
          <Card key={a.label} className="p-3 sm:p-4">
            <dt className="text-xs text-muted">{a.label}</dt>
            <dd className="mt-1 font-display text-2xl font-semibold tabular-nums sm:text-3xl">{a.miss}</dd>
            <dd className="text-xs text-muted">pts avg miss · {a.winners} winners</dd>
          </Card>
        ))}
      </dl>

      <div className="prose-site">

      <h2>Two questions, one slider</h2>
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

      <h2>Most deserving (resume model)</h2>
      <ul>
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

      <h2>Best team (predictive model)</h2>
      <ul>
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

      <h2>Schedule strength</h2>
      <p>
        Schedule strength is how often the benchmark team (the 12th-best team, the same one the resume model uses)
        would win a team&apos;s games so far, at the same sites. Lower means harder. Opponents are rated by the
        best-team model without any of the team&apos;s own games. We judge schedules for a contender rather than an
        average team because what separates schedules for a playoff case is how many strong opponents are on them.
      </p>

      <h2>Other ratings</h2>
      <p>
        Team details also show where each team ranks in SP+, FPI, Elo and SRS for reference. They don&apos;t feed the
        slider. Only Elo is available week by week for past seasons; SP+, FPI and SRS are end-of-season values for
        historical weeks (look-ahead), and we snapshot them weekly going forward.
      </p>

      <h2>Blind ranking</h2>
      <p>
        On the blind ranking page you rank three anonymous teams at a time. Each card shows record, average scoring
        margin, offense and defense efficiency (EPA per play, ranked
        among FBS teams), postgame win probability (CollegeFootballData&apos;s estimate of how often a team would be
        expected to win with a similar underlying performance, based on efficiency measures rather than the final
        score, averaged over its games), and its record against each opponent quadrant. We fit a Plackett-Luce model to your
        rankings: it learns how much you weight each stat, plus a small per-team adjustment, then scores every FBS
        team. Until your own rounds say otherwise it assumes you like every stat a little, and it picks the next
        cards to be the ones that tell it the most about what you value. That is why about 15 rounds give a usable
        ranking, and more rounds sharpen it. Everyone&apos;s votes also feed a crowd
        ranking that resets every Monday. To keep one visitor from outvoting everyone, each browser session counts as
        at most 40 votes: beyond that its votes are scaled down, and the 200-vote threshold counts votes the same way. Our own model ranks are deliberately kept off the cards, so the ranking
        reflects your judgment rather than ours.
      </p>
      <p>
        A G6-only switch limits the game to Group of 6 teams (American, Conference USA, MAC, Mountain West, Sun Belt and
        the Pac-12, plus UConn; the same group as the rankings table&apos;s G6 toggle). In that mode the record, average margin and postgame win probability on each card count only games
        against other G6 teams; every other stat still covers all games. G6 rounds are saved separately, build their own G6 ranking after 15 rounds,
        and stay in your browser: they don&apos;t feed the crowd ranking, because they were judged on a different record.
      </p>
      <p>
        Your results also show <strong>your blend</strong>: where your picks sit on the rankings slider. For every
        slider setting from 0 (most deserving) to 100 (best team) we ask how well that blend of our two models explains
        the order you actually put each three teams in, and report the setting that explains it best, with the range of
        settings your rounds can&apos;t tell apart from it (about 95% confidence). It uses your raw rounds, not your
        fitted ranking, because the fitted ranking leans on default stat weights early on. The two models agree on most
        teams, so the range is wide after 15 rounds and narrows as you play. The crowd&apos;s blend is the same
        calculation over this week&apos;s votes, with each session capped as for the crowd ranking.
      </p>
      <p>
        Quadrants group opponents by our best-team rating, and the bands widen toward the bottom, like college
        basketball&apos;s NET quadrants. For a home game, Q1 is an opponent ranked 1&ndash;15, Q2 16&ndash;40, Q3
        41&ndash;75 and Q4 76 or lower. Neutral-site and road games reach further down, by the model&apos;s
        home-field advantage: typically Q1 goes to about #21 on a neutral field and #33 on the road (Q2 about #52 and
        #63, Q3 about #85 and #100), varying a little each season with the fitted home field. In a typical season a
        top-12 team wins about 62% of Q1 home games. FCS opponents are placed by their own rating (nearly always
        Q4). Opponents are rated without any of the team&apos;s own games (as for schedule strength on the stats page), so blowing a team
        out can&apos;t drop it a quadrant and make the win look worse. Tied games count in no quadrant.
        The voter model uses two quadrant stats: Q1 wins and Q3/Q4 losses.
      </p>

      <h2>Fine print</h2>
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

      <h2>Attribution</h2>
      <p>
        Data from <a href="https://collegefootballdata.com">CollegeFootballData.com</a>, including
        game results, advanced stats, returning production and 247Sports team talent. SP+ is created by Bill Connelly,
        FPI by ESPN; Elo and SRS are computed by CFBD.
        Team logos come from CollegeFootballData.com and are trademarks of their schools.
      </p>
      </div>
    </article>
  );
}
