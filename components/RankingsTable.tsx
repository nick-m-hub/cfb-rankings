"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DEFAULT_BLEND } from "@/lib/site";
import { parseBlend, rankTeams, type TeamInput } from "@/lib/rankings/rank";

interface Props {
  season: number;
  week: number;
  teams: TeamInput[];
  seasons: { season: number; maxWeek: number }[];
}

export function RankingsTable({ season, week, teams, seasons }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = parseBlend(searchParams.get("blend"), DEFAULT_BLEND);
  const [blend, setBlend] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);

  const rows = useMemo(() => rankTeams(teams, blend), [teams, blend]);
  const maxWeek = seasons.find((s) => s.season === season)?.maxWeek ?? week;

  function onBlend(v: number) {
    setBlend(v);
    const url = new URL(window.location.href);
    url.searchParams.set("blend", String(v));
    window.history.replaceState(null, "", url);
  }
  function go(s: number, w: number) {
    router.push(`/rankings/${s}/${w}?blend=${blend}`);
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
              go(s, Math.min(week, seasons.find((x) => x.season === s)?.maxWeek ?? week));
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
            {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w} className="text-black">{w}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-6 rounded border border-current/20 p-3">
        <div className="mb-1 flex justify-between text-sm font-medium">
          <span>Resume</span>
          <span>{blend}% predictive</span>
          <span>Predictive</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={blend}
          onChange={(e) => onBlend(Number(e.target.value))}
          aria-label="Blend between resume (0) and predictive (100)"
          className="w-full"
        />
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-current/20">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">Team</th>
            <th className="hidden py-2 pr-2 sm:table-cell">Conf</th>
            <th className="py-2 pr-2">Record</th>
            <th className="py-2 pr-2 text-right">Score</th>
            <th className="hidden py-2 pr-2 text-right sm:table-cell">Pred</th>
            <th className="hidden py-2 pr-2 text-right sm:table-cell">Resume</th>
            <th className="hidden py-2 text-right sm:table-cell">Chg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <RowGroup key={t.id} t={t} expanded={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function change(c: number | null) {
  if (c === null) return "–";
  if (c === 0) return "=";
  return c > 0 ? `▲${c}` : `▼${-c}`;
}

function RowGroup({ t, expanded, onToggle }: { t: ReturnType<typeof rankTeams>[number]; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b border-current/10 sm:cursor-default" onClick={onToggle}>
        <td className="py-2 pr-2 tabular-nums">{t.rank}</td>
        <td className="py-2 pr-2 font-medium">{t.name}</td>
        <td className="hidden py-2 pr-2 sm:table-cell">{t.conference ?? ""}</td>
        <td className="py-2 pr-2 tabular-nums">{t.wins}-{t.losses}</td>
        <td className="py-2 pr-2 text-right tabular-nums">{t.blended.toFixed(2)}</td>
        <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{t.predRank ?? "–"}</td>
        <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{t.resumeRank ?? "–"}</td>
        <td className="hidden py-2 text-right tabular-nums sm:table-cell">{change(t.change)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-current/10 sm:hidden">
          <td colSpan={5} className="pb-2 text-xs opacity-80">
            {t.conference ?? "Independent"} · Predictive #{t.predRank ?? "–"} · Resume #{t.resumeRank ?? "–"} · Change {change(t.change)}
          </td>
        </tr>
      )}
    </>
  );
}
