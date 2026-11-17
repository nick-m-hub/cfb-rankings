import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/LogoMark";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const alt = `${SITE_NAME}: college football power rankings`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share preview for every page (pages without their own image inherit the root one). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "#fbfaf8",
          color: "#16181d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <LogoMark size={144} />
          <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>{SITE_NAME}</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 38, color: "#5d6470", maxWidth: 900, lineHeight: 1.35 }}>
          {SITE_DESCRIPTION}
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 56, gap: 20, fontSize: 26, color: "#5d6470" }}>
          <span>Most deserving</span>
          <div style={{ display: "flex", position: "relative", width: 420, height: 10, borderRadius: 5, background: "#e4e2dd" }}>
            <div style={{ width: 210, height: 10, borderRadius: 5, background: "#1d4ed8" }} />
            <div
              style={{
                position: "absolute",
                left: 194,
                top: -11,
                width: 32,
                height: 32,
                borderRadius: 16,
                background: "#ffffff",
                border: "4px solid #1d4ed8",
              }}
            />
          </div>
          <span>Best team</span>
        </div>
      </div>
    ),
    size,
  );
}
