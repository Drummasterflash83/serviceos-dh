/** Retained call intelligence with explicit source limitations and review state. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Check,
  Phone,
  User,
  UserX,
  Sparkles,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getCallDetail,
  markCallReviewed,
  clearCallReview,
  type CallDetail as CallDetailData,
  type ResolvedParty,
} from "@/lib/call-detail";

const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

/** Wrap every occurrence of each phrase in <mark>. Case-insensitive, non-overlapping. */
function Highlighted({
  text,
  phrases,
  tone,
}: {
  text: string;
  phrases: string[];
  tone: "from" | "to";
}) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  const active = phrases.filter(Boolean);
  if (!active.length) return <>{text}</>;
  const re = new RegExp(
    `(${active.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        active.some((p) => p.toLowerCase() === part.toLowerCase()) ? (
          <mark
            key={i}
            className={cn(
              "rounded px-0.5",
              tone === "from"
                ? "bg-destructive/15 text-destructive"
                : "bg-success/20 text-success-foreground",
            )}
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function PartyRow({
  label,
  party,
  kind,
}: {
  label: string;
  party: ResolvedParty | null;
  kind: "internal" | "external";
}) {
  const resolved = !!party?.entity_id || (!!party?.name && !party?.unresolved);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-hairline bg-surface-alt/40 p-2.5">
      {resolved ? (
        <User className="mt-0.5 h-4 w-4 text-success" />
      ) : (
        <UserX className="mt-0.5 h-4 w-4 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        {resolved ? (
          <div className="text-sm font-medium">
            {party?.name}
            {party?.role ? <span className="text-muted-foreground"> · {party.role}</span> : null}
            {party?.confidence != null ? (
              <span className="text-muted-foreground"> · {pct(party.confidence)}</span>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {kind === "internal"
              ? "Unknown team member (no confirmed extension mapping)"
              : party?.number
                ? `Unresolved caller · ${party.number}`
                : "Unresolved caller"}
          </div>
        )}
      </div>
    </div>
  );
}

export function CallDetail(props: { callId: string; onBack: () => void }) {
  // A new call has a fresh state immediately, before effects run.
  return <CallDetailView key={props.callId} {...props} />;
}

function CallDetailView({ callId, onBack }: { callId: string; onBack: () => void }) {
  const [data, setData] = useState<CallDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"normalised" | "raw">("raw");
  const [busy, setBusy] = useState(false);

  const [reviewError, setReviewError] = useState<string | null>(null);
  const generation = useRef(0);
  const working = useRef(false);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    setData(null);
    setError(null);
    try {
      const r = await getCallDetail(callId);
      if (ticket !== generation.current) return;
      if (r.ok) setData(r.data);
      else setError(r.error.message);
    } catch {
      if (ticket === generation.current) setError("Call details could not be checked. Try again.");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [callId]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  async function toggleReviewed() {
    if (!data || working.current) return;
    const ticket = generation.current;
    working.current = true;
    setBusy(true);
    setReviewError(null);
    try {
      const result = data.review ? await clearCallReview(callId) : await markCallReviewed(callId);
      if (ticket !== generation.current) return;
      if (result.ok)
        setData((current) => (current ? { ...current, review: result.data.review } : null));
      else
        setReviewError("Your review change could not be confirmed. Refresh before trying again.");
    } catch {
      if (ticket === generation.current)
        setReviewError("Your review change could not be confirmed. Refresh before trying again.");
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }

  const ins = data?.insight;
  const corr = data?.transcript.corrections ?? [];
  const froms = corr.filter((c) => c.applied).map((c) => c.from);
  const tos = corr.filter((c) => c.applied).map((c) => c.to);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Communications
        </button>
        {data && (
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Phone className="h-3.5 w-3.5" />
            <span className="capitalize">{data.call.direction}</span> ·{" "}
            {when(data.call.occurred_at)}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading call…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      ) : !data ? null : (
        <>
          <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm" role="status">
            Saved analysis — its match to the current recording has not been verified here. Summary,
            participants and corrections may be out of date. Check the source before acting.
            {ins?.updated_at ? ` Analysis saved ${when(ins.updated_at)}.` : ""}
          </p>
          {/* Summary + structured intelligence */}
          <div className="rounded-2xl border border-hairline bg-white p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <div className="text-sm font-semibold">Summary</div>
              {ins?.confidence != null && (
                <span className="ml-auto rounded-full bg-surface-alt px-2 py-0.5 text-[10px] text-muted-foreground">
                  confidence {pct(ins.confidence)}
                </span>
              )}
            </div>
            {ins?.summary ? (
              <p className="mt-2 text-sm">{ins.summary}</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No saved summary is available here. This does not confirm that processing is
                running.
              </p>
            )}
            {ins && (
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                {ins.intent && (
                  <Tag label="Purpose" value={String(ins.intent).replace(/_/g, " ")} />
                )}
                {ins.urgency && <Tag label="Urgency" value={ins.urgency} />}
                {ins.action_required != null && (
                  <Tag label="Action" value={ins.action_required ? "required" : "none"} />
                )}
                {ins.suggested_owner && <Tag label="Suggested owner" value={ins.suggested_owner} />}
                {ins.sentiment && <Tag label="Sentiment" value={ins.sentiment} />}
              </div>
            )}
          </div>

          {/* Participants — honest unknown/conflict */}
          <div className="rounded-2xl border border-hairline bg-white p-5">
            <div className="text-sm font-semibold">Participants suggested by saved analysis</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <PartyRow
                label="Internal (our side)"
                party={data.identity.internal}
                kind="internal"
              />
              <PartyRow
                label="External (the caller)"
                party={data.identity.external}
                kind="external"
              />
            </div>
            {(data.identity.has_conflict || (data.identity.unresolved?.length ?? 0) > 0) && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/20 bg-warning/5 p-2 text-[11px] text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {data.identity.has_conflict
                    ? "Identity conflict — metadata and the spoken introduction disagree. "
                    : ""}
                  {(data.identity.unresolved?.length ?? 0) > 0
                    ? `Unresolved: ${data.identity.unresolved.join(", ").replace(/_/g, " ")}. Nothing is asserted that the evidence doesn't support.`
                    : ""}
                </span>
              </div>
            )}
          </div>

          {/* Correction evidence */}
          {corr.length > 0 && (
            <div className="rounded-2xl border border-hairline bg-white p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-success" />
                <div className="text-sm font-semibold">Transcript corrections</div>
              </div>
              <div className="mt-3 space-y-2">
                {corr.map((c, i) => (
                  <div key={i} className="rounded-xl border border-hairline bg-surface-alt/40 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive line-through">
                        {c.from}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="rounded bg-success/20 px-1.5 py-0.5 font-medium">
                        {c.to}
                      </span>
                      <span
                        className={cn(
                          "ml-auto rounded-full px-2 py-0.5 text-[10px]",
                          c.applied ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
                        )}
                      >
                        {c.applied ? "applied" : "suggested"} · {pct(c.confidence)}
                      </span>
                    </div>
                    <ul className="mt-1 list-disc pl-4 text-[10px] text-muted-foreground">
                      {(c.evidence ?? []).map((e, j) => (
                        <li key={j}>{e.replace(/_/g, " ")}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transcript with raw/normalised toggle */}
          <div className="rounded-2xl border border-hairline bg-white p-5">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm font-semibold">Transcript</div>
              <div className="ml-auto flex rounded-full border border-hairline p-0.5">
                {(["normalised", "raw"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    disabled={v === "normalised" && !data.transcript.normalised}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-medium capitalize",
                      view === v ? "bg-accent text-white" : "text-muted-foreground",
                    )}
                  >
                    {v === "raw" ? "Saved raw" : "Saved corrected"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {view === "raw"
                ? "Saved raw text linked to this analysis. Applied correction phrases are highlighted; recording freshness is unverified."
                : "Saved corrections linked to the same transcript. Highlighting marks matching phrases, not verified error locations."}
            </p>
            {!data.transcript.raw && (
              <p className="mt-2 text-sm text-muted-foreground">
                No source transcript is linked to this saved analysis. Check the saved recording and
                results in LEARN.
              </p>
            )}
            <div className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-hairline bg-surface-alt/30 p-3 text-[13px] leading-relaxed">
              {view === "raw" ? (
                <Highlighted text={data.transcript.raw ?? ""} phrases={froms} tone="from" />
              ) : (
                <Highlighted text={data.transcript.normalised ?? ""} phrases={tos} tone="to" />
              )}
            </div>
          </div>

          {reviewError && (
            <p role="alert" className="text-sm text-destructive">
              {reviewError}
            </p>
          )}
          {/* Persistent action */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-white p-4">
            <button
              onClick={toggleReviewed}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50",
                data.review
                  ? "border border-success/30 text-success"
                  : "bg-accent text-white hover:bg-accent/90",
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {data.review ? "Reviewed — click to un-review" : "Mark reviewed"}
            </button>
            {data.review && (
              <span className="text-xs text-muted-foreground">
                Reviewed {when(data.review.reviewed_at)} · call-level review
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Review records that someone checked this call; it does not verify recording freshness or
            approve later analysis.
          </p>
        </>
      )}
    </div>
  );
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-alt/40 px-2 py-1">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium capitalize">{value}</span>
    </span>
  );
}
