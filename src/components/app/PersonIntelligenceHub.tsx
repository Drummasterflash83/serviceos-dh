/**
 * Person Intelligence Hub — "What do we currently know about this actor?"
 *
 * A REUSABLE, actor-agnostic evidence surface. It is deliberately NOT a Mary-specific screen:
 * it takes a canonical actor (today a `team_members` row) plus the workspace evidence and
 * organises everything into evidence — identity, connected systems, responsibilities,
 * operational activity, Health contribution, review queue — with **confidence and provenance
 * exposed on every fact** and honest empty states where a source is not yet wired.
 *
 * Designed to still make sense at 500 staff / 40 AI agents / 15 sources / 250k customers:
 *   • the actor is a canonical actor with a `kind` (team_member now; customer/engineer/
 *     supplier/ai_worker later) — nothing here assumes "employee".
 *   • connected systems are DATA (SOURCE_CATALOG), so adding Microsoft 365 / Teams / Calendar
 *     / HR / CRM / access-control later is a config entry, not a new screen.
 *   • identity links are temporal (history preserved, never overwritten); a source label is
 *     evidence, never canonical identity.
 */
import { useState, type ReactNode } from "react";
import {
  ChevronLeft,
  Phone,
  Mail,
  MessageSquare,
  Database,
  Fingerprint,
  ShieldCheck,
  Activity,
  HeartPulse,
  ListChecks,
  Eye,
  CircleHelp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard, StatusPill, EmptyState, type Tone } from "./openfolk-ui";
import type {
  CpMember,
  CpIdentity,
  CpOwnership,
  CpEndpoint,
  IdentitySuggestion,
  TelephonyCandidate,
  Workspace,
} from "@/lib/openfolk";
import type { WorkspaceActions } from "./OpenfolkWorkspace";

type Confidence = "high" | "medium" | "low" | "unresolved";

// ── Confidence + provenance are surfaced on every fact. ──────────────────────
const CONFIDENCE_TONE: Record<string, Tone> = {
  high: "ok",
  medium: "info",
  low: "attention",
  unresolved: "neutral",
  unknown: "neutral",
};
function ConfidencePill({ level }: { level: string }) {
  return <StatusPill tone={CONFIDENCE_TONE[level] ?? "neutral"}>{level} confidence</StatusPill>;
}

/** Map a raw engine provenance string to a human source of truth. */
function provenanceLabel(p: string): string {
  const s = (p || "").toLowerCase();
  if (s.includes("member_integration_identities")) return "Operator confirmed";
  if (s.includes("slack")) return "Slack (inference)";
  if (s.includes("telephony") || s.includes("extension-label")) return "Sipcentric (inference)";
  if (s.includes("workspace") || s.includes("directory-name")) return "Google (inference)";
  if (s.includes("resolver") || s.includes("identity")) return "Inference";
  if (s.includes("operator") || s.includes("review")) return "Manual review";
  return p || "—";
}
function ProvenanceTag({ provenance }: { provenance: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-hairline bg-surface-alt px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
      {provenanceLabel(provenance)}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-display">{children}</span>
    </div>
  );
}

// ── Connected-source catalogue (data, so new sources are config not code) ────
type SourceStatus =
  | "confirmed"
  | "candidate"
  | "ambiguous"
  | "deactivated"
  | "connected_no_link"
  | "not_connected"
  | "revoked"
  | "planned";
interface SourceView {
  key: string;
  label: string;
  icon: ReactNode;
  status: SourceStatus;
  confidence?: string;
  evidence?: string;
  lastSeen?: string | null;
  provenance?: string;
  conflicts?: string[];
  /** Confirm/reject controls target this endpoint (when a candidate exists). */
  endpointId?: string;
  suggestedMemberId?: string | null;
  detail?: ReactNode;
}
const STATUS_META: Record<SourceStatus, { tone: Tone; label: string }> = {
  confirmed: { tone: "ok", label: "confirmed" },
  candidate: { tone: "attention", label: "candidate — review" },
  ambiguous: { tone: "attention", label: "ambiguous — resolve" },
  deactivated: { tone: "attention", label: "candidate · deactivated" },
  connected_no_link: { tone: "info", label: "connected · no link yet" },
  not_connected: { tone: "neutral", label: "not connected" },
  revoked: { tone: "risk", label: "revoked / error" },
  planned: { tone: "neutral", label: "planned" },
};

