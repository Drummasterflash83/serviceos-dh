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
import { getCardsSummary, type CardsSummary } from "@/lib/cards";
import { getMatchSummary, type MatchSummary } from "@/lib/matching";
import { listMyLiveCallSessions, type LiveCallSession } from "@/lib/live-calls";
import type { ApiResult } from "@/lib/types";

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
  const [cards, setCards] = useState<ApiResult<CardsSummary> | null>(null);
  const [matches, setMatches] = useState<ApiResult<MatchSummary> | null>(null);
  const [liveCalls, setLiveCalls] = useState<LiveCallSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [inter, card, match, live] = await Promise.all([
      getInteractionSummary(),
      getCardsSummary(),
      getMatchSummary(),
      listMyLiveCallSessions(),
    ]);
    setInteractions(inter);
    setCards(card);
    setMatches(match);
    setLiveCalls(live.ok ? live.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const interData = interactions?.ok ? interactions.data : null;
  const cardsData = cards?.ok ? cards.data : null;
  const matchData = matches?.ok ? matches.data : null;

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
          label="Urgent cards"
          value={metric(cardsData?.urgent)}
          tone={cardsData && cardsData.urgent > 0 ? "critical" : "default"}
        />
        <MetricCard label="Waiting" value={metric(cardsData?.waiting)} tone="warning" />
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

        {/* Priority cards — honest, populated by the future card builder */}
        <div className="rounded-2xl border border-hairline bg-white p-6">
          <div className="text-sm font-semibold">Priority cards</div>
          {cards && !cards.ok ? (
            <p className="mt-3 text-xs text-muted-foreground">Cards unavailable.</p>
          ) : cardsData && cardsData.total === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No customer cards yet — cards build automatically as signals are enriched.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>
                Total:{" "}
                <span className="font-medium text-foreground">{metric(cardsData?.total)}</span>
              </span>
              <span>Urgent: {metric(cardsData?.urgent)}</span>
              <span>Waiting: {metric(cardsData?.waiting)}</span>
              <span>Latest: {fmtTime(cardsData?.latest_activity_at ?? null)}</span>
            </div>
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
