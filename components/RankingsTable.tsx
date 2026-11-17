"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DEFAULT_BLEND } from "@/lib/site";
import { TeamLogo } from "./TeamLogo";
import { Card, Select, Toggle } from "./ui";
import type { SeasonWeeks } from "@/lib/rankings/data";
import { parseBlend, rankG6, rankTeams, type FilteredTeam, type TeamInput } from "@/lib/rankings/rank";

interface Props {
  season: number;
  week: number;
  teams: TeamInput[];
  seasons: SeasonWeeks[];
}

export function RankingsTable({ season, week, teams, seasons }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = parseBlend(searchParams.get("blend"), DEFAULT_BLEND);
  const [blend, setBlend] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [g6, setG6] = useState(searchParams.get("g6") === "1");

  const rows: FilteredTeam[] = useMemo(
    () => (g6 ? rankG6(teams, blend, season) : rankTeams(teams, blend).map((t) => ({ ...t, fbsRank: t.rank }))),
    [teams, blend, g6, season],
  );
  const range = seasons.find((s) => s.season === season) ?? { season, minWeek: week, maxWeek: week };

  function onBlend(v: number) {
    setBlend(v);
    const url = new URL(window.location.href);
    url.searchParams.set("blend", String(v));
    window.history.replaceState(null, "", url);
  }
  function onG6(on: boolean) {
    setG6(on);
    const url = new URL(window.location.href);
    if (on) url.searchParams.set("g6", "1");
    else url.searchParams.delete("g6");
    window.history.replaceState(null, "", url);
  }
  function go(s: number, w: number) {
    router.push(`/rankings/${s}/${w}?blend=${blend}${g6 ? "&g6=1" : ""}`);
  }

  return (
    <div>
      <Card className="mb-6 p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Select
            label="Season"
            value={season}
            onChange={(e) => {
              const s = Number(e.target.value);
              const r = seasons.find((x) => x.season === s);
              go(s, r ? Math.min(Math.max(week, r.minWeek), r.maxWeek) : week);
            }}
          >
            {seasons.map((s) => (
              <option key={s.season} value={s.season}>{s.season}</option>
            ))}
          </Select>
          <Select label="Week" value={week} onChange={(e) => go(season, Number(e.target.value))}>
            {Array.from({ length: range.maxWeek - range.minWeek + 1 }, (_, i) => range.minWeek + i).map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </Select>
          <div className="sm:ml-auto">
            <Toggle
              checked={g6}
              onChange={onG6}
              label="G6 only"
              title="AAC, C-USA, MAC, Mountain West, Sun Belt, the Pac-12 from 2026, and UConn"
            />
          </div>
        </div>

        <div className="mb-2 flex items-end justify-between gap-3 text-sm">
          <span className="font-semibold">Most deserving</span>
          <span className="hidden rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent sm:inline">
            {blendLabel(blend)}
          </span>
          <span className="text-right font-semibold">Best team</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={blend}
          onChange={(e) => onBlend(Number(e.target.value))}
          aria-label="Blend between most deserving (0) and best team (100)"
          className="blend w-full"
          style={{ "--fill": `${blend}%` } as React.CSSProperties}
        />
        <p className="mt-2 text-center text-xs font-medium text-accent sm:hidden">{blendLabel(blend)}</p>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          <strong className="font-semibold text-ink">Most deserving</strong>: what each team&apos;s results have earned.{" "}
          <strong className="font-semibold text-ink">Best team</strong>: who would win the next game. Tap a team for
          details.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-ink/[0.03] text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-10 py-2.5 pl-3 pr-1 font-medium sm:w-12 sm:pl-4 sm:pr-2">#</th>
              {g6 && <th className="py-2.5 pr-2 font-medium normal-case tracking-normal">FBS</th>}
              <th className="py-2.5 pr-2 font-medium">Team</th>
              <th className="py-2.5 pr-2 font-medium">Record</th>
              <th className="py-2.5 pr-3 text-right font-medium sm:pr-2">Score</th>
              <th className="hidden py-2.5 pr-2 text-right font-medium sm:table-cell">Deserving</th>
              <th className="hidden py-2.5 pr-2 text-right font-medium sm:table-cell">Best</th>
              <th className="hidden py-2.5 pr-4 text-right font-medium sm:table-cell">Chg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <RowGroup
                key={t.id}
                t={t}
                g6={g6}
                cutoff={!g6 && t.rank === 25 && rows.length > 25}
                expanded={open === t.id}
                onToggle={() => setOpen(open === t.id ? null : t.id)}
              />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function blendLabel(b: number) {
  if (b === 0) return "100% deserving";
  if (b === 100) return "100% best team";
  return `${100 - b}% deserving · ${b}% best`;
}

function Change({ c }: { c: number | null }) {
  if (c === null) return <span className="text-muted">–</span>;
  if (c === 0) return <span className="text-muted">=</span>;
  return c > 0 ? <span className="text-up">▲{c}</span> : <span className="text-down">▼{-c}</span>;
}

const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
const site = (s: string) => (s === "home" ? "vs" : s === "away" ? "at" : "vs (N)");

type Row = FilteredTeam;

function RowGroup({
  t,
  g6,
  cutoff,
  expanded,
  onToggle,
}: {
  t: Row;
  g6: boolean;
  cutoff: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const border = cutoff && !expanded ? "border-b-2 border-b-muted/40" : "border-b border-line";
  return (
    <>
      <tr
        className={`cursor-pointer transition-colors last:border-0 hover:bg-ink/[0.03] ${expanded ? "bg-ink/[0.03]" : ""} ${border}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <td className="py-2.5 pl-3 pr-1 text-base font-semibold tabular-nums sm:pl-4 sm:pr-2">{t.rank}</td>
        {g6 && <td className="py-2.5 pr-2 text-xs tabular-nums text-muted">{t.fbsRank}</td>}
        <td className="w-full max-w-0 py-2.5 pr-2">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <TeamLogo cfbdId={t.cfbdId} name={t.name} color={t.color} size={28} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{t.name}</div>
              <div className="truncate text-xs text-muted">{t.conference ?? "Independent"}</div>
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-2 tabular-nums">{t.wins}-{t.losses}</td>
        <td className="py-2.5 pr-3 text-right font-medium tabular-nums sm:pr-2">{t.blended.toFixed(2)}</td>
        <td className="hidden py-2.5 pr-2 text-right tabular-nums text-muted sm:table-cell">{t.resumeRank ?? "–"}</td>
        <td className="hidden py-2.5 pr-2 text-right tabular-nums text-muted sm:table-cell">{t.predRank ?? "–"}</td>
        <td className="hidden py-2.5 pr-4 text-right text-xs font-medium tabular-nums sm:table-cell"><Change c={t.change} /></td>
      </tr>
      {expanded && (
        <tr className={border}>
          <td colSpan={g6 ? 8 : 7} className="px-3 pb-4 pt-1 sm:px-4">
            <Details t={t} />
          </td>
        </tr>
      )}
    </>
  );
}

function Details({ t }: { t: Row }) {
  const d = t.details;
  const ref = Object.entries(t.reference ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div
      className="rounded-lg border border-line border-t-[3px] bg-surface p-4"
      style={t.color ? { borderTopColor: t.color } : undefined}
    >
      <div className="mb-3 flex items-center gap-3">
        <TeamLogo cfbdId={t.cfbdId} name={t.name} color={t.color} size={40} />
        <div>
          <p className="font-display text-lg font-semibold leading-tight">{t.name}</p>
          <p className="text-xs text-muted">
            {t.conference ?? "Independent"} · {t.wins}-{t.losses}
            <span className="sm:hidden"> · Change <Change c={t.change} /></span>
          </p>
        </div>
      </div>
    <div className="grid gap-4 text-xs sm:grid-cols-3">
      <section>
        <h3 className="mb-1.5 text-[13px] font-semibold">Most deserving #{t.resumeRank ?? "–"}</h3>
        {d ? (
          <ul className="space-y-1 leading-relaxed">
            <li>Resume score {signed(d.resume.score, 2)}</li>
            <li>Top-12 odds {Math.round(d.resume.topOdds * 100)}% · likely rank {d.resume.rankRange[0]}–{d.resume.rankRange[1]}</li>
            <li>
              Best win:{" "}
              {d.resume.bestWin ? `${d.resume.bestWin.score} ${site(d.resume.bestWin.site)} ${d.resume.bestWin.opponent}` : "none"}
            </li>
            <li>
              Worst loss:{" "}
              {d.resume.worstLoss ? `${d.resume.worstLoss.score} ${site(d.resume.worstLoss.site)} ${d.resume.worstLoss.opponent}` : "none"}
            </li>
          </ul>
        ) : (
          <p className="text-muted">No model details for this week.</p>
        )}
      </section>
      <section>
        <h3 className="mb-1.5 text-[13px] font-semibold">Best team #{t.predRank ?? "–"}</h3>
        {d ? (
          <ul className="space-y-1 leading-relaxed">
            <li>Rating {signed(d.best.rating)} pts vs an average FBS team</li>
            <li>Offense {signed(d.best.offense)} (#{d.best.offenseRank}) · Defense {signed(d.best.defense)} (#{d.best.defenseRank})</li>
            {d.best.offSuccessRateRank !== null && (
              <li>Success rate: offense #{d.best.offSuccessRateRank} · defense #{d.best.defSuccessRateRank}</li>
            )}
            <li>This season&apos;s results only: #{d.best.resultsOnlyRank}</li>
          </ul>
        ) : (
          <p className="text-muted">No model details for this week.</p>
        )}
      </section>
      <section>
        <h3 className="mb-1.5 text-[13px] font-semibold">Other ratings</h3>
        {ref.length ? (
          <ul className="space-y-1 leading-relaxed">
            {ref.map(([name, r]) => (
              <li key={name}>{name} #{r ?? "–"}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Not available for this week.</p>
        )}
      </section>
    </div>
    </div>
  );
}
