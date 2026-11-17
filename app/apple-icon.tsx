import { ImageResponse } from "next/og";
import { BRAND_BLUE, LogoMark } from "@/components/LogoMark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS adds its own rounded corners, so fill the square with the brand blue behind the mark.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND_BLUE }}>
        <LogoMark size={180} />
      </div>
    ),
    size,
  );
}