/** Sources we will support later — shown muted so the model reads as extensible, not fixed. */
const FUTURE_SOURCES = ["Microsoft 365", "Teams", "Calendar", "HR", "CRM", "Access control"];

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function PersonIntelligenceHub({
  actor,
  actorKind = "team_member",
  workspace,
  writeCapable,
  busy,
  onReviewIdentity,
  onBack,
  onPreview,
}: {
  actor: CpMember;
  actorKind?: string;
  workspace: Workspace;
  writeCapable: boolean;
  busy: boolean;
  onReviewIdentity?: WorkspaceActions["onReviewIdentity"];
  onBack: () => void;
  onPreview?: (memberId: string) => void;
}) {
  const identities: CpIdentity[] = workspace.identities ?? [];
  const ownership: CpOwnership[] = workspace.ownership ?? [];
  const ownershipHistory: CpOwnership[] = workspace.ownershipHistory ?? [];
  const endpoints: CpEndpoint[] = workspace.endpoints ?? [];
  const emailSuggestions: IdentitySuggestion[] = workspace.identityResolution?.suggestions ?? [];
  const emailReviews = workspace.identityResolution?.reviews ?? [];
  const telCandidates: TelephonyCandidate[] =
    workspace.telephonyIdentityResolution?.candidates ?? [];

  const epLabel = (id: string) => {
    const e = endpoints.find((x) => x.id === id);
    return e ? (e.display_value ?? e.normalized_value) : id.slice(0, 8);
  };

  // ── Identity evidence for this actor ──
  const confirmed = identities.filter((i) => i.team_member_id === actor.id);
  const latestReviewByEp = new Map<string, string>();
  for (const r of emailReviews)
    if (!latestReviewByEp.has(r.endpoint_id)) latestReviewByEp.set(r.endpoint_id, r.decision);

  // Observed names = canonical + any provider labels naming this actor (evidence, not identity).
  const observedNames = new Set<string>([actor.display_name]);
  for (const c of telCandidates)
    if (c.suggested_member_id === actor.id) c.observed_labels.forEach((l) => observedNames.add(l));

  // ── Connected systems (per source) ──
  const emailForMe = emailSuggestions.filter(
    (s) => s.suggested_member_id === actor.id && s.suggested_kind === "person",
  );
  const emailConfirmed = confirmed.filter((i) => i.provider === "google_workspace");
  const telForMe = telCandidates.filter((c) => c.suggested_member_id === actor.id);
  const telConfirmed = confirmed.filter((i) => /^\d{2,6}$/.test(i.external_ref));

  const sources: SourceView[] = [];

  // Telephony
  if (telConfirmed.length) {
    const i = telConfirmed[0];
    sources.push({
      key: "telephony",
      label: "Telephony",
      icon: <Phone className="h-4 w-4 text-accent" />,
      status: "confirmed",
      confidence: "high",
      evidence: `extension ${i.external_ref} — operator confirmed`,
      provenance: "member_integration_identities",
    });
  } else if (telForMe.length) {
    const c = telForMe[0];
    sources.push({
      key: "telephony",
      label: "Telephony",
      icon: <Phone className="h-4 w-4 text-accent" />,
      status: c.confidence === "unresolved" ? "connected_no_link" : "candidate",
      confidence: c.confidence,
      evidence: `ext ${c.endpoint_extension} · ${c.observed_labels.join(", ") || "no label"} · ${c.call_count} calls`,
      lastSeen: c.last_activity,
      provenance: c.provenance,
      conflicts:
        c.ambiguity.length > 1
          ? [`labels name ${c.ambiguity.length} members over time — reassignment likely`]
          : c.unknown_label_names.length
            ? [`a label also names an unrecognised party: ${c.unknown_label_names.join(", ")}`]
            : [],
      endpointId: c.endpoint_id,
      suggestedMemberId: actor.id,
    });
  } else {
    sources.push({
      key: "telephony",
      label: "Telephony",
      icon: <Phone className="h-4 w-4 text-muted-foreground" />,
      status: "connected_no_link",
      evidence: "no extension candidate names this actor yet",
    });
  }

  // Email
  if (emailConfirmed.length) {
    const i = emailConfirmed[0];
    sources.push({
      key: "email",
      label: "Email",
      icon: <Mail className="h-4 w-4 text-accent" />,
      status: "confirmed",
      confidence: "high",
      evidence: `${i.external_ref} — operator confirmed`,
      provenance: "member_integration_identities",
    });
  } else if (emailForMe.length) {
    const s = emailForMe[0];
    sources.push({
      key: "email",
      label: "Email",
      icon: <Mail className="h-4 w-4 text-accent" />,
      status: latestReviewByEp.has(s.endpoint_id) ? "connected_no_link" : "candidate",
      confidence: s.confidence,
      evidence: `${s.endpoint_email} · ${s.evidence}`,
      provenance: s.provenance,
      conflicts: s.ambiguity.length ? [`${s.ambiguity.length} candidate members`] : [],
      endpointId: s.endpoint_id,
      suggestedMemberId: actor.id,
    });
  } else {
    sources.push({
      key: "email",
      label: "Email",
      icon: <Mail className="h-4 w-4 text-muted-foreground" />,
      status: "connected_no_link",
      evidence: "no mailbox candidate names this actor yet",
    });
  }

  // Commusoft + Slack (not yet ingested/connected)
  sources.push({
    key: "commusoft",
    label: "Commusoft",
    icon: <Database className="h-4 w-4 text-muted-foreground" />,
    status: "planned",
    evidence: "operational source of truth — read-only import designed, not yet ingested",
  });
  // Slack — full state model (identity discovery is read-only; a Slack user id is never canonical).
  const slackConfirmed = confirmed.filter((i) => i.provider === "slack");
  const slackCandsForMe = (workspace.slackIdentityResolution?.candidates ?? []).filter(
    (c) => c.suggested_member_id === actor.id && c.suggested_kind === "person",
  );
  const slackConn = workspace.connections?.slack;
  const slackWorkspace = workspace.slackIdentityResolution?.workspace?.team_name ?? null;
  const slackIcon = <MessageSquare className="h-4 w-4 text-accent" />;
  if (slackConfirmed.length) {
    sources.push({
      key: "slack",
      label: "Slack",
      icon: slackIcon,
      status: "confirmed",
      confidence: "high",
      evidence: `${slackConfirmed[0].external_ref} — operator confirmed`,
      provenance: "member_integration_identities",
    });
  } else if (slackCandsForMe.length) {
    const c = slackCandsForMe[0];
    const status: SourceStatus = c.deactivated
      ? "deactivated"
      : c.confidence === "unresolved"
        ? "ambiguous"
        : "candidate";
    sources.push({
      key: "slack",
      label: "Slack",
      icon: slackIcon,
      status,
      confidence: c.confidence,
      evidence: [
        slackWorkspace ? `${slackWorkspace}` : null,
        c.display_name ?? c.real_name,
        c.title,
        c.evidence,
      ]
        .filter(Boolean)
        .join(" · "),
      provenance: c.provenance,
      conflicts: [
        ...(c.ambiguity.length ? [`matches ${c.ambiguity.length} members`] : []),
        ...(c.deactivated ? ["Slack account deactivated"] : []),
      ],
      endpointId: c.endpoint_id ?? undefined,
      suggestedMemberId: actor.id,
    });
  } else if (slackConn?.status === "revoked" || slackConn?.status === "error") {
    sources.push({
      key: "slack",
      label: "Slack",
      icon: slackIcon,
      status: "revoked",
      evidence: slackConn.note ?? "Slack connection revoked or errored — reconnect required",
    });
  } else if (workspace.slackIdentityResolution) {
    // Discovery has run but no candidate names this actor.
    sources.push({
      key: "slack",
      label: "Slack",
      icon: slackIcon,
      status: "connected_no_link",
      evidence: "connected — no Slack user candidate names this actor yet",
    });
  } else {
    const connected = slackConn?.status === "connected" || slackConn?.status === "configured";
    sources.push({
      key: "slack",
      label: "Slack",
      icon: <MessageSquare className="h-4 w-4 text-muted-foreground" />,
      status: connected ? "connected_no_link" : "not_connected",
      evidence: connected
        ? "connection available — run identity discovery"
        : (slackConn?.note ?? "read-only connection not yet authorised"),
    });
  }

  // ── Responsibilities ──
  const activeOwn = ownership.filter((o) => o.owner_member_id === actor.id);
  const histOwn = ownershipHistory.filter((o) => o.owner_member_id === actor.id);
  const byRole = (role: string) => activeOwn.filter((o) => o.assignment_role === role);

  // ── Review queue for this actor ──
  const queue: SourceView[] = sources.filter(
    (s) => (s.status === "candidate" || (s.conflicts?.length ?? 0) > 0) && s.endpointId,
  );

  // ── Timeline: identity/ownership history, most recent first ──
  const timeline: { when: string | null; text: string; provenance: string }[] = [];
  for (const r of emailReviews)
    timeline.push({
      when: r.created_at,
      text: `${r.decision} · ${epLabel(r.endpoint_id)}${r.team_member_id === actor.id ? " → this actor" : ""}`,
      provenance: "operator",
    });
  for (const o of histOwn)
    timeline.push({
      when: o.effective_to,
      text: `ended ${o.assignment_role} on ${epLabel(o.endpoint_id)}`,
      provenance: "operator",
    });
  for (const o of activeOwn)
    timeline.push({
      when: o.effective_from,
      text: `took ${o.assignment_role} on ${epLabel(o.endpoint_id)}`,
      provenance: "operator",
    });
  timeline.sort((a, b) => String(b.when ?? "").localeCompare(String(a.when ?? "")));

  const doReview = (
    endpointId: string,
    decision: "confirmed_person" | "rejected",
    memberId: string | null,
    confidence: string | undefined,
    label: string,
  ) => {
    onReviewIdentity?.({
      endpoint_id: endpointId,
      decision,
      team_member_id: decision === "confirmed_person" ? memberId : null,
      confidence,
      reason: `${decision === "confirmed_person" ? "Confirmed" : "Rejected"} ${label} → ${actor.display_name} via Person Intelligence Hub`,
    });
  };

  const identityCompleteness = (() => {
    const confirmedSources = sources.filter((s) => s.status === "confirmed").length;
    const total = 4; // telephony, email, commusoft, slack (the initial four)
    return { confirmedSources, total };
  })();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-hairline bg-white px-2 py-1 text-xs text-muted-foreground hover:border-accent/50"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Directory
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-display">{actor.display_name}</h2>
            <StatusPill tone={actor.effective_to ? "neutral" : "ok"}>
              {actor.effective_to ? "inactive" : "active"}
            </StatusPill>
            <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] text-muted-foreground">
              {actorKind}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {actor.formal_role ?? "role not set"} · What we currently know, organised as evidence
            with confidence &amp; provenance. Nothing is auto-confirmed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {identityCompleteness.confirmedSources}/{identityCompleteness.total} sources confirmed
          </span>
          <button
            type="button"
            onClick={() => onPreview?.(actor.id)}
            disabled={!onPreview}
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/5 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            <Eye className="h-3.5 w-3.5" /> Preview experience
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Identity */}
        <SectionCard
          title="Identity"
          icon={<Fingerprint className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-1">
            <Row label="Canonical person">
              <code className="text-[11px]">{actor.id.slice(0, 8)}…</code> ·{" "}
              <span className="text-muted-foreground">team_members</span>
            </Row>
            <Row label="Observed names">
              {[...observedNames].map((n, i) => (
                <span
                  key={i}
                  className="mr-1 inline-block rounded border border-hairline bg-surface-alt px-1.5 py-0.5 text-[11px]"
                >
                  {n}
                </span>
              ))}
            </Row>
            <Row label="Status">
              <span className="capitalize">
                {confirmed.length ? "confirmed identity link(s)" : "proposed — no confirmed link"}
              </span>
            </Row>
            <Row label="Login">{"no login (identity optional)"}</Row>
            <Row label="Operator decisions">
              {emailReviews.filter((r) => r.team_member_id === actor.id).length || "none"} recorded
            </Row>
          </div>
          <p className="mt-2 rounded-md bg-surface-alt/50 px-2 py-1.5 text-[11px] text-muted-foreground">
            A source label (e.g. a caller-ID string, a mailbox display name) is <em>evidence</em>,
            never the canonical identity. Links are effective-dated — reassignment is preserved,
            never overwritten.
          </p>
        </SectionCard>

        {/* Responsibilities */}
        <SectionCard
          title="Responsibilities"
          icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
        >
          {activeOwn.length === 0 && histOwn.length === 0 ? (
            <EmptyState tone="neutral">
              No ownership yet. Assign accountable / primary / cover / escalation in Ownership.
            </EmptyState>
          ) : (
            <div className="space-y-1.5">
              {(["accountable", "primary_handler", "cover", "escalation"] as const).map((role) => {
                const rows = byRole(role);
                if (!rows.length) return null;
                return (
                  <Row key={role} label={role.replace("_", " ")}>
                    {rows.map((o) => (
                      <span key={o.id} className="mr-1 text-xs">
                        {epLabel(o.endpoint_id)}
                      </span>
                    ))}
                  </Row>
                );
              })}
              {activeOwn.some((o) => o.owner_kind === "shared") && (
                <Row label="shared">shares ownership on 1+ endpoint</Row>
              )}
              {histOwn.length > 0 && (
                <Row label="historic">
                  <span className="text-muted-foreground">
                    {histOwn.length} ended role(s) — see timeline
                  </span>
                </Row>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Connected systems */}
      <SectionCard
        title="Connected systems"
        icon={<Database className="h-4 w-4 text-muted-foreground" />}
        right={`${sources.filter((s) => s.status === "confirmed").length} confirmed`}
      >
        <div className="space-y-2">
          {sources.map((s) => {
            const meta = STATUS_META[s.status];
            return (
              <div key={s.key} className="rounded-lg border border-hairline p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {s.icon}
                  <span className="text-sm font-medium text-display">{s.label}</span>
                  <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                  {s.confidence && <ConfidencePill level={s.confidence} />}
                  {s.provenance && <ProvenanceTag provenance={s.provenance} />}
                  {s.lastSeen !== undefined && (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      last seen {fmtWhen(s.lastSeen)}
                    </span>
                  )}
                </div>
                {s.evidence && <p className="mt-1 text-xs text-muted-foreground">{s.evidence}</p>}
                {(s.conflicts?.length ?? 0) > 0 && (
                  <p className="mt-1 text-[11px] text-amber-700">⚠ {s.conflicts!.join("; ")}</p>
                )}
                {(s.status === "candidate" ||
                  s.status === "ambiguous" ||
                  s.status === "deactivated") &&
                  s.endpointId &&
                  writeCapable && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          doReview(
                            s.endpointId!,
                            "confirmed_person",
                            s.suggestedMemberId ?? actor.id,
                            s.confidence,
                            s.label,
                          )
                        }
                        className="rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success hover:bg-success/20 disabled:opacity-50"
                      >
                        Confirm link
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          doReview(s.endpointId!, "rejected", null, s.confidence, s.label)
                        }
                        className="rounded-md border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-muted-foreground">Later:</span>
            {FUTURE_SOURCES.map((f) => (
              <span
                key={f}
                className="rounded-full border border-dashed border-hairline px-2 py-0.5 text-[10px] text-muted-foreground/70"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Operational activity — honest empty states until bounded evaluation runs */}
      <SectionCard
        title="Operational activity"
        icon={<Activity className="h-4 w-4 text-muted-foreground" />}
        right="today · this week · last 30 days"
      >
        {(() => {
          const totalCalls = telForMe.reduce((n, c) => n + (c.call_count ?? 0), 0);
          const metrics = [
            "Calls",
            "Emails",
            "Jobs",
            "Appointments",
            "Quotes",
            "Invoices",
            "Interactions",
            "Commitments",
            "Waiting",
            "Help given",
            "Help requested",
          ];
          return (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {metrics.map((m) => (
                  <div key={m} className="rounded-md border border-hairline bg-surface-alt/30 p-2">
                    <div className="text-[11px] text-muted-foreground">{m}</div>
                    <div className="text-sm text-muted-foreground/60">— / — / —</div>
                  </div>
                ))}
              </div>
              {totalCalls > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Signal available: <span className="text-display">{totalCalls} calls</span>{" "}
                  observed on candidate extensions (lifetime discovery evidence, not yet
                  time-bucketed).
                </p>
              )}
              <EmptyState tone="neutral">
                Time-bucketed activity becomes available once a bounded read-only evaluation runs
                for a confirmed source. Not fabricated where data is absent.
              </EmptyState>
            </div>
          );
        })()}
      </SectionCard>

      {/* Health contribution */}
      <SectionCard
        title="Health contribution"
        icon={<HeartPulse className="h-4 w-4 text-muted-foreground" />}
      >
        <p className="mb-2 text-xs text-muted-foreground">
          This actor is <em>not</em> the Health subject — they contribute evidence to findings about
          customers, jobs and quotes.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {["Customer Health", "Job Health", "Quote Health", "Ownership Health", "Flow Health"].map(
            (h) => (
              <div key={h} className="rounded-md border border-hairline p-2 text-xs">
                <div className="font-medium text-display">{h}</div>
                <div className="text-[11px] text-muted-foreground">
                  no findings yet — Health evaluation not activated
                </div>
              </div>
            ),
          )}
        </div>
      </SectionCard>

      {/* Review queue */}
      <SectionCard
        title="Review queue"
        icon={<ListChecks className="h-4 w-4 text-muted-foreground" />}
        right={`${queue.length} outstanding`}
      >
        {queue.length === 0 ? (
          <EmptyState>No outstanding identity decisions for this actor.</EmptyState>
        ) : (
          <div className="space-y-2">
            {queue.map((s) => (
              <div
                key={s.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5"
              >
                {s.icon}
                <span className="text-sm text-display">{s.label}</span>
                {s.confidence && <ConfidencePill level={s.confidence} />}
                <span className="text-xs text-muted-foreground">{s.evidence}</span>
                {(s.conflicts?.length ?? 0) > 0 && (
                  <span className="text-[11px] text-amber-700">⚠ {s.conflicts!.join("; ")}</span>
                )}
                {writeCapable && s.endpointId && (
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        doReview(s.endpointId!, "confirmed_person", actor.id, s.confidence, s.label)
                      }
                      className="rounded-md border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success hover:bg-success/20 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        doReview(s.endpointId!, "rejected", null, s.confidence, s.label)
                      }
                      className="rounded-md border border-hairline bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Identity timeline */}
      <SectionCard title="Timeline" icon={<CircleHelp className="h-4 w-4 text-muted-foreground" />}>
        {timeline.length === 0 ? (
          <EmptyState tone="neutral">No identity or ownership history yet.</EmptyState>
        ) : (
          <ol className="space-y-1.5">
            {timeline.slice(0, 20).map((t, i) => (
              <li key={i} className="flex items-baseline gap-2 text-xs">
                <span className="w-20 shrink-0 tabular text-muted-foreground">
                  {fmtWhen(t.when)}
                </span>
                <span className="text-display">{t.text}</span>
                <ProvenanceTag provenance={t.provenance} />
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Identity is temporal — history is never overwritten (e.g. an extension may pass from one
          person to another over time).
        </p>
      </SectionCard>
    </div>
  );
}
