"use client";

import { useMemo, useState } from "react";
import { oppStrength } from "@/lib/blind/features";
import { sortRows, type SortDir } from "@/lib/blind/table";
import type { OpponentTier } from "@/lib/blind/types";
import type { QuadrantRecord } from "@/lib/models/sos";

export interface StatsRow {
  id: number;
  name: string;
  conference: string | null;
  wins: number;
  losses: number;
  /** How often a top-12 FBS team would win this schedule (0 to 1); lower = harder. */
  sos: number | null;
  sosRank: number | null;
  margin: number;
  offEpa: number | null;
  offEpaRank: number | null;
  defEpa: number | null;
  defEpaRank: number | null;
  postgameWp: number | null;
  bestWin: OpponentTier | null;
  worstLoss: OpponentTier | null;
  quadrants: QuadrantRecord[] | null;
  resumeRank: number | null;
  bestRank: number | null;
}

interface Column {
  id: string;
  label: string;
  /** Tooltip explaining the column. */
  hint?: string;
  /** Value to sort by; null sorts last. */
  value: (r: StatsRow) => number | string | null;
  /** Direction used the first time the column is clicked: the "best first" way. */
  firstDir: SortDir;
  align?: "right";
  cell: (r: StatsRow) => React.ReactNode;
}

const winPct = (r: StatsRow) => (r.wins + r.losses === 0 ? 0 : r.wins / (r.wins + r.losses));
const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
const dash = <span className="opacity-40">–</span>;

function opponent(o: OpponentTier | null, none: string) {
  if (!o) return <span className="opacity-60">{none}</span>;
  const where = o.site === "home" ? "home" : o.site === "away" ? "road" : "neutral";
  return (
    <>
      {o.fbs ? `${o.wins}-${o.losses}` : "FCS"} <span className="opacity-60">{where}</span>
    </>
  );
}

function rankCell(rank: number | null, value: number | null, digits = 2) {
  if (rank === null) return dash;
  return (
    <>
      #{rank}
      {value !== null && <span className="ml-1 text-xs opacity-60">{signed(value, digits)}</span>}
    </>
  );
}

const COLUMNS: Column[] = [
  { id: "team", label: "Team", value: (r) => r.name, firstDir: "asc", cell: (r) => <span className="font-medium">{r.name}</span> },
  { id: "conf", label: "Conf", value: (r) => r.conference, firstDir: "asc", cell: (r) => r.conference ?? "" },
  {
    id: "record",
    label: "Record",
    value: winPct,
    firstDir: "desc",
    cell: (r) => (
      <>
        {r.wins}-{r.losses}
      </>
    ),
  },
  {
    id: "sos",
    label: "Schedule",
    hint: "Schedule strength rank (#1 hardest) and how often a top-12 FBS team would win these games",
    value: (r) => r.sosRank,
    firstDir: "asc",
    align: "right",
    cell: (r) =>
      r.sosRank === null ? (
        dash
      ) : (
        <>
          #{r.sosRank}
          {r.sos !== null && <span className="ml-1 text-xs opacity-60">{Math.round(r.sos * 100)}%</span>}
        </>
      ),
  },
  { id: "margin", label: "Margin", value: (r) => r.margin, firstDir: "desc", align: "right", cell: (r) => signed(r.margin) },
  {
    id: "off",
    label: "Offense EPA",
    value: (r) => r.offEpaRank,
    firstDir: "asc",
    align: "right",
    cell: (r) => rankCell(r.offEpaRank, r.offEpa),
  },
  {
    id: "def",
    label: "Defense EPA",
    value: (r) => r.defEpaRank,
    firstDir: "asc",
    align: "right",
    cell: (r) => rankCell(r.defEpaRank, r.defEpa),
  },
  {
    id: "wp",
    label: "Postgame WP",
    value: (r) => r.postgameWp,
    firstDir: "desc",
    align: "right",
    cell: (r) => (r.postgameWp === null ? dash : `${Math.round(r.postgameWp * 100)}%`),
  },
  {
    id: "bestWin",
    label: "Best win",
    value: (r) => (r.bestWin ? oppStrength(r.bestWin) : null),
    firstDir: "desc",
    cell: (r) => opponent(r.bestWin, "none"),
  },
  {
    id: "worstLoss",
    label: "Worst loss",
    // No losses is the best case, so it sorts as a perfect 1.
    value: (r) => (r.worstLoss ? oppStrength(r.worstLoss) : 1),
    firstDir: "desc",
    cell: (r) => opponent(r.worstLoss, "none"),
  },
  ...[0, 1, 2, 3].map(
    (q): Column => ({
      id: `q${q + 1}`,
      label: `Q${q + 1}`,
      hint: `Record vs. quadrant ${q + 1} opponents (by best-team rating; home Q1-Q4 = top 15 / 16-40 / 41-75 / 76+, neutral and road bands reach further down). Sorts by wins, then fewer losses.`,
      // Wins first, then fewer losses; teams with no games in the quadrant sort as 0 wins.
      value: (r) => (r.quadrants ? r.quadrants[q].w - r.quadrants[q].l / 100 : null),
      firstDir: "desc",
      align: "right",
      cell: (r) => (r.quadrants ? `${r.quadrants[q].w}-${r.quadrants[q].l}` : dash),
    }),
  ),
  { id: "resume", label: "Resume", value: (r) => r.resumeRank, firstDir: "asc", align: "right", cell: (r) => (r.resumeRank ? `#${r.resumeRank}` : dash) },
  { id: "best", label: "Best team", value: (r) => r.bestRank, firstDir: "asc", align: "right", cell: (r) => (r.bestRank ? `#${r.bestRank}` : dash) },
];

export function StatsTable({ rows }: { rows: StatsRow[] }) {
  const [sort, setSort] = useState<{ id: string; dir: SortDir }>({ id: "resume", dir: "asc" });
  const column = COLUMNS.find((c) => c.id === sort.id)!;
  const sorted = useMemo(
    () =>
      sortRows(rows, column.value, sort.dir, (a, b) => winPct(b) - winPct(a) || a.name.localeCompare(b.name)),
    [rows, column, sort.dir],
  );

  function onSort(c: Column) {
    setSort((cur) => (cur.id === c.id ? { id: c.id, dir: cur.dir === "asc" ? "desc" : "asc" } : { id: c.id, dir: c.firstDir }));
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] text-left text-sm">
        <thead>
          <tr className="border-b border-current/20">
            <th className="py-2 pr-2 text-right opacity-60">#</th>
            {COLUMNS.map((c) => {
              const active = c.id === sort.id;
              return (
                <th
                  key={c.id}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={`py-2 pr-3 ${c.align === "right" ? "text-right" : ""}`}
                >
                  <button
                    onClick={() => onSort(c)}
                    title={c.hint}
                    className={`whitespace-nowrap font-semibold hover:underline ${active ? "" : "opacity-70"}`}
                  >
                    {c.label}
                    <span aria-hidden className="ml-1 inline-block w-3 text-xs">
                      {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.id} className="border-b border-current/10 hover:bg-current/5">
              <td className="py-1.5 pr-2 text-right tabular-nums opacity-60">{i + 1}</td>
              {COLUMNS.map((c) => (
                <td key={c.id} className={`whitespace-nowrap py-1.5 pr-3 tabular-nums ${c.align === "right" ? "text-right" : ""}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
