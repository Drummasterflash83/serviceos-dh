/**
 * Identity Resolution V1 — governed operator-review surface (Review mode).
 *
 * A unified, READ-ONLY candidate list across channels (email address / alias / mailbox,
 * telephone extension / DDI, and — structurally — future Slack / Commusoft), each mapped
 * toward a canonical team member. Review mode is fully functional and performs NO writes.
 * Confirmation mode (recording a decision) is a separate, capability-gated action that is
 * DISABLED by default — the decision controls render but are inert until it is approved and
 * enabled server-side. Nothing is auto-confirmed; absent evidence is shown as an honest state.
 */
import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2, Mail, Phone, Search, Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { SectionCard, StatusPill, EmptyState, type Tone } from "./openfolk-ui";
import {
  getIdentityCandidates,
  getIdentityImpact,
  type IdentityCandidate,
  type IdentityCandidateSet,
  type IdentityImpact,
  type IdentityMappingState,
} from "@/lib/openfolk";

const STATE_TONE: Record<IdentityMappingState, Tone> = {
  confirmed: "ok",
  shared: "info",
  suggested: "info",
  conflicting: "attention",
  rejected: "neutral",
  deferred: "attention",
  unassigned: "neutral",
  discovered: "neutral",
  historical: "neutral",
};
const CONF_TONE: Record<string, Tone> = {
  high: "ok",
  medium: "info",
  low: "attention",
  unresolved: "neutral",
};
const CHANNEL_ICON: Record<string, ReactNode> = {
  email: <Mail className="h-4 w-4 text-muted-foreground" />,
  phone: <Phone className="h-4 w-4 text-muted-foreground" />,
};

function isLiveTenant(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

// Review-mode decision verbs (rendered inert until confirmation mode is enabled server-side).
const DECISIONS = [
  "Confirm to suggested",
  "Assign different member",
  "Reject",
  "Mark shared",
  "Mark unassigned",
  "Defer",
];

export function IdentityResolutionSection({ tenantId }: { tenantId: string }) {
  const live = isLiveTenant(tenantId);
  const [set, setSet] = useState<IdentityCandidateSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) {
      setLoading(false);
      return;
    }
    let on = true;
    setLoading(true);
    setError(null);
    getIdentityCandidates(tenantId)
      .then((r) => {
        if (!on) return;
        if (r.ok) setSet(r.data);
        else setError(r.error.message);
      })
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [tenantId, live]);

  if (!live)
    return (
      <EmptyState>
        Identity Resolution reads a live tenant&apos;s canonical evidence. Open it from a real
        tenant workspace (this is a synthetic demo workspace).
      </EmptyState>
    );
  if (loading)
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading identity candidates…
      </p>
    );
  if (error)
    return (
      <div className="rounded-xl border border-destructive/30 bg-white p-4 text-sm text-muted-foreground">
        Could not load identity candidates: {error}
      </div>
    );
  if (!set) return <EmptyState>No identity candidates available.</EmptyState>;

  return (
    <div className="space-y-4">
      {/* Confirmation-mode banner — Review mode is read-only */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-alt/40 p-3 text-xs">
        <Lock className="h-4 w-4 text-accent" />
        <span className="font-semibold text-display">Review mode</span>
        <span className="text-muted-foreground">
          read-only · confirmation is disabled by default — decisions are inert until enabled with
          approval
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <StatusPill tone="ok">{set.summary.confirmed} confirmed</StatusPill>
          <StatusPill tone="attention">{set.summary.needsReview} need review</StatusPill>
          <StatusPill tone="neutral">{set.summary.total} total</StatusPill>
        </span>
      </div>

      {set.candidates.length === 0 ? (
        <EmptyState>No discoverable identity candidates for this tenant yet.</EmptyState>
      ) : (
        <SectionCard
          title="Identity candidates"
          icon={<Fingerprint className="h-4 w-4 text-muted-foreground" />}
          right={`${set.candidates.length} candidates`}
        >
          <div className="space-y-2">
            {set.candidates.map((c) => (
              <CandidateRow key={c.key} c={c} tenantId={tenantId} />
            ))}
          </div>
        </SectionCard>
      )}

      <p className="text-[11px] text-muted-foreground">
        Generated {fmt(set.generatedAt)} from live canonical evidence (read-only). Provider labels
        are evidence only; identities are never auto-confirmed and shared mailboxes/lines are never
        assigned to a single person.
      </p>
    </div>
  );
}

