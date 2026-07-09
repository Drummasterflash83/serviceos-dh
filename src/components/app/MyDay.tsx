/**
 * My Day — the logged-in user's personal daily command surface ("Dashboard").
 * v1 is honest: it composes REAL current-user signals (live calls assigned to me,
 * customer cards, canonical signals, suggested matches) with clear empty/
 * unavailable states. No fake data. As the enrichment/card layers populate, this
 * becomes the default daily landing surface (urgent tasks, priority cards, stuck
 * work, follow-ups, nudges, company health, satisfaction signals).
 */

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, PhoneIncoming, Sparkles } from "lucide-react";

import { MetricCard } from "@/components/ops";
import { getInteractionSummary, type InteractionSummary } from "@/lib/interactions";
import {
  getCustomerCardSummary,
  getCustomerCards,
  type CustomerCardSummary,
  type ProjectedCard,
} from "@/lib/customer-cards";
import { getMatchSummary, type MatchSummary } from "@/lib/matching";
import { listMyLiveCallSessions, type LiveCallSession } from "@/lib/live-calls";
import { cn } from "@/lib/utils";
import type { ApiResult } from "@/lib/types";

const HEALTH_RANK: Record<string, number> = { critical: 0, attention: 1, good: 2, excellent: 3 };
const HEALTH_BADGE: Record<string, string> = {
  excellent: "bg-success/10 text-success",
  good: "bg-success/10 text-success",
  attention: "bg-warning/10 text-warning",
  critical: "bg-destructive/10 text-destructive",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** A real count, or "—" when its source is unavailable (never a fake zero). */
function metric(v: number | null | undefined): string | number {
  return typeof v === "number" ? v : "—";
}

export function MyDayDashboard() {
  const [interactions, setInteractions] = useState<ApiResult<InteractionSummary> | null>(null);
  const [cardSummary, setCardSummary] = useState<ApiResult<CustomerCardSummary> | null>(null);
  const [projectedCards, setProjectedCards] = useState<ProjectedCard[]>([]);
  const [matches, setMatches] = useState<ApiResult<MatchSummary> | null>(null);
  const [liveCalls, setLiveCalls] = useState<LiveCallSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [inter, cardSum, cardList, match, live] = await Promise.all([
      getInteractionSummary(),
      getCustomerCardSummary(),
      getCustomerCards(50),
      getMatchSummary(),
      listMyLiveCallSessions(),
    ]);
    setInteractions(inter);
    setCardSummary(cardSum);
    setProjectedCards(cardList.ok ? cardList.data : []);
    setMatches(match);
    setLiveCalls(live.ok ? live.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const interData = interactions?.ok ? interactions.data : null;
  const cardsData = cardSummary?.ok ? cardSummary.data : null;
  const matchData = matches?.ok ? matches.data : null;

  // Cards needing attention first (critical → attention), highest activity within.
  const attentionCards = [...projectedCards]
    .filter((c) => c.projection)
    .sort((a, b) => {
      const ra = HEALTH_RANK[a.projection!.business.health] ?? 9;
      const rb = HEALTH_RANK[b.projection!.business.health] ?? 9;
      if (ra !== rb) return ra - rb;
      return b.projection!.business.activity_score - a.projection!.business.activity_score;
    })
    .slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">My Day</div>
          <h1 className="text-display text-2xl font-bold">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">What needs your attention next.</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-alt hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Attention KPIs — real signals only */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Critical customers"
          value={metric(cardsData?.critical)}
          tone={cardsData && cardsData.critical > 0 ? "critical" : "default"}
        />
        <MetricCard
          label="Needs attention"
          value={metric(cardsData?.attention)}
          tone={cardsData && cardsData.attention > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Live calls (you)"
          value={liveCalls.length}
          tone={liveCalls.length > 0 ? "accent" : "default"}
        />
        <MetricCard label="Signals today" value={metric(interData?.total_today)} tone="accent" />
        <MetricCard
          label="Unprocessed"
          value={metric(interData?.pending_processing)}
          tone={interData && interData.pending_processing > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Suggested matches"
          value={metric(matchData?.pending)}
          tone={matchData && matchData.pending > 0 ? "accent" : "default"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Live call follow-ups (assigned to me) */}
        <div className="rounded-2xl border border-hairline bg-white p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <PhoneIncoming className="h-4 w-4 text-muted-foreground" />
            Live call follow-ups
          </div>
          {liveCalls.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No live calls assigned to you right now.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {liveCalls.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">
                      {c.caller_number ?? "Unknown"}
                    </span>{" "}
                    <span className="text-muted-foreground">· ext {c.extension ?? "—"}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground capitalize">{c.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Customers needing attention — driven by Customer Card projections */}
        <div className="rounded-2xl border border-hairline bg-white p-6">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Customers needing attention</div>
            {cardsData && (
              <span className="text-[11px] text-muted-foreground">
                Avg activity {cardsData.avgActivityScore ?? "—"} · projected{" "}
                {fmtTime(cardsData.latestProjectedAt)}
              </span>
            )}
          </div>
          {cardSummary && !cardSummary.ok ? (
            <p className="mt-3 text-xs text-muted-foreground">Cards unavailable.</p>
          ) : cardsData && cardsData.projected === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No projected cards yet — cards build automatically after the graph, or use “Build
              cards” in the Operations Centre.
            </p>
          ) : attentionCards.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              All customers healthy — nothing needs attention right now.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {attentionCards.map((c) => {
                const p = c.projection!;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">{p.identity.display_name}</span>
                      {p.operations.open_recommendations > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {p.operations.open_recommendations} action(s)
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular text-muted-foreground">
                        {p.business.activity_score}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                          HEALTH_BADGE[p.business.health],
                        )}
                      >
                        {p.business.health}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* What lands here as your data grows (purpose, not data) */}
      <div className="rounded-2xl border border-dashed border-hairline bg-surface-alt/40 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Your daily command surface
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          As the signal, card and matching layers populate, this becomes where you start each day:
          your most urgent tasks, critical customer &amp; job cards, stuck work assigned to you,
          recent calls &amp; emails needing attention, live-call follow-ups, nudges from colleagues,
          company-health and satisfaction signals — and the items you can help unblock. Nothing here
          is fabricated; sections appear as real data arrives.
        </p>
      </div>
    </div>
  );
}
