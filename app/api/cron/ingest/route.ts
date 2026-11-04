// Vercel Cron target (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Snapshots the current week: ingest -> compute -> on-demand revalidation. All writes are upserts.

import { timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { RANKINGS_TAG } from "@/lib/rankings/data";
import { createCfbdClient } from "@/lib/cfbd/client";
import { computeAndStoreWeek } from "@/lib/compute/run";
import { createAdminDb } from "@/lib/ingest/db";
import { ingestSeason, SeasonUnmatchedError } from "@/lib/ingest/season";
import { buildWeekMap, currentStoredWeek, seasonForDate } from "@/lib/ingest/weeks";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed when unconfigured
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const season = seasonForDate(now);
  // No disk cache: serverless fs is read-only and in-season responses change weekly.
  const cfbd = createCfbdClient({ apiKey: process.env.CFBD_API_KEY ?? "" });
  const db = createAdminDb();

  try {
    const calendar = await cfbd.calendar(season);
    const week = currentStoredWeek(calendar, buildWeekMap(calendar), now);
    if (week === null) return Response.json({ skipped: "offseason", season });

    const counts = await ingestSeason({ cfbd, db, season, weeks: [week], updateTeamMeta: true, log: console.log });
    const composite = await computeAndStoreWeek(db, season, week);

    revalidateTag(RANKINGS_TAG, { expire: 0 });
    revalidatePath("/rankings");
    revalidatePath("/rankings/[season]/[week]", "page");

    console.log(`cron ingest ${season} w${week}: ${JSON.stringify({ ...counts, gaps: counts.gaps.length })}`);
    return Response.json({ season, week, counts, composite, networkCalls: cfbd.stats.networkCalls });
  } catch (err) {
    if (err instanceof SeasonUnmatchedError) {
      console.error(`${err.message}: ${err.unmatched.map((u) => `"${u.name}" (${u.source})`).join(", ")}`);
      return Response.json({ error: err.message, unmatched: err.unmatched }, { status: 500 });
    }
    console.error("cron ingest failed", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
