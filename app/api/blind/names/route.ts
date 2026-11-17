// Names for the three teams just ranked, so the page can flash them after the vote is cast.
// Deliberately limited to exactly three ids: the full name list is only served by /api/blind/results.
//
// This looks the three teams up directly instead of going through getBlindData: on a cold server that
// rebuilds every card from the database (~5s), and the page only waits a few seconds for the flash.

import { createAdminDb } from "@/lib/ingest/db";

export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").map(Number);
  if (ids.length !== 3 || !ids.every(Number.isInteger) || new Set(ids).size !== 3) {
    return Response.json({ error: "need three distinct team ids" }, { status: 400 });
  }
  const db = createAdminDb();
  // Cards are FBS teams from the newest season with rankings.
  const latest = await db.from("composite_scores").select("season").order("season", { ascending: false }).limit(1);
  if (latest.error) return Response.json({ error: "lookup failed" }, { status: 500 });
  const season = (latest.data?.[0] as { season: number } | undefined)?.season;
  if (season === undefined) return Response.json({ error: "no data" }, { status: 503 });
  const [fbs, teams] = await Promise.all([
    db.from("team_seasons").select("team_id").eq("season", season).eq("division", "fbs").in("team_id", ids),
    db.from("teams").select("id, name, cfbd_id").in("id", ids),
  ]);
  if (fbs.error || teams.error) return Response.json({ error: "lookup failed" }, { status: 500 });
  const allowed = new Set((fbs.data as { team_id: number }[]).map((r) => r.team_id));
  const rows = teams.data as { id: number; name: string; cfbd_id: number }[];
  const byId = new Map(rows.map((t) => [t.id, t.name]));
  const cfbdBy = new Map(rows.map((t) => [t.id, t.cfbd_id]));
  if (!ids.every((id) => allowed.has(id) && byId.has(id))) return Response.json({ error: "unknown team id" }, { status: 400 });
  return Response.json({
    names: Object.fromEntries(ids.map((id) => [id, byId.get(id)])),
    logos: Object.fromEntries(ids.map((id) => [id, cfbdBy.get(id)])),
  });
}
