import type {
  CalendarWeek,
  CfbdGame,
  CfbdInfo,
  CfbdTeam,
  Classification,
  EloRating,
  FpiRating,
  RankingsWeek,
  SeasonType,
  SpRating,
  SrsRating,
} from "./types";

const BASE_URL = "https://api.collegefootballdata.com";

/** Where raw responses are kept so a re-run costs no API calls. Implemented in disk-cache.ts. */
export interface ResponseCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface CfbdClientOptions {
  apiKey: string;
  /** Omit for current-season data, which changes. Safe to use for completed seasons. */
  cache?: ResponseCache;
  /** Minimum gap between network calls. Cache hits are not throttled. */
  minIntervalMs?: number;
  /** Retries for 5xx and network errors only. 429 and 4xx are never retried. */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export class CfbdError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "CfbdError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

export function createCfbdClient(options: CfbdClientOptions) {
  const {
    apiKey,
    cache,
    minIntervalMs = 250,
    maxRetries = 2,
    fetchImpl = fetch,
  } = options;
  if (!apiKey) throw new Error("CFBD_API_KEY is missing");

  let lastCallAt = 0;
  const stats = { networkCalls: 0, cacheHits: 0 };

  async function throttle() {
    const wait = lastCallAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  }

  function buildUrl(path: string, query: Query) {
    const params = new URLSearchParams();
    for (const key of Object.keys(query).sort()) {
      const v = query[key];
      if (v !== undefined) params.set(key, String(v));
    }
    const qs = params.toString();
    return { cacheKey: qs ? `${path}?${qs}` : path, url: `${BASE_URL}${path}${qs ? `?${qs}` : ""}` };
  }

  async function get<T>(path: string, query: Query = {}, opts: { cache?: boolean } = {}): Promise<T> {
    const { cacheKey, url } = buildUrl(path, query);
    const useCache = cache && opts.cache !== false;

    if (useCache) {
      const hit = await cache.get(cacheKey);
      if (hit !== undefined) {
        stats.cacheHits++;
        return hit as T;
      }
    }

    for (let attempt = 0; ; attempt++) {
      await throttle();
      let res: Response;
      try {
        stats.networkCalls++;
        res = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        });
      } catch (err) {
        if (attempt < maxRetries) continue;
        throw new CfbdError(`Network error calling ${cacheKey}: ${String(err)}`, 0, cacheKey);
      }

      if (res.status === 429) {
        // Free tier is 1,000 calls/month on a shared pool. Retrying only burns quota.
        throw new CfbdError(`CFBD rate/quota limit hit (429) on ${cacheKey}`, 429, cacheKey);
      }
      if (res.status >= 500 && attempt < maxRetries) continue;
      if (!res.ok) {
        // Never include request headers in the message: they carry the API key.
        throw new CfbdError(`CFBD ${res.status} on ${cacheKey}`, res.status, cacheKey);
      }

      const data = (await res.json()) as T;
      if (useCache) await cache.set(cacheKey, data);
      return data;
    }
  }

  return {
    stats,

    /** Never cached: quota changes every call. */
    info: () => get<CfbdInfo>("/info", {}, { cache: false }),

    calendar: (year: number) => get<CalendarWeek[]>("/calendar", { year }),

    /** FBS membership for a season. Pass `year` so historical seasons get their own team list. */
    teamsFbs: (year: number) => get<CfbdTeam[]>("/teams/fbs", { year }),

    ratingsSp: (year: number) => get<SpRating[]>("/ratings/sp", { year }),
    ratingsFpi: (year: number) => get<FpiRating[]>("/ratings/fpi", { year }),
    ratingsSrs: (year: number) => get<SrsRating[]>("/ratings/srs", { year }),
    /** Only rating endpoint with real week-by-week history. Omit `week` for the end-of-season value. */
    ratingsElo: (year: number, week?: number) => get<EloRating[]>("/ratings/elo", { year, week }),

    /**
     * Games. Omit `classification` to include FCS opponents, which records need.
     * Omit `week` for the whole season in one call (cheaper on quota).
     */
    games: (
      year: number,
      q: { week?: number; seasonType?: SeasonType | "both"; classification?: Classification } = {},
    ) => get<CfbdGame[]>("/games", { year, ...q }),

    /** All polls for a season (or one week). Filter to COMMITTEE_POLL in the caller. */
    rankings: (year: number, q: { week?: number; seasonType?: SeasonType | "both" } = {}) =>
      get<RankingsWeek[]>("/rankings", { year, ...q }),
  };
}

export type CfbdClient = ReturnType<typeof createCfbdClient>;
