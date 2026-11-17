import type { ComponentProps, ReactNode } from "react";

/** Page title in the display serif with an optional one-line dek. */
export function PageHeader({ title, dek, children }: { title: ReactNode; dek?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
      {dek && <p className="mt-2 max-w-2xl text-[15px] text-muted">{dek}</p>}
      {children}
    </header>
  );
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-xl border border-line bg-surface ${className}`} {...props} />;
}

const BUTTON = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  quiet: "border border-line bg-surface hover:border-muted",
} as const;

export function Button({ variant = "quiet", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

export function Select({ label, className = "", children, ...props }: ComponentProps<"select"> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <select
        className={`rounded-lg border border-line bg-surface px-2.5 py-1.5 font-medium tabular-nums hover:border-muted ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

/** An on/off switch with a visible label. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  title,
  disabled,
}: {
  disabled?: boolean;
  checked: boolean;
  onChange: (on: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  title?: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm" title={title}>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={`relative h-5 w-9 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-disabled:opacity-40 ${checked ? "bg-accent" : "bg-line"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span className="font-medium">{label}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
