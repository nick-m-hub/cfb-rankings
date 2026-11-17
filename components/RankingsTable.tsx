"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BLEND } from "@/lib/site";
import { ShareTop25 } from "./ShareTop25";
import { TeamLogo } from "./TeamLogo";
import { Card, Select, Toggle } from "./ui";
import type { SeasonWeeks } from "@/lib/rankings/data";
import { blendLabel, parseBlend, rankView, type FilteredTeam, type TeamInput } from "@/lib/rankings/rank";

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
    () => rankView(teams, blend, season, g6),
    [teams, blend, g6, season],
  );
  const top = rows.slice(0, TOP);
  const rest = rows.slice(TOP);
  const [dialogTeam, setDialogTeam] = useState<Row | null>(null);
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

      <section aria-labelledby="top25">
        <div className="mb-3 flex items-center justify-between gap-3">
          {/* The mix sits in the heading so a screenshot of the grid says which ranking it is. */}
          <div className="min-w-0">
            <h2 id="top25" className="font-display text-2xl font-semibold">{g6 ? "G6 top 25" : "Top 25"}</h2>
            <p className="text-xs font-medium text-accent">
              {season} Week {week} · {blendLabel(blend)}
            </p>
          </div>
          <ShareTop25 season={season} week={week} blend={blend} g6={g6} />
        </div>
        <ol className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
          {top.map((t) => (
            <li key={t.id}>
              <TeamCard t={t} g6={g6} onOpen={() => setDialogTeam(t)} />
            </li>
          ))}
        </ol>
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="rest" className="mt-10">
          <h2 id="rest" className="mb-3 font-display text-2xl font-semibold">Everyone else</h2>
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
                {rest.map((t) => (
                  <RowGroup
                    key={t.id}
                    t={t}
                    g6={g6}
                    expanded={open === t.id}
                    onToggle={() => setOpen(open === t.id ? null : t.id)}
                  />
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {dialogTeam && <TeamDialog t={dialogTeam} onClose={() => setDialogTeam(null)} />}
    </div>
  );
}

const TOP = 25;

/** Compact on purpose: all 25 fit in one screenshot on a laptop and nearly on a phone. */
function TeamCard({ t, g6, onOpen }: { t: Row; g6: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${t.rank}. ${t.name}, ${t.wins}-${t.losses}. Details`}
      className="flex h-full w-full flex-col rounded-lg border border-line border-t-[3px] bg-surface px-2 pb-1 pt-1 text-left sm:pb-1.5 sm:pt-1.5 transition hover:-translate-y-0.5 hover:shadow-md sm:px-2.5"
      style={t.color ? { borderTopColor: t.color } : undefined}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="font-display text-lg font-semibold leading-none tabular-nums sm:text-xl">{t.rank}</span>
        <TeamLogo cfbdId={t.cfbdId} name={t.name} color={t.color} size={24} />
      </span>
      <span className="mt-0.5 truncate text-xs font-semibold sm:mt-1 sm:text-[13px]">{t.name}</span>
      <span className="flex items-center justify-between gap-1 text-[11px] tabular-nums text-muted">
        <span>
          {t.wins}-{t.losses}
          {g6 && <span className="hidden sm:inline"> · FBS #{t.fbsRank}</span>}
        </span>
        <Change c={t.change} />
      </span>
    </button>
  );
}

/** Details for a top-25 card, in a modal (a grid has no row to expand into). Esc or a backdrop click closes it. */
function TeamDialog({ t, onClose }: { t: Row; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-label={`${t.name} details`}
      className="m-auto w-[calc(100%-2rem)] max-w-3xl rounded-xl bg-transparent p-0 text-ink backdrop:bg-black/50"
    >
      <div className="relative">
        <button
          onClick={() => ref.current?.close()}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-ink/[0.06] hover:text-ink"
        >
          ×
        </button>
        <p className="absolute right-12 top-4 text-xs font-semibold tabular-nums text-muted">#{t.rank}</p>
        <Details t={t} />
      </div>
    </dialog>
  );
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
  expanded,
  onToggle,
}: {
  t: Row;
  g6: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const border = "border-b border-line";
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
