/**
 * UnifiedTimeline — the canonical business timeline (Calls & Comms › All
 * interactions). Reads the shared `interactions` table (RLS) and can build/refresh
 * it via the interactions-sync Edge Function. Honest states: unavailable table,
 * "not built yet" (empty), and a live list. The existing per-channel views are
 * untouched — this is an additive unified view.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Phone,
  Mail,
  MessageSquare,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  listInteractions,
  getInteractionSummary,
  syncInteractions,
  type Interaction,
  type InteractionSummary,
} from "@/lib/interactions";
import type { ApiResult } from "@/lib/types";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TypeBadge({ type }: { type: string }) {
  const isPhone = type === "phone_call";
  const isEmail = type === "email_message";
  const Icon = isPhone ? Phone : isEmail ? Mail : MessageSquare;
  const label = isPhone ? "Call" : isEmail ? "Email" : type.replace(/_/g, " ");
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function DirectionBadge({ direction }: { direction: string | null }) {
  if (!direction || direction === "unknown") return null;
  const out = direction === "outbound";
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
        out
          ? "border-accent/20 bg-accent/10 text-accent"
          : "border-success/20 bg-success/10 text-success",
      )}
    >
      {direction}
    </span>
  );
}

function counterparty(i: Interaction): string {
  if (i.interaction_type === "phone_call") {
    return (i.direction === "outbound" ? i.phone_to : i.phone_from) ?? "Unknown";
  }
  if (i.direction === "outbound") return i.to_addresses[0] ?? "—";
  return i.from_name || i.from_address || "—";
}

export function UnifiedTimeline() {
  const [feed, setFeed] = useState<ApiResult<Interaction[]> | null>(null);
  const [summary, setSummary] = useState<ApiResult<InteractionSummary> | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, s] = await Promise.all([listInteractions({ limit: 200 }), getInteractionSummary()]);
    setFeed(f);
    setSummary(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function build() {
    setBuilding(true);
    setBuildError(null);
    const res = await syncInteractions("all");
    setBuilding(false);
    if (!res.ok) {
      setBuildError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    await load();
  }

  const items = feed && feed.ok ? feed.data : [];
  const unavailable = feed && !feed.ok;
  const summ = summary && summary.ok ? summary.data : null;
  const neverBuilt = feed?.ok && items.length === 0 && summ?.latest_interaction_at == null;

  return (
    <div className="space-y-4">
      {/* Header + summary + actions */}
      <div className="rounded-2xl border border-hairline bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Business Timeline
            </div>
            <div className="text-display text-lg font-semibold">Every interaction, unified.</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={build}
              disabled={building}
              className="inline-flex items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles className={cn("h-3.5 w-3.5", building && "animate-pulse")} />
              {building ? "Building…" : "Build / refresh"}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-alt hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {summ && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              Today: <span className="font-medium text-foreground">{summ.total_today}</span>
            </span>
            <span>Calls: {summ.phone_today}</span>
            <span>Emails: {summ.email_today}</span>
            <span>Pending: {summ.pending_processing}</span>
            <span>Latest: {fmtDateTime(summ.latest_interaction_at)}</span>
          </div>
        )}
        {buildError && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {buildError}
          </div>
        )}
      </div>

      {/* States */}
      {loading && !feed && (
        <div className="flex items-center justify-center rounded-2xl border border-hairline bg-white py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading timeline…
        </div>
      )}

      {unavailable && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Timeline unavailable
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {feed && !feed.ok ? `${feed.error.code}: ${feed.error.message}` : ""}
          </div>
        </div>
      )}

      {neverBuilt && (
        <div className="rounded-2xl border border-dashed border-hairline bg-white py-16 text-center">
          <div className="text-sm font-medium text-foreground">Timeline not built yet</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Build the unified timeline from your existing calls and emails. This is non-destructive
            — your source data is never changed.
          </p>
          <button
            onClick={build}
            disabled={building}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-foreground bg-foreground px-4 py-2 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles className={cn("h-3.5 w-3.5", building && "animate-pulse")} />
            {building ? "Building…" : "Build timeline from existing calls and emails"}
          </button>
        </div>
      )}

      {feed?.ok && items.length > 0 && (
        <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-white">
          {items.map((i) => (
            <div key={i.id} className="flex items-start gap-3 p-3">
              <span className="shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground">
                {fmtDateTime(i.occurred_at)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <TypeBadge type={i.interaction_type} />
                  <DirectionBadge direction={i.direction} />
                  <span className="truncate text-sm font-medium text-foreground">
                    {counterparty(i)}
                  </span>
                </div>
                {(i.subject || i.summary || i.body_preview) && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {i.subject ? <span className="text-foreground">{i.subject} · </span> : null}
                    {i.summary ?? i.body_preview}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {i.source_connector_id}
                </span>
                <span
                  className={cn(
                    "text-[10px] capitalize",
                    i.processing_status === "analysed" ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {i.processing_status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
