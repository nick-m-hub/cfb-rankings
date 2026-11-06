"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MIN_PERSONAL_ROUNDS, TARGET_PERSONAL_ROUNDS } from "@/lib/blind/constants";
import { buildFeatures, FEATURE_NAMES, type FeatureMatrix } from "@/lib/blind/features";
import type { FitResult } from "@/lib/blind/fit";
import { defaultWeights, fitVoter } from "@/lib/blind/model";
import { pickTriple, tripleKey } from "@/lib/blind/pick";
import type { BlindCard, OpponentTier, Vote } from "@/lib/blind/types";

interface Props {
  season: number;
  week: number;
  cards: BlindCard[];
}

interface Reveal {
  teams: { id: number; name: string; conference: string | null; resumeRank: number | null; bestRank: number | null }[];
  crowd: { crowdWeek: string; votes: number; ranks: Record<string, number> | null };
}

const ORDINAL = ["1st", "2nd", "3rd"];
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

function tierText(kind: "Beat" | "Lost to", o: OpponentTier | null) {
  if (!o) return kind === "Beat" ? "No wins" : "No losses";
  const where = o.site === "home" ? "home" : o.site === "away" ? "road" : "neutral";
  return `${kind} ${o.fbs ? `a ${o.wins}-${o.losses} team` : "an FCS team"} (${where})`;
}

function pickFor(all: Vote[], f: FeatureMatrix): Vote | null {
  const counts = new Map<number, number>();
  for (const v of all) for (const id of v) counts.set(id, (counts.get(id) ?? 0) + 1);
  // Choose the cards that teach the fit the most, using the voter's current weights (or the defaults).
  const weights = all.length >= 3 ? fitVoter(all, f).weights : defaultWeights(f.rows[0]?.length ?? 0);
  return pickTriple({
    ids: f.ids,
    counts,
    seen: new Set(all.map(tripleKey)),
    features: new Map(f.ids.map((id, i) => [id, f.rows[i]])),
    weights,
    rng: Math.random,
  });
}

/** How long the team names stay on the cards after a round is ranked. */
const REVEAL_MS = 1400;

const noopSubscribe =() => () => {};

/** Renders the game only on the client: saved rounds come from localStorage, which the server cannot see. */
export function BlindRanking(props: Props) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return mounted ? <BlindGame {...props} /> : <p>Loading…</p>;
}

function loadVotes(key: string, validIds: readonly number[]): Vote[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const valid = new Set(validIds);
    return raw.filter((v): v is Vote => Array.isArray(v) && v.length === 3 && v.every((id) => valid.has(id)));
  } catch {
    return []; // Storage unavailable or corrupt: start fresh.
  }
}

