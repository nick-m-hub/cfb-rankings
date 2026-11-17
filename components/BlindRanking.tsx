"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { matchBlend, type BlendMatch } from "@/lib/blind/blend";
import { MIN_PERSONAL_ROUNDS, TARGET_PERSONAL_ROUNDS } from "@/lib/blind/constants";
import { buildFeatures, FEATURE_NAMES, type FeatureMatrix } from "@/lib/blind/features";
import type { FitResult } from "@/lib/blind/fit";
import { defaultWeights, fitVoter } from "@/lib/blind/model";
import { pickTriple, tripleKey } from "@/lib/blind/pick";
import type { BlindCard, Vote } from "@/lib/blind/types";
import { TeamLogo } from "./TeamLogo";
import { Button, Card, Toggle } from "./ui";

interface Props {
  season: number;
  week: number;
  cards: BlindCard[];
}

interface Reveal {
  teams: {
    id: number;
    name: string;
    conference: string | null;
    cfbdId?: number;
    color?: string | null;
    resumeRank: number | null;
    bestRank: number | null;
    zPred: number | null;
    zResume: number | null;
  }[];
  crowd: {
    votes: number;
    ranks: Record<string, number> | null;
    blend?: Pick<BlendMatch, "blend" | "low" | "high"> | null;
  };
}

const ORDINAL = ["1st", "2nd", "3rd"];

/** A team name (and logo) flashed on its card after the round is ranked. */
interface Revealed {
  name: string;
  cfbdId?: number;
}
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

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
  return mounted ? <BlindModes {...props} /> : <p className="text-muted">Loading…</p>;
}

const G6_PREF_KEY = "blind-g6";

