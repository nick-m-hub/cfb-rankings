"use client";

import { useState } from "react";
import { blendLabel } from "@/lib/rankings/rank";
import { SITE_NAME } from "@/lib/site";
import { Button } from "./ui";

interface Props {
  season: number;
  week: number;
  blend: number;
  g6: boolean;
}

type State = { kind: "idle" } | { kind: "busy" } | { kind: "ready"; file: File } | { kind: "done"; message: string } | { kind: "error" };

/**
 * Phone-only. Shares the top 25 as an image (/api/share/top25) with a link to this exact view. Uses the system share sheet
 * where it can take files (phones, Safari); otherwise downloads the image. Some browsers drop the tap's
 * permission to share while the image loads; then the button turns into "Tap to share" with the image ready.
 */
export function ShareTop25({ season, week, blend, g6 }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const title = `${SITE_NAME}: ${g6 ? "G6 " : ""}Top 25, ${season} Week ${week}`;
  const text = `${title} (${blendLabel(blend)})`;

  async function share(file: File) {
    try {
      await navigator.share({ files: [file], title, text, url: window.location.href });
      setState({ kind: "idle" });
    } catch (err) {
      const name = (err as DOMException).name;
      if (name === "AbortError") setState({ kind: "idle" }); // user closed the sheet
      else if (name === "NotAllowedError") setState({ kind: "ready", file });
      else download(file);
    }
  }

  function download(file: File) {
    const href = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = href;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    setState({ kind: "done", message: "Image downloaded" });
  }

  async function onClick() {
    if (state.kind === "ready") return share(state.file);
    setState({ kind: "busy" });
    try {
      const qs = new URLSearchParams({ season: String(season), week: String(week), blend: String(blend) });
      if (g6) qs.set("g6", "1");
      const res = await fetch(`/api/share/top25?${qs}`);
      if (!res.ok) throw new Error(String(res.status));
      const file = new File([await res.blob()], `sliding-scale-${g6 ? "g6-" : ""}top25-${season}-week${week}-blend${blend}.png`, {
        type: "image/png",
      });
      if (navigator.canShare?.({ files: [file] })) await share(file);
      else download(file);
    } catch {
      setState({ kind: "error" });
    }
  }

  const label = state.kind === "busy" ? "Making image…" : state.kind === "ready" ? "Tap to share" : "Share";
  return (
    // Phones only (hidden from the sm breakpoint up): on a laptop all 25 cards fit in a plain screenshot.
    <div className="flex items-center gap-3 sm:hidden">
      {state.kind === "done" && <span className="text-xs text-muted">{state.message}</span>}
      {state.kind === "error" && <span className="text-xs text-down">Couldn&apos;t make the image. Try again.</span>}
      <Button
        variant={state.kind === "ready" ? "primary" : "quiet"}
        onClick={onClick}
        disabled={state.kind === "busy"}
        aria-label="Share the top 25 as an image"
        className="shrink-0 whitespace-nowrap"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <path d="M16 6l-4-4-4 4" />
          <path d="M12 2v13" />
        </svg>
        {label}
      </Button>
    </div>
  );
}