function BlindGame({ season, week, cards }: Props) {
  const storageKey = `blind-votes:${season}`;
  const features = useMemo(() => buildFeatures(cards), [cards]);
  const [votes, setVotes] = useState<Vote[]>(() => loadVotes(storageKey, features.ids));
  const [triple, setTriple] = useState<Vote | null>(() => pickFor(votes, features));
  const [picked, setPicked] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [names, setNames] = useState<Record<string, string> | null>(null);
  const [view, setView] = useState<"play" | "results">("play");

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const scale = useMemo<Scale>(
    () => ({ teams: cards.length, marginMax: Math.max(10, Math.ceil(Math.max(...cards.map((c) => Math.abs(c.margin))))) }),
    [cards],
  );
  const fit = useMemo(
    () => (votes.length >= 3 ? fitVoter(votes, features) : null),
    [votes, features],
  );

  const next = useCallback(
    (all: Vote[]) => {
      setTriple(pickFor(all, features));
      setPicked([]);
      setNames(null);
      setLocked(false);
    },
    [features],
  );

  function save(all: Vote[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(all));
    } catch {
      // Ignore: votes still work for this visit.
    }
  }

  function choose(id: number) {
    if (!triple || locked) return;
    if (picked.includes(id)) {
      setPicked(picked.filter((p) => p !== id));
      return;
    }
    const order = [...picked, id];
    setPicked(order);
    if (order.length < 3) return;
    const vote = order as unknown as Vote;
    const all = [...votes, vote];
    setVotes(all);
    save(all);
    // Fire and forget: the personal ranking works even if this fails.
    fetch("/api/blind/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ first: vote[0], second: vote[1], third: vote[2] }),
    }).catch(() => {});
    // Lock the round (no redo), briefly flash the three names, then move on.
    setLocked(true);
    fetch(`/api/blind/names?ids=${vote.join(",")}`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: { names: Record<string, string> }) => setNames(d.names))
      .catch(() => {})
      .finally(() => setTimeout(() => next(all), REVEAL_MS));
  }

  function restart() {
    setVotes([]);
    save([]);
    next([]);
  }

  if (view === "results") {
    return <Results cards={cards} fit={fit} rounds={votes.length} onBack={() => setView("play")} />;
  }

  const rounds = votes.length;
  const unlocked = rounds >= MIN_PERSONAL_ROUNDS;
  const pct = Math.min(100, Math.round((rounds / TARGET_PERSONAL_ROUNDS) * 100));

  return (
    <div>
      <p className="mb-4 text-sm opacity-80">
        {season} season through week {week}. Tap the three teams in the order you would rank them: best first. Names
        are hidden until you see your ranking.
      </p>

      <div className="mb-5">
        <div className="mb-1 flex justify-between text-xs">
          <span>
            {rounds} round{rounds === 1 ? "" : "s"}
          </span>
          <span>{unlocked ? "Keep going to sharpen it" : `${MIN_PERSONAL_ROUNDS - rounds} more to unlock your ranking`}</span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-current/15" role="progressbar" aria-valuenow={rounds} aria-valuemax={TARGET_PERSONAL_ROUNDS}>
          <div className="h-full bg-current/70" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {triple ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {triple.map((id, i) => (
            <CardView
              key={id}
              card={byId.get(id)!}
              label={String.fromCharCode(65 + i)}
              place={picked.indexOf(id)}
              revealName={names?.[id] ?? null}
              scale={scale}
              onPick={() => choose(id)}
            />
          ))}
        </div>
      ) : (
        <p>You have ranked every combination available. Open your ranking below.</p>
      )}

      <p className="mt-3 text-xs opacity-60">
        EPA/play is expected points added per play. Offense and defense ranks are among FBS teams (#1 is best);
        schedule strength #1 is the hardest. Postgame win prob. is how often a team would be expected to win given
        the same underlying performance (efficiency, not the final score), averaged over its games.
      </p>

      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <button
          className="rounded border border-current/40 px-3 py-1.5 font-medium disabled:opacity-40"
          disabled={!unlocked || locked}
          onClick={() => setView("results")}
        >
          See my ranking
        </button>
        <button
          className="rounded border border-current/20 px-3 py-1.5 disabled:opacity-40"
          disabled={rounds === 0 || locked}
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            setConfirmReset(false);
            restart();
          }}
          onBlur={() => setConfirmReset(false)}
        >
          {confirmReset ? "Tap again to clear all rounds" : "Start over"}
        </button>
      </div>
    </div>
  );
}

interface Scale {
  /** Number of FBS teams, for rank bars. */
  teams: number;
  /** Margin that fills half of the centered margin bar. */
  marginMax: number;
}

/** Rank 1 -> full bar, last rank -> nearly empty. */
const rankFrac = (rank: number, teams: number) => (teams <= 1 ? 1 : 1 - (rank - 1) / (teams - 1));

function StatBar({ label, value, frac, centered = false }: { label: string; value: string; frac: number; centered?: boolean }) {
  const fill = centered
    ? { left: frac >= 0 ? "50%" : `${50 + frac * 50}%`, width: `${Math.abs(frac) * 50}%` }
    : { left: "0%", width: `${Math.max(0, frac) * 100}%` };
  return (
    <div>
      <div className="flex justify-between tabular-nums">
        <span className="opacity-60">{label}</span>
        <span>{value}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded bg-current/15">
        <div className="absolute inset-y-0 rounded bg-current/70" style={fill} />
        {centered && <div className="absolute inset-y-[-2px] left-1/2 w-px bg-current/50" />}
      </div>
    </div>
  );
}

