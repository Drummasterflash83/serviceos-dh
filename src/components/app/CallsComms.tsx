import { useCallback, useEffect, useState } from "react";
import {
  PhoneIncoming,
  PhoneOutgoing,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Sparkles,
  FileText,
  Brain,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { getPhoneFeed, getPhoneCallDetail } from "@/lib/phone-feed";
import { UnifiedTimeline } from "./UnifiedTimeline";
import type { ApiResult, PhoneCallDetail, PhoneFeedInput, PhoneFeedItem } from "@/lib/types";

type Tab = "calls" | "timeline";

/* ── formatting helpers ── */
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

type Range = "today" | "7d" | "30d";
type Bucket = "Today" | "Yesterday" | "Earlier";

function rangeFrom(range: Range): string {
  const now = new Date();
  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function bucketOf(iso: string | null): Bucket {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startToday.getDate() - 1);
  if (d >= startToday) return "Today";
  if (d >= startYesterday) return "Yesterday";
  return "Earlier";
}

function urgencyTone(u: string | null): string {
  switch (u) {
    case "emergency":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    case "high":
      return "border-warning/20 bg-warning/10 text-warning";
    case "medium":
      return "border-accent/20 bg-accent/10 text-accent";
    default:
      return "border-hairline bg-surface-alt text-muted-foreground";
  }
}

function DirectionBadge({ direction }: { direction: string | null }) {
  const out = direction === "OUT";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        out
          ? "border-accent/20 bg-accent/10 text-accent"
          : "border-success/20 bg-success/10 text-success",
      )}
    >
      {out ? <PhoneOutgoing className="h-3 w-3" /> : <PhoneIncoming className="h-3 w-3" />}
      {out ? "OUT" : "IN"}
    </span>
  );
}

function counterparty(item: PhoneFeedItem): string {
  const n = item.direction === "OUT" ? item.to_number : item.from_number;
  return n ?? "Unknown";
}

const BUCKET_ORDER: Bucket[] = ["Today", "Yesterday", "Earlier"];

