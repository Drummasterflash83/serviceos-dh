/**
 * DailyBriefing — the executive "assistant briefing" that opens the Command Centre.
 * Reusable + presentational: it takes a derived Briefing (see buildBriefing) and renders
 * it as a calm, premium morning brief — signals reviewed, the few things that need a
 * decision, and what was handled automatically. No data access, no business hardcoding.
 */

import { Sparkles, Check, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Briefing, BriefingCategory } from "@/lib/command-stories";

const CATEGORY_TONE: Record<BriefingCategory, string> = {
  customer_risk: "text-destructive",
  revenue: "text-success",
  operational: "text-warning",
  attention: "text-accent",
};

export function DailyBriefing({
  briefing,
  onOpen,
}: {
  briefing: Briefing;
  onOpen?: (storyId: string) => void;
}) {
  const { greeting, reviewedCount, attention, handled, clear } = briefing;

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
      {/* Assistant header */}
      <div className="border-b border-hairline bg-surface-alt/50 p-6">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
            <Sparkles className="h-3 w-3" />
          </span>
          Daily briefing
        </div>
        <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">{greeting}.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          I reviewed <span className="font-semibold text-foreground tabular">{reviewedCount}</span>{" "}
          business signal{reviewedCount === 1 ? "" : "s"}.{" "}
          {clear ? (
            "Nothing needs your decision right now — you’re clear."
          ) : (
            <>
              <span className="font-semibold text-foreground">{attention.length}</span> thing
              {attention.length === 1 ? "" : "s"} need{attention.length === 1 ? "s" : ""} your
              attention.
            </>
          )}
        </p>
      </div>

      {/* Attention items */}
      {attention.length > 0 && (
        <div className="divide-y divide-hairline">
          {attention.map((a) => (
            <button
              key={a.storyId}
              onClick={() => onOpen?.(a.storyId)}
              className="group flex w-full items-start gap-3 p-5 text-left transition hover:bg-surface-alt/40"
            >
              <span className="mt-0.5 text-lg leading-none">{a.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-xs font-semibold", CATEGORY_TONE[a.category])}>
                    {a.label}
                  </span>
                  <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Risk: {a.risk}
                  </span>
                </div>
                <div className="text-display mt-1 text-sm font-semibold leading-snug text-foreground">
                  {a.title}
                </div>
                {a.detail && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.detail}</p>
                )}
                {a.recommendation && (
                  <p className="mt-1.5 text-xs">
                    <span className="font-medium text-muted-foreground">Recommended:</span>{" "}
                    <span className="text-foreground">{a.recommendation}</span>
                  </p>
                )}
              </div>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
            </button>
          ))}
        </div>
      )}

      {/* Handled automatically */}
      {handled.length > 0 && (
        <div className="border-t border-hairline bg-surface-alt/30 p-5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Handled automatically
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
            {handled.map((h) => (
              <span
                key={h.label}
                className="inline-flex items-center gap-1.5 text-xs text-foreground"
              >
                <Check className="h-3.5 w-3.5 text-success" />
                <span className="tabular font-medium">{h.count}</span>
                <span className="text-muted-foreground">{h.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