function CandidateRow({ c, tenantId }: { c: IdentityCandidate; tenantId: string }) {
  const [impact, setImpact] = useState<IdentityImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadImpact = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (impact || !c.endpointId) return;
    setImpactLoading(true);
    getIdentityImpact(tenantId, c.endpointId)
      .then((r) => r.ok && setImpact(r.data))
      .finally(() => setImpactLoading(false));
  }, [open, impact, c.endpointId, tenantId]);

  return (
    <div className="rounded-lg border border-hairline p-3">
      <div className="flex flex-wrap items-center gap-2">
        {CHANNEL_ICON[c.channel] ?? <Fingerprint className="h-4 w-4 text-muted-foreground" />}
        <span className="text-sm font-medium text-display">{c.rawExternalIdentity}</span>
        <StatusPill tone="neutral">{c.candidateKind.replace(/_/g, " ")}</StatusPill>
        <StatusPill tone={STATE_TONE[c.mappingState]}>{c.mappingState}</StatusPill>
        {c.isShared && <StatusPill tone="info">shared</StatusPill>}
        <StatusPill tone={CONF_TONE[c.confidence] ?? "neutral"}>{c.confidence}</StatusPill>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {c.provider ?? "—"}
          {c.lastObservedAt ? ` · last ${fmt(c.lastObservedAt)}` : ""}
          {c.activityCount != null ? ` · ${c.activityCount} calls` : ""}
        </span>
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
        <span className="text-muted-foreground">
          suggested{" "}
          <span className="text-display">
            {c.suggestedMemberName ?? (c.suggestedKind === "shared" ? "shared (no person)" : "—")}
          </span>
        </span>
        {c.latestDecision && (
          <span className="text-muted-foreground">
            last decision <span className="text-display">{c.latestDecision}</span>
          </span>
        )}
      </div>

      {c.supportingEvidence.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          <span className="font-medium">Supporting:</span> {c.supportingEvidence.join(" · ")}
        </p>
      )}
      {c.conflictingEvidence.length > 0 && (
        <p className="mt-0.5 text-[11px] text-amber-700">
          <span className="font-medium">Conflicting:</span> {c.conflictingEvidence.join(" · ")}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={loadImpact}
          disabled={!c.endpointId}
          className="inline-flex items-center gap-1 rounded border border-hairline bg-white px-2 py-0.5 text-[11px] text-muted-foreground hover:text-display"
        >
          <Search className="h-3 w-3" /> Impact preview
        </button>
        {/* Decision controls — inert in Review mode (confirmation disabled by default) */}
        {DECISIONS.map((d) => (
          <button
            key={d}
            type="button"
            disabled
            title="Confirmation mode disabled — enable with approval to record decisions"
            className="cursor-not-allowed rounded border border-hairline bg-surface-alt/40 px-2 py-0.5 text-[11px] text-muted-foreground/50"
          >
            {d}
          </button>
        ))}
      </div>

      {open && (
        <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 p-2.5 text-[11px]">
          {impactLoading && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Computing impact…
            </span>
          )}
          {!impactLoading && impact && (
            <>
              <div className="flex items-center gap-1.5 text-display">
                <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                Confirming this identity would associate{" "}
                <span className="font-semibold">{impact.interactions}</span> interactions,{" "}
                <span className="font-semibold">{impact.intelligenceObjects}</span> intelligence
                objects and <span className="font-semibold">{impact.unresolvedActions}</span>{" "}
                unresolved actions with this member.
              </div>
              {impact.note && <p className="mt-0.5 text-amber-700">{impact.note}</p>}
            </>
          )}
          {!impactLoading && !impact && (
            <span className="text-muted-foreground">No impact detail available.</span>
          )}
        </div>
      )}
    </div>
  );
}
