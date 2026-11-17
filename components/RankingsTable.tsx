"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DEFAULT_BLEND } from "@/lib/site";
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
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="mr-2">Season</span>
          <select
            className="rounded border border-current/30 bg-transparent px-2 py-1"
            value={season}
            onChange={(e) => {
              const s = Number(e.target.value);
              const r = seasons.find((x) => x.season === s);
              go(s, r ? Math.min(Math.max(week, r.minWeek), r.maxWeek) : week);
            }}
          >
            {seasons.map((s) => (
              <option key={s.season} value={s.season} className="text-black">{s.season}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mr-2">Week</span>
          <select
            className="rounded border border-current/30 bg-transparent px-2 py-1"
            value={week}
            onChange={(e) => go(season, Number(e.target.value))}
          >
            {Array.from({ length: range.maxWeek - range.minWeek + 1 }, (_, i) => range.minWeek + i).map((w) => (
              <option key={w} value={w} className="text-black">{w}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm" title="AAC, C-USA, MAC, Mountain West, Sun Belt, the Pac-12 from 2026, and UConn">
          <input type="checkbox" checked={g6} onChange={(e) => onG6(e.target.checked)} />
          <span>G6 only</span>
        </label>
      </div>

      <div className="mb-6 rounded border border-current/20 p-3">
        <div className="mb-1 flex justify-between text-sm font-medium">
          <span>Most deserving</span>
          <span className="hidden opacity-70 sm:inline">{blendLabel(blend)}</span>
          <span>Best team</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={blend}
          onChange={(e) => onBlend(Number(e.target.value))}
          aria-label="Blend between most deserving (0) and best team (100)"
          className="w-full"
        />
        <p className="mt-1 text-center text-xs opacity-70 sm:hidden">{blendLabel(blend)}</p>
        <p className="mt-1 text-xs opacity-70">
          Most deserving: what each team&apos;s results have earned. Best team: who would win the next game. Tap a team
          for details.
        </p>
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-current/20">
            <th className="py-2 pr-2">#</th>
            {g6 && <th className="py-2 pr-2 text-xs font-normal opacity-70">FBS</th>}
            <th className="py-2 pr-2">Team</th>
            <th className="hidden py-2 pr-2 sm:table-cell">Conf</th>
            <th className="py-2 pr-2">Record</th>
            <th className="py-2 pr-2 text-right">Score</th>
            <th className="hidden py-2 pr-2 text-right sm:table-cell">Deserving</th>
            <th className="hidden py-2 pr-2 text-right sm:table-cell">Best</th>
            <th className="hidden py-2 text-right sm:table-cell">Chg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <RowGroup key={t.id} t={t} g6={g6} expanded={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function blendLabel(b: number) {
  if (b === 0) return "100% deserving";
  if (b === 100) return "100% best team";
  return `${100 - b}% deserving · ${b}% best`;
}

function change(c: number | null) {
  if (c === null) return "–";
  if (c === 0) return "=";
  return c > 0 ? `▲${c}` : `▼${-c}`;
}

const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
const site = (s: string) => (s === "home" ? "vs" : s === "away" ? "at" : "vs (N)");

type Row = FilteredTeam;

function RowGroup({ t, g6, expanded, onToggle }: { t: Row; g6: boolean; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b border-current/10 hover:bg-current/5" onClick={onToggle} aria-expanded={expanded}>
        <td className="py-2 pr-2 tabular-nums">{t.rank}</td>
        {g6 && <td className="py-2 pr-2 text-xs tabular-nums opacity-70">{t.fbsRank}</td>}
        <td className="py-2 pr-2 font-medium">{t.name}</td>
        <td className="hidden py-2 pr-2 sm:table-cell">{t.conference ?? ""}</td>
        <td className="py-2 pr-2 tabular-nums">{t.wins}-{t.losses}</td>
        <td className="py-2 pr-2 text-right tabular-nums">{t.blended.toFixed(2)}</td>
        <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{t.resumeRank ?? "–"}</td>
        <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{t.predRank ?? "–"}</td>
        <td className="hidden py-2 text-right tabular-nums sm:table-cell">{change(t.change)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-current/10">
          <td colSpan={g6 ? 9 : 8} className="pb-3 pt-1">
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
    <div className="grid gap-3 text-xs sm:grid-cols-3">
      <section>
        <h3 className="mb-1 font-semibold">Most deserving #{t.resumeRank ?? "–"}</h3>
        {d ? (
          <ul className="space-y-0.5 opacity-90">
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
          <p className="opacity-70">No model details for this week.</p>
        )}
      </section>
      <section>
        <h3 className="mb-1 font-semibold">Best team #{t.predRank ?? "–"}</h3>
        {d ? (
          <ul className="space-y-0.5 opacity-90">
            <li>Rating {signed(d.best.rating)} pts vs an average FBS team</li>
            <li>Offense {signed(d.best.offense)} (#{d.best.offenseRank}) · Defense {signed(d.best.defense)} (#{d.best.defenseRank})</li>
            {d.best.offSuccessRateRank !== null && (
              <li>Success rate: offense #{d.best.offSuccessRateRank} · defense #{d.best.defSuccessRateRank}</li>
            )}
            <li>This season&apos;s results only: #{d.best.resultsOnlyRank}</li>
          </ul>
        ) : (
          <p className="opacity-70">No model details for this week.</p>
        )}
      </section>
      <section>
        <h3 className="mb-1 font-semibold">Other ratings</h3>
        {ref.length ? (
          <ul className="space-y-0.5 opacity-90">
            {ref.map(([name, r]) => (
              <li key={name}>{name} #{r ?? "–"}</li>
            ))}
          </ul>
        ) : (
          <p className="opacity-70">Not available for this week.</p>
        )}
        <p className="mt-1 opacity-70 sm:hidden">{t.conference ?? "Independent"} · Change {change(t.change)}</p>
      </section>
    </div>
  );
}
