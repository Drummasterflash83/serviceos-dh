/**
 * Customer Health — Chris-only SHADOW review surface.
 *
 * Observes, explains and supports a fast human decision. It is deliberately NOT an
 * operational work surface: no "Do next", no staff notifications, no automation
 * controls, no live assignment, no claim that a customer was contacted, and no raw
 * tenant-wide communication content. Every proposal is a PRE-WORK shadow proposal,
 * never live staff work (that is Track B). Data-source-agnostic: fed live surface
 * data (authenticated) or fixtures (demo), with actions gated by `writeCapable`.
 */
import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  History,
  PhoneCall,
  ShieldQuestion,
  Undo2,
  UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ReviewDecision,
  ReviewPayload,
  ShadowObject,
  ShadowProposal,
  ShadowSurface,
} from "@/lib/health-shadow";

const STATE_META: Record<string, { label: string; cls: string; dot: string }> = {
  healthy: { label: "Healthy", cls: "text-success", dot: "bg-success" },
  watch: { label: "Watch", cls: "text-amber-600", dot: "bg-amber-500" },
  at_risk: { label: "At risk", cls: "text-orange-600", dot: "bg-orange-500" },
  critical: { label: "Critical", cls: "text-destructive", dot: "bg-destructive" },
  recovering: { label: "Recovering", cls: "text-accent", dot: "bg-accent" },
  unknown: { label: "Unknown", cls: "text-muted-foreground", dot: "bg-muted-foreground/50" },
};
const TREND_GLYPH: Record<string, string> = {
  improving: "↑ improving",
  worsening: "↓ worsening",
  stable: "→ stable",
  unknown: "· no trend",
};

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Panel({
  title,
  icon,
  children,
  count,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  count?: number | null;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-white p-4 sm:p-5">
      <header className="mb-3 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold text-display">{title}</h2>
        {count != null && (
          <span className="ml-auto rounded-full bg-surface-alt px-2 py-0.5 text-[11px] tabular text-muted-foreground">
            {count}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function StatePill({ state, label }: { state: string; label?: string }) {
  const m = STATE_META[state] ?? STATE_META.unknown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-alt px-2.5 py-1 text-xs font-medium",
        m.cls,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", m.dot)} /> {label ?? m.label}
    </span>
  );
}

const DRIVER_LABEL: Record<string, string> = {
  no_open_callback: "No callback owed",
  explicit_callback_open: "Explicit callback open",
  callback_due_soon: "Callback due soon",
  callback_overdue: "Callback overdue",
  repeated_contact_same_obligation: "Repeated contact — same obligation",
  resolution_evidence_possible: "Possible resolution (unverified)",
  resolution_evidence_verified: "Verified resolution",
  evidence_stale: "Evidence stale",
  uncertainty: "Ambiguous evidence",
};

// Track A working set ONLY: every action here is complete without extra input. The
// correction verbs (correct outcome / owner / due) and attach stay server-side (the
// review API supports them, payload-validated) but are NOT exposed until a proper
// input experience exists — a payload-less correction is a meaningless correction.
const ACTIONS: { key: ReviewDecision; label: string; tone?: "primary" | "danger" }[] = [
  { key: "confirm", label: "Confirm", tone: "primary" },
  { key: "reject", label: "Reject", tone: "danger" },
  { key: "needs_context", label: "Needs context" },
  { key: "defer", label: "Defer" },
  { key: "confirm_resolution", label: "Confirm resolution" },
];

function ProposalCard({
  proposal,
  terminology,
  writeCapable,
  busy,
  onReview,
}: {
  proposal: ShadowProposal;
  terminology: Record<string, string>;
  writeCapable: boolean;
  busy: boolean;
  onReview: (p: ReviewPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const own = proposal.proposed_accountable_ref;
  const resolution = proposal.resolution_state;
  const resolutionSources = proposal.sources.filter((s) => s.role.startsWith("resolution"));
  const terminal = ["rejected", "resolved_shadow", "superseded"].includes(proposal.state);
  // decisions are ordered newest-first by the surface loader.
  const latestDecision = proposal.decisions[0]?.decision ?? null;
  // Undo is offered only where the server will accept it: there is a decision to
  // undo, and it is not a resolution confirmation (which is deliberately not
  // undoable — a governed correction/reopen is the truthful path, Track B).
  const undoable =
    writeCapable && latestDecision != null && latestDecision !== "confirm_resolution";
  // Terminal proposals show no state-changing actions; already-verified proposals
  // don't re-offer "Confirm resolution".
  const visibleActions = terminal
    ? []
    : ACTIONS.filter((a) => a.key !== "confirm_resolution" || resolution !== "verified");

  return (
    <div className="rounded-lg border border-hairline bg-surface-alt/40 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-3.5 w-3.5 text-accent" />
            <span className="truncate text-sm font-semibold text-display">
              {proposal.proposed_title ?? "Call the customer back"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{proposal.proposed_outcome}</p>
        </div>
        <span className="rounded-full border border-hairline bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {proposal.state}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Proposed owner</dt>
          <dd className="font-medium text-display">
            {own?.label ?? own?.responsibility ?? "Needs context"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Due (proposed)</dt>
          <dd className="font-medium text-display tabular">{when(proposal.proposed_due_at)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Confidence</dt>
          <dd className="font-medium text-display tabular">{pct(proposal.confidence)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Ambiguity</dt>
          <dd className="font-medium text-display tabular">{pct(proposal.ambiguity)}</dd>
        </div>
      </dl>

      {own?.explanation && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs text-muted-foreground">
          <UserCog className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {own.explanation}
        </p>
      )}

      {resolution !== "none" && (
        <div
          className={cn(
            "mt-2 flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs",
            resolution === "verified"
              ? "bg-accent/10 text-accent"
              : "bg-amber-500/10 text-amber-700",
          )}
        >
          {resolution === "verified" ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            {resolution === "verified"
              ? "Resolution verified (shadow)."
              : "Possible resolution evidence — not yet verified."}
            {resolutionSources.length > 0 &&
              ` (${resolutionSources.length} signal${resolutionSources.length > 1 ? "s" : ""})`}
          </span>
        </div>
      )}

      {/* Evidence — bounded, redacted excerpts only. */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-display"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />{" "}
        {proposal.sources.length} evidence source{proposal.sources.length === 1 ? "" : "s"} ·{" "}
        {proposal.decisions.length} decision{proposal.decisions.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {proposal.sources.map((s) => (
            <div key={s.id} className="rounded-md bg-white px-2.5 py-1.5 text-[11px]">
              <span className="font-medium text-display">{s.source_kind}</span>
              <span className="text-muted-foreground"> · {s.role}</span>
              {s.excerpt && <p className="mt-0.5 italic text-muted-foreground">“{s.excerpt}”</p>}
            </div>
          ))}
          {proposal.decisions.length > 0 && (
            <div className="rounded-md bg-white px-2.5 py-1.5 text-[11px]">
              <div className="mb-1 flex items-center gap-1 font-medium text-display">
                <History className="h-3 w-3" /> Review history
              </div>
              {proposal.decisions.map((d) => (
                <div key={d.id} className="flex items-center justify-between text-muted-foreground">
                  <span>
                    {d.decision}
                    {d.from_state && d.to_state ? ` · ${d.from_state}→${d.to_state}` : ""} —{" "}
                    {d.actor}
                  </span>
                  <span className="tabular">{when(d.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chris-only actions. Shadow decisions — NOT operational transitions. Buttons
          disable while a review is in flight (double-submit guard); the server is
          additionally idempotent for repeated resolution confirmation. */}
      {writeCapable && (visibleActions.length > 0 || undoable) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleActions.map((a) => (
            <button
              key={a.key}
              disabled={busy}
              onClick={() => onReview({ proposal_id: proposal.id, decision: a.key })}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                a.tone === "primary"
                  ? "border-accent bg-accent text-white hover:bg-accent/90"
                  : a.tone === "danger"
                    ? "border-destructive/30 text-destructive hover:bg-destructive/5"
                    : "border-hairline text-muted-foreground hover:bg-white",
              )}
            >
              {a.label}
            </button>
          ))}
          {undoable && (
            <button
              disabled={busy}
              onClick={() => onReview({ proposal_id: proposal.id, decision: "undo" })}
              className="ml-auto flex items-center gap-1 rounded-md border border-hairline px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Undo2 className="h-3 w-3" /> Undo last
            </button>
          )}
        </div>
      )}
      {!writeCapable && (
        <p className="mt-3 text-[11px] italic text-muted-foreground">
          Preview — review actions disabled in demo.
        </p>
      )}
      {terminal && <span className="sr-only">{terminology[proposal.state] ?? proposal.state}</span>}
    </div>
  );
}

function SubjectCard({
  obj,
  terminology,
  writeCapable,
  busy,
  onReview,
}: {
  obj: ShadowObject;
  terminology: Record<string, string>;
  writeCapable: boolean;
  busy: boolean;
  onReview: (p: ReviewPayload) => void;
}) {
  const a = obj.latestAssessment;
  const stateLabel = a
    ? (terminology[a.state] ?? STATE_META[a.state]?.label ?? a.state)
    : "Unknown";
  return (
    <div className="rounded-xl border border-hairline bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <StatePill state={a?.state ?? "unknown"} label={stateLabel} />
            {a?.trend && (
              <span className="text-xs text-muted-foreground">
                {TREND_GLYPH[a.trend] ?? a.trend}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-display">{obj.subject_type}</span> ·{" "}
            {obj.subject_id.slice(0, 8)} · confidence {pct(a?.confidence)} · {a?.freshness ?? "—"}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground tabular">
          assessed {when(a?.evaluated_at)}
        </span>
      </div>

      {/* Why this state exists. */}
      {a && a.drivers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.drivers.map((d, i) => (
            <span
              key={i}
              title={d.detail}
              className="rounded-md border border-hairline bg-surface-alt px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {DRIVER_LABEL[d.code] ?? d.code}
            </span>
          ))}
        </div>
      )}
      {a && a.risks.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-orange-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a.risks.join(" · ")}
        </p>
      )}

      {/* Proposals for this subject. */}
      <div className="mt-3 space-y-2.5">
        {obj.proposals.length === 0 && (
          <p className="text-xs italic text-muted-foreground">
            No commitment proposal — recorded for context only.
          </p>
        )}
        {obj.proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            terminology={terminology}
            writeCapable={writeCapable}
            busy={busy}
            onReview={onReview}
          />
        ))}
      </div>

      {/* Assessment history. */}
      {obj.assessmentHistory.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
            Assessment history ({obj.assessmentHistory.length})
          </summary>
          <div className="mt-1.5 space-y-1">
            {obj.assessmentHistory.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between text-[11px] text-muted-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", STATE_META[h.state]?.dot)} />{" "}
                  {STATE_META[h.state]?.label ?? h.state}
                </span>
                <span className="tabular">{when(h.evaluated_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function CustomerHealthShadowConsole({
  surface,
  terminology = {},
  writeCapable = false,
  onReview = () => {},
  banner,
}: {
  surface: ShadowSurface;
  terminology?: Record<string, string>;
  writeCapable?: boolean;
  onReview?: (p: ReviewPayload) => void | Promise<void>;
  banner?: ReactNode;
}) {
  const objects = surface.objects ?? [];
  const openProposals = objects
    .flatMap((o) => o.proposals)
    .filter((p) => p.state === "proposed").length;
  // Double-submit guard: one review in flight at a time; buttons disable meanwhile.
  const [busy, setBusy] = useState(false);
  const review = async (p: ReviewPayload) => {
    if (busy) return;
    setBusy(true);
    try {
      await onReview(p);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {banner}
      <Panel
        title="Customer Health — callback shadow"
        icon={<Activity className="h-4 w-4" />}
        count={objects.length}
      >
        <p className="text-xs text-muted-foreground">
          Shadow-only. Recognises an explicit callback request as a Customer Health risk, proposes
          the likely responsibility, and lets you confirm, correct or reject —{" "}
          <span className="font-medium text-display">without</span> creating live staff work,
          notifications or automation. {openProposals} open proposal{openProposals === 1 ? "" : "s"}{" "}
          awaiting review.
        </p>
      </Panel>

      {objects.length === 0 ? (
        <Panel title="Nothing to review" icon={<ShieldQuestion className="h-4 w-4" />}>
          <p className="text-xs text-muted-foreground">
            No Customer Health subjects yet. Candidates appear here once shadow processing runs
            against a published tenant policy.
          </p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {objects.map((o) => (
            <SubjectCard
              key={o.id}
              obj={o}
              terminology={terminology}
              writeCapable={writeCapable}
              busy={busy}
              onReview={review}
            />
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" /> Shadow proposals are pre-work. Materialising them into live
        staff work is Track B, and remains mandatory before any proposal becomes visible as ordinary
        work.
      </p>
    </div>
  );
}