export function CallsCommsView() {
  const [tab, setTab] = useState<Tab>("calls");
  const [range, setRange] = useState<Range>("today");
  const [inboundOnly, setInboundOnly] = useState(false);
  const [actionOnly, setActionOnly] = useState(false);

  const [feed, setFeed] = useState<ApiResult<PhoneFeedItem[]> | null>(null);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<PhoneFeedItem | null>(null);
  const [detail, setDetail] = useState<ApiResult<PhoneCallDetail> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const input: PhoneFeedInput = {
      from: rangeFrom(range),
      limit: 200,
      direction: inboundOnly ? "IN" : "ALL",
      actionRequiredOnly: actionOnly,
    };
    setFeed(await getPhoneFeed(input));
    setLoading(false);
  }, [range, inboundOnly, actionOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(item: PhoneFeedItem) {
    setSelected(item);
    setDetail(null);
    if (!item.recording_id) return;
    setDetailLoading(true);
    setDetail(await getPhoneCallDetail(item.recording_id));
    setDetailLoading(false);
  }

  const items = feed && feed.ok ? feed.data : [];
  const grouped: Record<Bucket, PhoneFeedItem[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const item of items) grouped[bucketOf(item.started_at)].push(item);

  return (
    <div className="space-y-4">
      {/* Tabs — additive unified view; the per-channel Calls view is unchanged. */}
      <div className="flex gap-2">
        {(["calls", "timeline"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
              tab === t
                ? "border-foreground bg-foreground text-background"
                : "border-hairline text-muted-foreground hover:bg-surface-alt hover:text-foreground",
            )}
          >
            {t === "calls" ? "Calls" : "All interactions"}
          </button>
        ))}
      </div>

      {tab === "timeline" && <UnifiedTimeline />}

      {tab === "calls" && (
        <>
          {/* Header + filters */}
          <div className="rounded-2xl border border-hairline bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Calls &amp; Comms
                </div>
                <div className="text-display text-lg font-semibold">Every call, enriched.</div>
              </div>
              <button
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-alt hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Refresh
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(["today", "7d", "30d"] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    range === r
                      ? "border-foreground bg-foreground text-background"
                      : "border-hairline text-muted-foreground hover:bg-surface-alt hover:text-foreground",
                  )}
                >
                  {r === "today" ? "Today" : r === "7d" ? "7 days" : "30 days"}
                </button>
              ))}
              <button
                disabled
                title="Custom date range — coming soon"
                className="cursor-not-allowed rounded-full border border-dashed border-hairline px-3 py-1 text-xs font-medium text-muted-foreground/60"
              >
                Custom…
              </button>

              <span className="mx-1 hidden h-4 w-px bg-hairline sm:block" />

              <button
                onClick={() => setInboundOnly((v) => !v)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  inboundOnly
                    ? "border-foreground bg-foreground text-background"
                    : "border-hairline text-muted-foreground hover:bg-surface-alt hover:text-foreground",
                )}
              >
                Inbound only
              </button>
              <button
                onClick={() => setActionOnly((v) => !v)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  actionOnly
                    ? "border-warning bg-warning/10 text-warning"
                    : "border-hairline text-muted-foreground hover:bg-surface-alt hover:text-foreground",
                )}
              >
                Action required
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            {/* Feed list */}
            <div className="space-y-4 lg:col-span-7">
              {loading && (
                <div className="flex items-center justify-center rounded-2xl border border-hairline bg-white py-16 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading calls…
                </div>
              )}

              {!loading && feed && !feed.ok && (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Couldn&apos;t load the feed
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {feed.error.code}: {feed.error.message}
                  </div>
                </div>
              )}

              {!loading && feed && feed.ok && items.length === 0 && (
                <div className="rounded-2xl border border-hairline bg-white py-16 text-center">
                  <div className="text-sm font-medium text-foreground">No calls in this range</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try a wider range or clear the filters.
                  </p>
                </div>
              )}

              {!loading &&
                feed &&
                feed.ok &&
                items.length > 0 &&
                BUCKET_ORDER.filter((b) => grouped[b].length > 0).map((bucket) => (
                  <div key={bucket}>
                    <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {bucket}
                    </div>
                    <div className="space-y-2">
                      {grouped[bucket].map((item) => (
                        <button
                          key={item.call_id}
                          onClick={() => openDetail(item)}
                          className={cn(
                            "w-full rounded-xl border p-3 text-left transition",
                            selected?.call_id === item.call_id
                              ? "border-foreground/40 bg-surface-alt"
                              : "border-hairline bg-white hover:border-foreground/20 hover:bg-surface-alt",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <DirectionBadge direction={item.direction} />
                              {item.urgency && (
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                                    urgencyTone(item.urgency),
                                  )}
                                >
                                  {item.urgency}
                                </span>
                              )}
                            </div>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {fmtTime(item.started_at)}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-medium">{counterparty(item)}</div>
                            <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              {fmtDuration(item.duration_seconds)}
                            </div>
                          </div>

                          {item.summary && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {item.summary}
                            </p>
                          )}

                          {item.action_required && (
                            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                              <AlertTriangle className="h-3 w-3" />
                              Action required
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>

            {/* Detail panel */}
            <div className="lg:col-span-5">
              <div className="lg:sticky lg:top-20">
                {!selected ? (
                  <div className="rounded-2xl border border-hairline bg-white py-16 text-center">
                    <div className="text-sm font-medium text-foreground">Select a call</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pick a call on the left to see its transcript and intelligence.
                    </p>
                  </div>
                ) : (
                  <CallDetail item={selected} detail={detail} loading={detailLoading} />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function RawRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-xs text-foreground">{value}</dd>
    </div>
  );
}

/** Mask a phone number for the default UI (never show it in full). */
function maskNumber(n: string | null): string {
  if (!n) return "—";
  const s = n.trim();
  if (s.length <= 5) return s;
  return `${s.slice(0, 3)}…${s.slice(-2)}`;
}

function ConfDot({ c }: { c: number | null }) {
  const v = c ?? 0;
  const tone = v >= 0.85 ? "bg-success" : v >= 0.5 ? "bg-warning" : "bg-muted-foreground/40";
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", tone)} />
      {c != null ? `${Math.round(v * 100)}%` : "—"}
    </span>
  );
}

function CallIntelligence({
  intel,
  rawTranscript,
}: {
  intel: import("@/lib/types").PhoneCallIntelligence;
  rawTranscript: string | null;
}) {
  const [showNormalised, setShowNormalised] = useState(true);
  const hasNormalised = !!intel.normalised_text && intel.normalised_text !== rawTranscript;
  const applied = intel.corrections.filter((c) => c.applied);
  const shown = showNormalised && hasNormalised ? intel.normalised_text : rawTranscript;

  return (
    <div className="rounded-2xl border border-hairline bg-white p-5">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-accent" />
        <div className="text-sm font-semibold">Call intelligence</div>
        {intel.direction && (
          <span className="ml-auto rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
            {intel.direction}
          </span>
        )}
      </div>

      {intel.has_conflict && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5" /> Identity conflict — metadata and the spoken
          introduction disagree.
        </div>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-y-2">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs text-muted-foreground">Internal</dt>
          <dd className="flex items-center gap-2 text-xs font-medium">
            {intel.internal_name ?? (
              <span className="text-muted-foreground">Unknown team member</span>
            )}
            {intel.internal_name && <ConfDot c={intel.internal_confidence} />}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs text-muted-foreground">External</dt>
          <dd className="flex items-center gap-2 text-xs font-medium">
            {intel.external_name ?? (
              <span className="text-muted-foreground">Unresolved caller</span>
            )}
            {intel.external_name && <ConfDot c={intel.external_confidence} />}
          </dd>
        </div>
      </dl>

      {/* Transcript with raw / normalised toggle */}
      {shown && (
        <div className="mt-4 border-t border-hairline pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium text-muted-foreground">Transcript</div>
            {hasNormalised && (
              <div className="inline-flex overflow-hidden rounded-lg border border-hairline text-[10px]">
                <button
                  onClick={() => setShowNormalised(true)}
                  className={cn(
                    "px-2 py-0.5",
                    showNormalised ? "bg-accent/10 text-accent" : "text-muted-foreground",
                  )}
                >
                  Normalised
                </button>
                <button
                  onClick={() => setShowNormalised(false)}
                  className={cn(
                    "px-2 py-0.5",
                    !showNormalised ? "bg-accent/10 text-accent" : "text-muted-foreground",
                  )}
                >
                  Raw
                </button>
              </div>
            )}
          </div>
          <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-hairline bg-surface-alt/50 p-3 text-xs leading-relaxed text-foreground">
            {shown}
          </p>
        </div>
      )}

      {/* Corrections */}
      {applied.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-3">
          <div className="text-[11px] font-medium text-muted-foreground">
            Corrections ({applied.length})
          </div>
          <ul className="mt-2 space-y-1">
            {applied.map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground line-through">{c.from}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium">{c.to}</span>
                <span className="rounded-full border border-hairline bg-surface-alt px-1.5 text-[9px] capitalize text-muted-foreground">
                  {c.category}
                </span>
                <ConfDot c={c.confidence} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CallDetail({
  item,
  detail,
  loading,
}: {
  item: PhoneFeedItem;
  detail: ApiResult<PhoneCallDetail> | null;
  loading: boolean;
}) {
  const raw = detail && detail.ok ? detail.data.raw : null;
  const transcript = detail && detail.ok ? detail.data.transcript_text : null;
  const intel = detail && detail.ok ? detail.data.intelligence : null;

  return (
    <div className="space-y-4">
      {/* Metadata */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <DirectionBadge direction={item.direction} />
          <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
            {item.processing_status.replace("_", " ")}
          </span>
        </div>
        <div className="text-display mt-3 text-lg font-semibold">{counterparty(item)}</div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          <MetaRow label="From" value={maskNumber(item.from_number)} />
          <MetaRow label="To" value={maskNumber(item.to_number)} />
          <MetaRow label="Started" value={fmtDateTime(item.started_at)} />
          <MetaRow label="Duration" value={fmtDuration(item.duration_seconds)} />
          <MetaRow label="Outcome" value={item.outcome ?? "—"} />
          <MetaRow label="Recording" value={item.recording_id ? "stored" : "none"} />
        </dl>
      </div>

      {/* Call Intelligence — resolved identity + normalised transcript */}
      {intel && <CallIntelligence intel={intel} rawTranscript={transcript} />}

      {/* AI intelligence */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <div className="text-sm font-semibold">AI intelligence</div>
        </div>
        {item.insight_id ? (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.urgency && (
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                    urgencyTone(item.urgency),
                  )}
                >
                  {item.urgency}
                </span>
              )}
              {item.sentiment && (
                <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                  {item.sentiment}
                </span>
              )}
              {item.action_required && (
                <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                  Action required
                </span>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <MetaRow label="Intent" value={item.intent ?? "—"} />
              <MetaRow label="Owner" value={item.suggested_owner ?? "—"} />
              <MetaRow
                label="Confidence"
                value={item.confidence != null ? item.confidence.toFixed(2) : "—"}
              />
              <MetaRow label="Insight" value={item.insight_id ? "yes" : "—"} />
            </dl>
            {item.summary && (
              <p className="mt-3 rounded-lg border border-hairline bg-surface-alt/50 p-3 text-xs text-foreground">
                {item.summary}
              </p>
            )}

            {/* Raw structured fields */}
            {loading && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading details…
              </div>
            )}
            {raw && (
              <dl className="mt-3 space-y-2 border-t border-hairline pt-3">
                <RawRow label="Customer" value={raw.customer_name} />
                <RawRow label="Phone" value={raw.phone_number} />
                <RawRow label="Address / postcode" value={raw.address_or_postcode} />
                <RawRow label="Appliance / system" value={raw.appliance_or_system} />
                <RawRow label="Fault / reason" value={raw.fault_or_reason} />
                <RawRow label="Promised action" value={raw.promised_action} />
                {raw.risk_flags.length > 0 && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Risk flags
                    </dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {raw.risk_flags.map((f) => (
                        <span
                          key={f}
                          className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive"
                        >
                          {f}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No AI insight for this call yet.</p>
        )}
      </div>

      {/* Transcript */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-semibold">Transcript</div>
        </div>
        {!item.recording_id ? (
          <p className="mt-2 text-xs text-muted-foreground">No recording for this call.</p>
        ) : loading ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading transcript…
          </div>
        ) : detail && !detail.ok ? (
          <div className="mt-2 font-mono text-xs text-destructive">
            {detail.error.code}: {detail.error.message}
          </div>
        ) : transcript ? (
          <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-hairline bg-surface-alt/50 p-3 text-xs leading-relaxed text-foreground">
            {transcript}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            No transcript yet — the pipeline may still be processing.
          </p>
        )}
      </div>
    </div>
  );
}