function CardView({
  card,
  label,
  place,
  revealName,
  scale,
  onPick,
}: {
  card: BlindCard;
  scale: Scale;
  label: string;
  place: number;
  revealName: string | null;
  onPick: () => void;
}) {
  const chosen = place >= 0;
  return (
    <button
      onClick={onPick}
      aria-pressed={chosen}
      className={`relative flex flex-col justify-start rounded-lg border p-4 text-left text-sm transition ${chosen ? "border-current bg-current/10" : "border-current/25 hover:border-current/60"}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide opacity-60">Team {label}</span>
        {chosen && <span className="rounded-full border border-current px-2 py-0.5 text-xs font-semibold">{ORDINAL[place]}</span>}
      </div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold leading-none tabular-nums">
            {card.wins}-{card.losses}
          </p>
          <p className="mt-1 text-xs opacity-60">Record</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold leading-none tabular-nums">{card.sosRank ? `#${card.sosRank}` : "–"}</p>
          <p className="mt-1 text-xs opacity-60" title="Hardest to easiest among FBS teams, based on how often a top-12 team would win these games">
            Schedule strength
          </p>
        </div>
      </div>
      <div className="space-y-2.5">
        <StatBar
          label="Avg margin"
          value={signed(card.margin)}
          frac={Math.max(-1, Math.min(1, card.margin / scale.marginMax))}
          centered
        />
        <StatBar
          label="Offense (EPA/play)"
          value={card.offEpaRank ? `#${card.offEpaRank}` : "–"}
          frac={card.offEpaRank ? rankFrac(card.offEpaRank, scale.teams) : 0}
        />
        <StatBar
          label="Defense (EPA/play)"
          value={card.defEpaRank ? `#${card.defEpaRank}` : "–"}
          frac={card.defEpaRank ? rankFrac(card.defEpaRank, scale.teams) : 0}
        />
        <StatBar
          label="Postgame win prob."
          value={card.postgameWp === null ? "–" : `${Math.round(card.postgameWp * 100)}%`}
          frac={card.postgameWp ?? 0}
        />
      </div>
      <p className="mt-3 text-xs opacity-80">Best win: {tierText("Beat", card.bestWin)}</p>
      <p className="text-xs opacity-80">Worst loss: {tierText("Lost to", card.worstLoss)}</p>
      {revealName && (
        <span
          className="absolute inset-0 flex items-center justify-center rounded-lg p-3 text-center text-xl font-bold"
          style={{ background: "color-mix(in srgb, var(--background) 92%, transparent)" }}
        >
          {revealName}
        </span>
      )}
    </button>
  );
}

function Results({
  cards,
  fit,
  rounds,
  onBack,
}: {
  cards: BlindCard[];
  fit: FitResult | null;
  rounds: number;
  onBack: () => void;
}) {
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [error, setError] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/blind/results")
      .then((r) => (r.ok ? (r.json() as Promise<Reveal>) : Promise.reject(new Error("failed"))))
      .then((d) => !cancelled && setReveal(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map(reveal?.teams.map((t) => [t.id, t])), [reveal]);
  const rows = useMemo(
    () => (fit ? [...fit.ranks].sort((a, b) => a[1] - b[1]).map(([id, rank]) => ({ id, rank })) : []),
    [fit],
  );
  const shown = all ? rows : rows.slice(0, 25);
  const weights = fit
    ? FEATURE_NAMES.map((name, k) => ({ name, w: fit.weights[k] })).sort((a, b) => b.w - a.w)
    : [];
  const maxW = Math.max(0.01, ...weights.map((x) => Math.abs(x.w)));
  void cards;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Your ranking</h2>
        <button className="text-sm underline" onClick={onBack}>
          Keep ranking
        </button>
      </div>
      <p className="mb-4 text-sm opacity-80">
        Built from your {rounds} rounds. The model learns what you reward, then scores every FBS team.
      </p>

      <section className="mb-5 rounded border border-current/20 p-3">
        <h3 className="mb-2 text-sm font-semibold">What you value</h3>
        <ul className="space-y-1 text-xs">
          {weights.map((x) => (
            <li key={x.name} className="grid grid-cols-[9rem_1fr] items-center gap-2">
              <span>{x.name}</span>
              <span className="h-2 rounded bg-current/10">
                <span
                  className="block h-full rounded bg-current/60"
                  style={{ width: `${Math.max(0, (x.w / maxW) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="mb-3 text-sm">Could not load team names. Try again in a moment.</p>}
      {reveal && (
        <p className="mb-3 text-xs opacity-70">
          Crowd ranking resets every Monday.{" "}
          {reveal.crowd.ranks
            ? `Based on ${reveal.crowd.votes} votes this week.`
            : `Not enough votes yet this week (${reveal.crowd.votes} so far).`}
        </p>
      )}

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-current/20">
            <th className="py-2 pr-2">You</th>
            <th className="py-2 pr-2">Team</th>
            <th className="hidden py-2 pr-2 sm:table-cell">Conf</th>
            <th className="py-2 pr-2 text-right">Crowd</th>
            <th className="py-2 pr-2 text-right">Resume</th>
            <th className="py-2 text-right">Best</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ id, rank }) => {
            const t = byId.get(id);
            return (
              <tr key={id} className="border-b border-current/10">
                <td className="py-2 pr-2 tabular-nums">{rank}</td>
                <td className="py-2 pr-2 font-medium">{t?.name ?? "…"}</td>
                <td className="hidden py-2 pr-2 sm:table-cell">{t?.conference ?? ""}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{reveal?.crowd.ranks?.[id] ?? "–"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{t?.resumeRank ?? "–"}</td>
                <td className="py-2 text-right tabular-nums">{t?.bestRank ?? "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 25 && (
        <button className="mt-3 text-sm underline" onClick={() => setAll(!all)}>
          {all ? "Show top 25" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