/** Owns the G6-only toggle. Each mode is its own game (own saved rounds), so switching remounts it. */
function BlindModes(props: Props) {
  const [g6, setG6] = useState(() => {
    try {
      return localStorage.getItem(G6_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  function toggle(on: boolean) {
    setG6(on);
    try {
      localStorage.setItem(G6_PREF_KEY, on ? "1" : "0");
    } catch {
      // Ignore: the toggle still works for this visit.
    }
  }
  return <BlindGame key={g6 ? "g6" : "all"} {...props} g6={g6} onToggleG6={toggle} />;
}

const votesKey = (season: number, g6: boolean) => (g6 ? `blind-votes-g6:${season}` : `blind-votes:${season}`);

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

function BlindGame({
  season,
  week,
  cards: allCards,
  g6,
  onToggleG6,
}: Props & { g6: boolean; onToggleG6: (on: boolean) => void }) {
  const storageKey = votesKey(season, g6);
  // G6 mode plays only G6 teams, and the record feature is the record against G6 teams (what the card shows).
  const cards = useMemo(() => (g6 ? allCards.filter((c) => c.g6Record) : allCards), [allCards, g6]);
  const features = useMemo(() => buildFeatures(cards, { g6 }), [cards, g6]);
  const [votes, setVotes] = useState<Vote[]>(() => loadVotes(storageKey, features.ids));
  const [triple, setTriple] = useState<Vote | null>(() => pickFor(votes, features));
  const [picked, setPicked] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [names, setNames] = useState<Record<string, Revealed> | null>(null);
  // "results-all" is the main game's ranking, opened from G6 mode.
  const [view, setView] = useState<"play" | "results" | "results-all">("play");
  // The main game's saved rounds, for its "See my ranking" button while in G6 mode.
  const allFeatures = useMemo(() => (g6 ? buildFeatures(allCards) : features), [g6, allCards, features]);
  const mainVotes = useMemo(
    () => (g6 ? loadVotes(votesKey(season, false), allFeatures.ids) : null),
    [g6, season, allFeatures],
  );

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const scale = useMemo<Scale>(
    // Ranks on the cards are among all FBS teams, in either mode.
    () => ({ teams: allCards.length, marginMax: Math.max(10, Math.ceil(Math.max(...allCards.map((c) => Math.abs(c.margin))))) }),
    [allCards],
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
    // Fire and forget: the personal ranking works even if this fails. G6-mode votes stay personal: they were
    // cast on the G6-only record, so they would skew the crowd ranking.
    if (!g6) {
      fetch("/api/blind/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ first: vote[0], second: vote[1], third: vote[2] }),
      }).catch(() => {});
    }
    // Lock the round (no redo), briefly flash the three names, then move on.
    setLocked(true);
    fetch(`/api/blind/names?ids=${vote.join(",")}`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: { names: Record<string, string>; logos?: Record<string, number> }) =>
        setNames(Object.fromEntries(vote.map((id) => [id, { name: d.names[id], cfbdId: d.logos?.[id] }]))),
      )
      .catch(() => {})
      .finally(() => setTimeout(() => next(all), REVEAL_MS));
  }

  function restart() {
    setVotes([]);
    save([]);
    next([]);
  }

  if (view === "results") {
    return <Results fit={fit} votes={votes} g6={g6} onBack={() => setView("play")} />;
  }
  if (view === "results-all" && mainVotes) {
    const mainFit = mainVotes.length >= 3 ? fitVoter(mainVotes, allFeatures) : null;
    return <Results fit={mainFit} votes={mainVotes} g6={false} onBack={() => setView("play")} />;
  }

  const rounds = votes.length;
  const unlocked = rounds >= MIN_PERSONAL_ROUNDS;
  const pct = Math.min(100, Math.round((rounds / TARGET_PERSONAL_ROUNDS) * 100));

  return (
    <div>
      <p className="-mt-3 mb-5 max-w-2xl text-sm text-muted">
        {season} season through week {week}. Tap the three teams in the order you would rank them: best first. Names
        are hidden until you see your ranking.
      </p>

      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
        <Toggle
          checked={g6}
          disabled={locked}
          onChange={onToggleG6}
          label="G6 only"
          hint={g6 ? `${cards.length} teams, rounds saved separately` : undefined}
        />
        <div className="flex-1">
          <div className="mb-1.5 flex justify-between gap-3 text-xs">
            <span className="font-semibold tabular-nums">
              {rounds} round{rounds === 1 ? "" : "s"}
            </span>
            <span className="text-muted">
              {unlocked ? "Keep going to sharpen it" : `${MIN_PERSONAL_ROUNDS - rounds} more to unlock your ranking`}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={rounds}
            aria-valuemax={TARGET_PERSONAL_ROUNDS}
          >
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Card>

      {triple ? (
        // Phones: the three cards sit side by side in a row that scrolls sideways (two fit, the third peeks).
        <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
          {triple.map((id, i) => (
            <CardView
              key={id}
              card={byId.get(id)!}
              label={String.fromCharCode(65 + i)}
              place={picked.indexOf(id)}
              revealed={names?.[id] ?? null}
              scale={scale}
              g6={g6}
              onPick={() => choose(id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted">You have ranked every combination available. Open your ranking below.</p>
      )}

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-muted">
        {g6 && "Record, avg margin and postgame win prob. count only games against other G6 teams; the other stats cover every game. "}
        EPA/play is expected points added per play. Offense and defense ranks are among FBS teams (#1 is best).
        Postgame win prob. is how often a team would be expected to win given the same underlying performance
        (efficiency, not the final score), averaged over its games.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {g6 ? (
          <>
            <Button variant="primary" disabled={!unlocked || locked} onClick={() => setView("results")}>
              See my G6 ranking
            </Button>
            <Button
              disabled={(mainVotes?.length ?? 0) < MIN_PERSONAL_ROUNDS || locked}
              onClick={() => setView("results-all")}
            >
              See my ranking
            </Button>
          </>
        ) : (
          <Button variant="primary" disabled={!unlocked || locked} onClick={() => setView("results")}>
            See my ranking
          </Button>
        )}
        <Button
          disabled={rounds === 0 || locked}
          className={confirmReset ? "border-down text-down" : ""}
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
          {confirmReset ? (g6 ? "Tap again to clear your G6 rounds" : "Tap again to clear all rounds") : "Start over"}
        </Button>
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
      <div className="flex justify-between gap-2 leading-tight tabular-nums">
        <span className="text-muted">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-line">
        <div className="absolute inset-y-0 rounded-full bg-accent/80" style={fill} />
        {centered && <div className="absolute inset-y-[-2px] left-1/2 w-px bg-muted" />}
      </div>
    </div>
  );
}

function CardView({
  card,
  label,
  place,
  revealed,
  scale,
  g6,
  onPick,
}: {
  card: BlindCard;
  g6: boolean;
  scale: Scale;
  label: string;
  place: number;
  revealed: Revealed | null;
  onPick: () => void;
}) {
  const chosen = place >= 0;
  return (
    <button
      onClick={onPick}
      aria-pressed={chosen}
      className={`relative flex w-[9.75rem] shrink-0 snap-start scroll-ml-4 flex-col justify-start rounded-xl border bg-surface p-3 text-left text-xs shadow-sm transition sm:w-auto sm:p-4 sm:text-sm ${chosen ? "border-accent ring-2 ring-accent/25" : "border-line hover:-translate-y-0.5 hover:border-muted hover:shadow-md"}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Team {label}</span>
        {chosen && <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-ink">{ORDINAL[place]}</span>}
      </div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-semibold leading-none tabular-nums sm:text-3xl">
            {g6 && card.g6Record ? `${card.g6Record.w}-${card.g6Record.l}` : `${card.wins}-${card.losses}`}
          </p>
          <p className="mt-1 text-xs text-muted">{g6 ? "Record vs G6" : "Record"}</p>
        </div>
      </div>
      <div className="space-y-2 sm:space-y-2.5">
        {(() => {
          // G6 mode: games against G6 teams only, like the record.
          const margin = g6 ? card.g6Margin : card.margin;
          return (
            <StatBar
              label={g6 ? "Avg margin vs G6" : "Avg margin"}
              value={margin === null ? "–" : signed(margin)}
              frac={margin === null ? 0 : Math.max(-1, Math.min(1, margin / scale.marginMax))}
              centered
            />
          );
        })()}
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
        {(() => {
          // G6 mode: averaged over games against G6 teams only, like the record.
          const wp = g6 ? card.g6PostgameWp : card.postgameWp;
          return (
            <StatBar
              label={g6 ? "Postgame win prob. vs G6" : "Postgame win prob."}
              value={wp === null ? "–" : `${Math.round(wp * 100)}%`}
              frac={wp ?? 0}
            />
          );
        })()}
      </div>
      <Quadrants quadrants={card.quadrants} />
      {revealed && (
        <span
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl p-3 text-center"
          style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)" }}
        >
          {revealed.cfbdId && <TeamLogo cfbdId={revealed.cfbdId} name={revealed.name} size={56} />}
          <span className="font-display text-xl font-semibold leading-tight sm:text-2xl">{revealed.name}</span>
          {chosen && <span className="text-xs font-semibold text-accent">Your {ORDINAL[place]}</span>}
        </span>
      )}
    </button>
  );
}

const QUADRANT_HINT =
  "Record by opponent strength (our best-team rating). Home games: Q1 = top 15, Q2 = 16-40, Q3 = 41-75, Q4 = 76+. Neutral and road opponents count as tougher, so those bands reach further down.";

/** W-L against opponent quadrants Q1 (hardest) to Q4. */
function Quadrants({ quadrants }: { quadrants: BlindCard["quadrants"] }) {
  return (
    <div className="mt-3" title={QUADRANT_HINT}>
      <p className="mb-1 text-xs leading-tight text-muted">Record vs. opponent quadrant</p>
      <div className="grid grid-cols-4 gap-1 text-center">
        {[0, 1, 2, 3].map((q) => (
          <div key={q} className="rounded-md bg-bg px-0.5 py-1 sm:px-1">
            <p className="text-[10px] font-semibold uppercase text-muted">Q{q + 1}</p>
            <p className="text-xs font-semibold tabular-nums sm:text-sm">{quadrants ? `${quadrants[q].w}-${quadrants[q].l}` : "–"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Results({
  fit,
  votes,
  g6,
  onBack,
}: {
  fit: FitResult | null;
  votes: readonly Vote[];
  /** G6 ranking: personal only, so no crowd column. */
  g6: boolean;
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

  const rounds = votes.length;
  const byId = useMemo(() => new Map(reveal?.teams.map((t) => [t.id, t])), [reveal]);
  const mine = useMemo(
    () => (reveal ? matchBlend(votes, byId, { minVotes: MIN_PERSONAL_ROUNDS }) : null),
    [reveal, votes, byId],
  );
  const rows = useMemo(
    () => (fit ? [...fit.ranks].sort((a, b) => a[1] - b[1]).map(([id, rank]) => ({ id, rank })) : []),
    [fit],
  );
  const shown = all ? rows : rows.slice(0, 25);
  const weights = fit
    ? FEATURE_NAMES.map((name, k) => ({ name, w: fit.weights[k] })).sort((a, b) => b.w - a.w)
    : [];
  const maxW = Math.max(0.01, ...weights.map((x) => Math.abs(x.w)));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">{g6 ? "Your G6 ranking" : "Your ranking"}</h2>
        <Button onClick={onBack}>Keep ranking</Button>
      </div>
      <p className="mb-5 text-sm text-muted">
        Built from your {rounds} {g6 ? "G6 " : ""}rounds. The model learns what you reward, then scores every{" "}
        {g6 ? "G6" : "FBS"} team.{g6 && " Resume and Best are overall FBS ranks."}
      </p>

      {mine && <YourBlend mine={mine} crowd={g6 ? null : (reveal?.crowd.blend ?? null)} g6={g6} />}

      <Card className="mb-5 p-4">
        <h3 className="mb-3 text-sm font-semibold">What you value</h3>
        <ul className="space-y-1 text-xs">
          {weights.map((x) => (
            <li key={x.name} className="grid grid-cols-[9rem_1fr] items-center gap-2">
              <span>{x.name}</span>
              <span className="h-2 rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-accent/80"
                  style={{ width: `${Math.max(0, (x.w / maxW) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {error && <p className="mb-3 text-sm">Could not load team names. Try again in a moment.</p>}
      {reveal && !g6 && (
        <p className="mb-3 text-xs text-muted">
          The crowd ranking builds all season: every vote refines what the crowd values, applied to this week&apos;s stats.{" "}
          {reveal.crowd.ranks
            ? `Based on ${reveal.crowd.votes.toLocaleString()} votes this season.`
            : `Not enough votes yet this season (${reveal.crowd.votes} so far).`}
        </p>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-ink/[0.03] text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2.5 pl-4 pr-2 font-medium">You</th>
              <th className="py-2.5 pr-2 font-medium">Team</th>
              {!g6 && <th className="py-2.5 pr-2 text-right font-medium">Crowd</th>}
              <th className="py-2.5 pr-2 text-right font-medium">Resume</th>
              <th className="py-2.5 pr-4 text-right font-medium">Best</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ id, rank }) => {
              const t = byId.get(id);
              return (
                <tr key={id} className="border-b border-line last:border-0">
                  <td className="py-2 pl-4 pr-2 text-base font-semibold tabular-nums">{rank}</td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2.5">
                      {t ? <TeamLogo cfbdId={t.cfbdId} name={t.name} color={t.color} size={24} /> : <span className="h-6 w-6" />}
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{t?.name ?? "…"}</div>
                        <div className="truncate text-xs text-muted">{t ? (t.conference ?? "Independent") : ""}</div>
                      </div>
                    </div>
                  </td>
                  {!g6 && <td className="py-2 pr-2 text-right tabular-nums text-muted">{reveal?.crowd.ranks?.[id] ?? "–"}</td>}
                  <td className="py-2 pr-2 text-right tabular-nums text-muted">{t?.resumeRank ?? "–"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-muted">{t?.bestRank ?? "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {rows.length > 25 && (
        <Button className="mt-3" onClick={() => setAll(!all)}>
          {all ? "Show top 25" : `Show all ${rows.length}`}
        </Button>
      )}
    </div>
  );
}

/** Where the voter's picks (and the season's crowd's) sit on the rankings slider. */
function YourBlend({
  mine,
  crowd,
  g6,
}: {
  mine: BlendMatch;
  crowd: Pick<BlendMatch, "blend" | "low" | "high"> | null;
  g6: boolean;
}) {
  /** The whole slider fits the votes about equally: no lean to report. */
  const undecided = mine.low === 0 && mine.high === 100;
  /** "17% best team, 83% most deserving": the slider value in the words the rankings page uses. */
  const mix = (v: number) => `${v}% best team, ${100 - v}% most deserving`;
  const marker = (v: number, label: string, strong: boolean) => (
    <span
      className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: `${v}%` }}
    >
      <span className={`block h-4 w-1 rounded ${strong ? "bg-accent" : "bg-muted"}`} />
      {/* Near either end the label hangs inward instead of centering, so it isn't clipped. */}
      <span
        className={`absolute top-5 whitespace-nowrap text-[10px] ${strong ? "font-semibold text-accent" : "text-muted"} ${
          v < 10 ? "left-0" : v > 90 ? "right-0" : ""
        }`}
      >
        {label}
      </span>
    </span>
  );
  return (
    <Card className="mb-5 p-4">
      <h3 className="mb-1 text-sm font-semibold">Your blend</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        {undecided ? (
          <>Your picks don&apos;t lean toward most deserving or best team yet: every mix fits them about equally well. Play more rounds to find out.</>
        ) : (
          <>
            Your picks best match a mix of <strong className="text-ink">{mix(mine.blend)}</strong>, which agrees with{" "}
            {Math.round(mine.agreement * 100)}% of your head-to-head choices.
            {mine.high > mine.low &&
              ` Anything from ${mine.low}% to ${mine.high}% best team (the shaded band) fits your picks almost as well${
                mine.high - mine.low >= 50 ? ", so play more rounds to narrow it down" : ""
              }.`}
          </>
        )}
        {g6 && " Measured against the overall FBS models."}
      </p>
      <div className="mb-1 flex justify-between text-[11px] text-muted">
        <span>Most deserving</span>
        <span>Best team</span>
      </div>
      <div className="relative mb-7 h-2 rounded-full bg-line">
        {crowd && (
          <span
            className="absolute inset-y-0 rounded-full bg-muted/25"
            style={{ left: `${crowd.low}%`, width: `${Math.max(1, crowd.high - crowd.low)}%` }}
          />
        )}
        {!undecided && (
          <span
            className="absolute inset-y-0 rounded-full bg-accent/30"
            style={{ left: `${mine.low}%`, width: `${Math.max(1, mine.high - mine.low)}%` }}
          />
        )}
        {crowd && marker(crowd.blend, "Crowd", false)}
        {!undecided && marker(mine.blend, "You", true)}
      </div>
      {crowd && (
        <p className="mb-2 text-xs text-muted">
          The crowd this season: {mix(crowd.blend)}
          {crowd.high > crowd.low && ` (anything from ${crowd.low}% to ${crowd.high}% best team fits)`}.
        </p>
      )}
      {!undecided && (
        <Link className="text-xs font-medium text-accent underline underline-offset-2" href={`/rankings?blend=${mine.blend}`}>
          See the rankings with your mix
        </Link>
      )}
    </Card>
  );
}
