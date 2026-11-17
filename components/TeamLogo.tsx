import Image from "next/image";
import { logoPath } from "@/lib/teams/colors";

interface Props {
  cfbdId?: number | null;
  /** Shown as initials when there is no logo. */
  name: string;
  color?: string | null;
  /** Rendered square size in px. */
  size?: number;
  className?: string;
}

/**
 * A team's self-hosted logo (public/logos, from `npm run sync-logos`), swapping to the dark-background
 * variant under a dark color scheme. Decorative (`alt=""`): the team name always sits next to it.
 * Falls back to initials tinted with the team color when there is no CFBD id.
 */
export function TeamLogo({ cfbdId, name, color, size = 24, className = "" }: Props) {
  const box = { width: size, height: size };
  if (!cfbdId) {
    const initials = name
      .split(/\s+/)
      .filter((w) => /^[A-Z]/.test(w))
      .slice(0, 2)
      .map((w) => w[0])
      .join("");
    return (
      <span
        aria-hidden
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-muted/15 font-semibold text-muted ${className}`}
        style={{ ...box, fontSize: Math.max(9, size * 0.38), color: color ?? undefined }}
      >
        {initials || "?"}
      </span>
    );
  }
  return (
    <span aria-hidden className={`relative inline-block shrink-0 ${className}`} style={box}>
      <Image src={logoPath(cfbdId)} alt="" width={size} height={size} unoptimized className="object-contain dark:hidden" />
      <Image src={logoPath(cfbdId, true)} alt="" width={size} height={size} unoptimized className="hidden object-contain dark:block" />
    </span>
  );
}
