// Records one blind-ranking vote. Anonymous: an httpOnly cookie holds a random session id used only for
// rate limiting. Writes with the service role (blind_votes has RLS on and no policies).

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminDb } from "@/lib/ingest/db";
import { crowdWeekStart, MAX_VOTES_PER_DAY, MIN_VOTE_INTERVAL_MS, SESSION_COOKIE } from "@/lib/blind/constants";
import { getBlindData } from "@/lib/blind/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const ids = [(body as Record<string, unknown>)?.first, (body as Record<string, unknown>)?.second, (body as Record<string, unknown>)?.third];
  if (!ids.every((x): x is number => Number.isInteger(x)) || new Set(ids).size !== 3) {
    return Response.json({ error: "need three distinct team ids" }, { status: 400 });
  }
  const blind = await getBlindData();
  if (!blind) return Response.json({ error: "no data" }, { status: 503 });
  const valid = new Set(blind.cards.map((c) => c.id));
  if (!ids.every((id) => valid.has(id))) return Response.json({ error: "unknown team id" }, { status: 400 });

  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  const session = existing && UUID.test(existing) ? existing : randomUUID();
  if (session !== existing) {
    jar.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/" });
  }

  const db = createAdminDb();
  const now = Date.now();
  const { data: recent, error: recentErr } = await db
    .from("blind_votes")
    .select("created_at")
    .eq("session_id", session)
    .gte("created_at", new Date(now - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_VOTES_PER_DAY);
  if (recentErr) return Response.json({ error: "database error" }, { status: 500 });
  if (recent.length >= MAX_VOTES_PER_DAY) return Response.json({ error: "daily limit reached" }, { status: 429 });
  if (recent[0] && now - Date.parse(recent[0].created_at) < MIN_VOTE_INTERVAL_MS) {
    return Response.json({ error: "too fast" }, { status: 429 });
  }

  const { error } = await db.from("blind_votes").insert({
    session_id: session,
    season: blind.season,
    week: blind.week,
    crowd_week: crowdWeekStart(new Date(now)),
    first: ids[0],
    second: ids[1],
    third: ids[2],
  });
  if (error) return Response.json({ error: "database error" }, { status: 500 });
  return Response.json({ ok: true });
}
