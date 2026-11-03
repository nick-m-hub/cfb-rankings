// Team-name crosswalk: maps the name variants each source uses onto one canonical team.
//
// Pure and DB-free. Ingest loads `teams` + `team_aliases` from Postgres (or builds from CFBD's team
// list), constructs a resolver, and writes `aliasRows` back with upserts. Unmatched names are never
// dropped silently: `resolveAll` throws UnmatchedTeamsError listing every miss.

import type { CfbdTeam } from "../cfbd/types";

/** Alias source tags stored in `team_aliases.source`. */
export const ALIAS_SOURCE = {
  /** school, abbreviation-free name variants from CFBD /teams. */
  cfbd: "cfbd",
  /** Hand-maintained fixes for names CFBD's team list does not cover. */
  manual: "manual",
} as const;

export interface CanonicalTeam {
  /** `teams.id` once persisted. Use cfbd_id as the key before then. */
  id: number;
  name: string;
}

export interface AliasRow {
  alias: string;
  source: string;
  team_id: number;
}

/**
 * Hand-maintained aliases: canonical CFBD school name -> extra variants other endpoints emit.
 * Add entries here when a run reports unmatched names. Keep each with a reason.
 */
export const MANUAL_ALIASES: Record<string, string[]> = {
  // Example shape; populate from real unmatched reports during backfill:
  // "San José State": ["San Jose State"],  // (accent-folding already handles this one)
};

/** Case, accent, punctuation and whitespace insensitive key. Deliberately does not touch words like "State". */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export class AmbiguousAliasError extends Error {
  constructor(
    readonly alias: string,
    readonly teamIds: number[],
  ) {
    super(`Alias "${alias}" maps to multiple teams: ${teamIds.join(", ")}`);
    this.name = "AmbiguousAliasError";
  }
}

export interface Unmatched {
  name: string;
  source: string;
}

export class UnmatchedTeamsError extends Error {
  constructor(readonly unmatched: Unmatched[]) {
    super(
      `${unmatched.length} unmatched team name(s): ` +
        unmatched.map((u) => `"${u.name}" (${u.source})`).join(", "),
    );
    this.name = "UnmatchedTeamsError";
  }
}

export interface Crosswalk {
  /** Every alias row to upsert into `team_aliases` (original spelling preserved). */
  aliasRows: AliasRow[];
  /** Team id for a name, or undefined if unknown. */
  lookup(name: string): number | undefined;
  /**
   * Resolve many names. Throws UnmatchedTeamsError listing all misses, except those `skip` returns
   * true for (e.g. FCS rows in SRS that were never meant to match an FBS team).
   */
  resolveAll(
    names: readonly string[],
    opts: { source: string; skip?: (name: string) => boolean },
  ): Map<string, number>;
}

/**
 * Build a crosswalk from rows already known: canonical teams plus (alias, team_id) pairs.
 * Throws AmbiguousAliasError if one normalized alias points at two different teams.
 */
export function createCrosswalk(
  entries: readonly { alias: string; source: string; team_id: number }[],
): Crosswalk {
  const byKey = new Map<string, number>();
  const seenRows = new Map<string, AliasRow>();

  for (const e of entries) {
    const key = normalizeName(e.alias);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing !== undefined && existing !== e.team_id) {
      throw new AmbiguousAliasError(e.alias, [existing, e.team_id]);
    }
    byKey.set(key, e.team_id);
    seenRows.set(`${e.alias}\u0000${e.source}`, { alias: e.alias, source: e.source, team_id: e.team_id });
  }

  const lookup = (name: string) => byKey.get(normalizeName(name));

  return {
    aliasRows: [...seenRows.values()],
    lookup,
    resolveAll(names, { source, skip }) {
      const out = new Map<string, number>();
      const missing = new Map<string, Unmatched>();
      for (const name of names) {
        if (out.has(name) || missing.has(name)) continue;
        const id = lookup(name);
        if (id !== undefined) out.set(name, id);
        else if (!skip?.(name)) missing.set(name, { name, source });
      }
      if (missing.size > 0) throw new UnmatchedTeamsError([...missing.values()]);
      return out;
    },
  };
}

/**
 * Derive alias entries from CFBD's team list: school name, CFBD's alternate names, plus manual overrides.
 * `idOf` maps a CFBD team to its `teams.id`; before persistence pass `(t) => t.id` (cfbd id).
 * Abbreviations and mascots are intentionally excluded: too collision-prone ("State", "Tech").
 */
export function aliasEntriesFromCfbd(
  teams: readonly CfbdTeam[],
  idOf: (t: CfbdTeam) => number | undefined = (t) => t.id,
  manual: Record<string, string[]> = MANUAL_ALIASES,
): AliasRow[] {
  const rows: AliasRow[] = [];
  const bySchool = new Map(teams.map((t) => [t.school, t]));

  for (const t of teams) {
    const teamId = idOf(t);
    if (teamId === undefined) continue;
    rows.push({ alias: t.school, source: ALIAS_SOURCE.cfbd, team_id: teamId });
    for (const alt of t.alternateNames ?? []) {
      rows.push({ alias: alt, source: ALIAS_SOURCE.cfbd, team_id: teamId });
    }
  }

  for (const [school, variants] of Object.entries(manual)) {
    const team = bySchool.get(school);
    const teamId = team && idOf(team);
    if (teamId === undefined) continue; // team not in this list (e.g. a different season)
    for (const v of variants) rows.push({ alias: v, source: ALIAS_SOURCE.manual, team_id: teamId });
  }

  return rows;
}
