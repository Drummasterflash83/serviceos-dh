/**
 * OpenFolk Control Plane — shared shell/Command-Centre primitives.
 *
 * Small, reusable building blocks so the shell and Command Centre share one visual language
 * (aligned with ServiceOS: neutral surfaces, semantic status, subtle elevation, strong
 * hierarchy) instead of one-off styling per page. Status is never colour-only — every pill
 * pairs colour with a label (accessibility).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "attention" | "risk" | "neutral" | "info";

const TONE_PILL: Record<Tone, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  attention: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  risk: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-hairline bg-surface-alt text-muted-foreground",
  info: "border-accent/30 bg-accent/10 text-accent",
};
const TONE_NUM: Record<Tone, string> = {
  ok: "text-success",
  attention: "text-amber-600",
  risk: "text-destructive",
  neutral: "text-display",
  info: "text-accent",
};

/** Status pill — colour + always a text label (never colour alone). */
export function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONE_PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A high-signal metric card for the "needs attention" row. Whole card is a link when onGo set. */
export function SignalCard({
  label,
  count,
  meaning,
  tone = "neutral",
  onGo,
}: {
  label: string;
  count: number | string;
  meaning?: string;
  tone?: Tone;
  onGo?: () => void;
}) {
  const active = count !== 0 && count !== "0";
  return (
    <button
      type="button"
      onClick={onGo}
      disabled={!onGo}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-xl border border-hairline bg-white p-3 text-left transition-colors",
        onGo && "hover:border-accent/50 hover:shadow-sm",
      )}
    >
      <span
        className={cn("text-2xl font-semibold tabular", active ? TONE_NUM[tone] : "text-display")}
      >
        {count}
      </span>
      <span className="text-xs font-medium text-display">{label}</span>
      {meaning && (
        <span className="text-[11px] leading-tight text-muted-foreground">{meaning}</span>
      )}
    </button>
  );
}

/** A "Do next" recommended-intervention row. */
export function ActionItem({
  title,
  reason,
  area,
  cta,
  tone = "info",
  onGo,
}: {
  title: string;
  reason: string;
  area?: string;
  cta: string;
  tone?: Tone;
  onGo?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-white p-3">
      <span
        className={cn(
          "mt-0.5 h-2 w-2 shrink-0 rounded-full",
          {
            ok: "bg-success",
            attention: "bg-amber-500",
            risk: "bg-destructive",
            neutral: "bg-muted-foreground/40",
            info: "bg-accent",
          }[tone],
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-display">{title}</div>
        <div className="text-xs text-muted-foreground">
          {reason}
          {area && <span className="text-muted-foreground/60"> · {area}</span>}
        </div>
      </div>
      {onGo && (
        <button
          type="button"
          onClick={onGo}
          className="shrink-0 rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90"
        >
          {cta}
        </button>
      )}
    </div>
  );
}

/** A titled content card. */
export function SectionCard({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-white p-4 sm:p-5">
      <header className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-display">{title}</h3>
        {right && <span className="ml-auto text-[11px] text-muted-foreground">{right}</span>}
      </header>
      {children}
    </section>
  );
}

/** Healthy / guiding empty state — a line + an optional primary action, never a dead end. */
export function EmptyState({
  children,
  cta,
  onGo,
  tone = "ok",
}: {
  children: ReactNode;
  cta?: string;
  onGo?: () => void;
  tone?: Tone;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-hairline bg-surface-alt/40 px-3 py-2.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "ok" ? "bg-success" : "bg-muted-foreground/40",
        )}
      />
      <span>{children}</span>
      {cta && onGo && (
        <button
          type="button"
          onClick={onGo}
          className="ml-auto rounded-md border border-hairline bg-white px-2 py-0.5 text-[11px] font-medium text-display hover:border-accent/50"
        >
          {cta}
        </button>
      )}
    </div>
  );
}

/** One rung of the tenant-readiness ladder. */
export function ReadinessStage({
  label,
  status,
  blockers,
  detail,
  onGo,
  last,
}: {
  label: string;
  status: "done" | "active" | "blocked" | "todo";
  blockers?: number;
  detail?: string;
  onGo?: () => void;
  last?: boolean;
}) {
  const dot = {
    done: "border-success bg-success text-white",
    active: "border-accent bg-accent/10 text-accent",
    blocked: "border-amber-500 bg-amber-500/10 text-amber-700",
    todo: "border-hairline bg-white text-muted-foreground/50",
  }[status];
  return (
    <button
      type="button"
      onClick={onGo}
      disabled={!onGo}
      className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
      title={detail}
    >
      <div className="flex w-full items-center">
        <span className="h-px flex-1 bg-hairline" />
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
            dot,
          )}
        >
          {status === "done" ? "✓" : status === "blocked" ? "!" : ""}
        </span>
        <span className={cn("h-px flex-1", last ? "bg-transparent" : "bg-hairline")} />
      </div>
      <span className="truncate text-[11px] font-medium text-display">{label}</span>
      {blockers ? (
        <span className="text-[10px] text-amber-700">
          {blockers} blocker{blockers > 1 ? "s" : ""}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/60">
          {status === "done" ? "ready" : status === "active" ? "in progress" : ""}
        </span>
      )}
    </button>
  );
}

/** One recent-activity row (deduped from audit). */
export function ActivityItem({
  title,
  meta,
  tone = "neutral",
}: {
  title: string;
  meta: string;
  tone?: Tone;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 text-xs">
      <span
        className={cn(
          "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
          {
            ok: "bg-success",
            attention: "bg-amber-500",
            risk: "bg-destructive",
            neutral: "bg-muted-foreground/40",
            info: "bg-accent",
          }[tone],
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="text-display">{title}</span>
        <span className="ml-1 text-muted-foreground/70">{meta}</span>
      </div>
    </div>
  );
}
