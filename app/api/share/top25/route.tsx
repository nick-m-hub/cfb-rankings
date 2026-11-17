// Share image: the top 25 at a given week and slider blend, as a 1080x1350 PNG (4:5 fits X, Instagram and
// iMessage). GET /api/share/top25?season=2026&week=12&blend=50[&g6=1]. Rendered with next/og; logos are
// read from public/logos (traced into this function by next.config.ts), with a fetch fallback.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_BLUE, LogoMark } from "@/components/LogoMark";
import { getWeekData } from "@/lib/rankings/data";
import { blendLabel, parseBlend, rankView, type FilteredTeam } from "@/lib/rankings/rank";
import { DEFAULT_BLEND, SITE_NAME, SITE_URL } from "@/lib/site";
import { logoPath } from "@/lib/teams/colors";

const W = 1080;
const H = 1350;
const INK = "#16181d";
const MUTED = "#5d6470";
const LINE = "#e4e2dd";

async function logoData(cfbdId: number | undefined, origin: string): Promise<string | null> {
  if (!cfbdId) return null;
  const rel = logoPath(cfbdId);
  try {
    const buf = await readFile(path.join(process.cwd(), "public", rel));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    try {
      const res = await fetch(new URL(rel, origin));
      if (!res.ok) return null;
      return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    } catch {
      return null;
    }
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const season = Number(url.searchParams.get("season"));
  const week = Number(url.searchParams.get("week"));
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 30) {
    return Response.json({ error: "need season and week" }, { status: 400 });
  }
  const blend = parseBlend(url.searchParams.get("blend"), DEFAULT_BLEND);
  const g6 = url.searchParams.get("g6") === "1";

  const data = await getWeekData(season, week);
  if (!data.found) return Response.json({ error: "no rankings for that week" }, { status: 404 });
  const top = rankView(data.teams, blend, season, g6).slice(0, 25);
  const logos = await Promise.all(top.map((t) => logoData(t.cfbdId, url.origin)));

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", padding: "52px 56px 40px", background: "#fbfaf8", color: INK }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <LogoMark size={56} />
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 30 }}>
          <div style={{ fontSize: 60, fontWeight: 700, letterSpacing: -1.5 }}>{g6 ? "G6 Top 25" : "Top 25"}</div>
          <div style={{ fontSize: 34, color: MUTED }}>{`${season} · Week ${week}`}</div>
        </div>
        <BlendBar blend={blend} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 30 }}>
          {top.map((t, i) => (
            <TeamTile key={t.id} t={t} logo={logos[i]} g6={g6} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", fontSize: 22, color: MUTED }}>
          <span>{new URL(SITE_URL).host}</span>
          <span>Set your own mix on the slider</span>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      // Same week and blend give the same image until the next ingest; keep CDN copies short-lived.
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
    },
  );
}

function BlendBar({ blend }: { blend: number }) {
  const track = 560;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: BRAND_BLUE }}>{blendLabel(blend)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, fontSize: 22, color: MUTED }}>
        <span>Most deserving</span>
        <div style={{ display: "flex", position: "relative", width: track, height: 10, borderRadius: 5, background: LINE }}>
          <div style={{ width: (track * blend) / 100, height: 10, borderRadius: 5, background: BRAND_BLUE }} />
          <div
            style={{
              position: "absolute",
              left: (track * blend) / 100 - 14,
              top: -10,
              width: 28,
              height: 28,
              borderRadius: 14,
              background: "#ffffff",
              border: `4px solid ${BRAND_BLUE}`,
            }}
          />
        </div>
        <span>Best team</span>
      </div>
    </div>
  );
}

const TILE_W = (W - 2 * 56 - 4 * 14) / 5;

function TeamTile({ t, logo, g6 }: { t: FilteredTeam; logo: string | null; g6: boolean }) {
  return (
    <div
      style={{
        width: TILE_W,
        height: 168,
        display: "flex",
        flexDirection: "column",
        padding: "10px 14px 12px",
        background: "#ffffff",
        border: `1px solid ${LINE}`,
        borderTop: `6px solid ${t.color ?? LINE}`,
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{t.rank}</span>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain <img>
          <img src={logo} width={62} height={62} alt="" style={{ objectFit: "contain" }} />
        ) : (
          <div style={{ width: 62, height: 62 }} />
        )}
      </div>
      <div style={{ display: "flex", marginTop: "auto", fontSize: 21, fontWeight: 700, lineHeight: 1.15 }}>{t.name}</div>
      <div style={{ display: "flex", fontSize: 18, color: MUTED, marginTop: 2 }}>
        {`${t.wins}-${t.losses}${g6 ? ` · FBS #${t.fbsRank}` : ""}`}
      </div>
    </div>
  );
}
