/** Brand blue for the logo tile. Fixed (not the theme accent) so the mark looks the same in light and dark. */
export const BRAND_BLUE = "#1d4ed8";

/**
 * The Sliding Scale mark: a tipped beam on a pivot with a ball resting on it (a scale, and a slider).
 * Plain SVG with no hooks, so it also renders inside next/og ImageResponse (apple icon, share image).
 * app/icon.svg is the same mark with thicker strokes for favicon sizes; keep the two in step.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill={BRAND_BLUE} />
      <path d="M16 19.5 L12.5 25 H19.5 Z" fill="#ffffff" fillOpacity="0.45" />
      <line x1="6" y1="21" x2="26" y2="11" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="20.5" cy="13.75" r="3.9" fill="#ffffff" />
    </svg>
  );
}
