// Team colors and logos. Colors come from CFBD /teams (stored on `teams.color` / `alt_color` by
// `npm run sync-logos` and `npm run sync-teams`); logos are self-hosted in public/logos by CFBD id.

/** Normalizes a CFBD color to "#rrggbb", or null if missing or malformed. */
export function hexColor(c: string | null | undefined): string | null {
  if (!c) return null;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(c.trim().toLowerCase());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return `#${h}`;
}

/** Relative luminance (0 = black, 1 = white) of a "#rrggbb" color. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The team color to use as an accent: the primary color unless it is near white or near black (which
 * vanish on one of the two themes), then the alternate, else null.
 */
export function accentColor(color: string | null | undefined, alt: string | null | undefined): string | null {
  for (const c of [hexColor(color), hexColor(alt)]) {
    if (!c) continue;
    const l = luminance(c);
    if (l > 0.03 && l < 0.8) return c;
  }
  return null;
}

export const logoPath = (cfbdId: number, dark = false) => `/logos/${dark ? "dark/" : ""}${cfbdId}.png`;
