/**
 * OpenFolk Control Plane — Operational Command Centre (replaces the Overview stat wall).
 *
 * Answers, fast: what needs attention, what's blocked, what's waiting on others, who owns the
 * next action, what changed, what to do next. Every number is DERIVED FROM REAL WORKSPACE
 * STATE — nothing is fabricated. Counts are entity-level and de-duplicated (e.g. "31 endpoints
 * need ownership", not "124 missing ownership fields"). "Do next" is deterministic rule output,
 * labelled as such — no implied AI reasoning.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Clock, Compass, ListChecks } from "lucide-react";
import { projectConnections } from "@/lib/openfolk-connections";
import { OWNERSHIP_ROLES, summariseActivity } from "@/lib/openfolk-workspace-nav";
import type { WorkspaceSection } from "@/lib/openfolk-workspace-nav";
import type { AuditEntry, DelegatedTask, SourceReadiness, Workspace } from "@/lib/openfolk";
import type { DelegatedActions } from "@/components/app/OpenfolkConnections";
import {
  ActionItem,
  ActivityItem,
  EmptyState,
  ReadinessStage,
  SectionCard,
  SignalCard,
  StatusPill,
  type Tone,
} from "@/components/app/openfolk-ui";

const READINESS_TONE: Record<string, Tone> = {
  not_ready: "risk",
  ready_for_evaluation: "attention",
  ready_for_chris_shadow: "ok",
  ready_for_staff_pilot: "ok",
};
const READINESS_LABEL: Record<string, string> = {
  not_ready: "Not ready",
  ready_for_evaluation: "Ready for evaluation",
  ready_for_chris_shadow: "Ready for Chris-only shadow",
  ready_for_staff_pilot: "Ready for staff pilot",
};

export function OpenfolkCommandCentre({
  tenantName,
  workspace,
  readiness,
  audit,
  onGo,
  delegated,
}: {
  tenantName: string;
  workspace: Workspace;
  readiness: SourceReadiness | null;
  audit: AuditEntry[];
  onGo: (section: WorkspaceSection) => void;
  delegated?: DelegatedActions;
}) {
  const { endpoints, ownership, identities, connections, identityResolution } = workspace;

  // ── Real, entity-level signals ──
  const signals = useMemo(() => {
    const active = endpoints.filter((e) => e.status === "active");
    const rolesFor = (id: string) =>
      new Set(
        ownership
          .filter((o) => o.endpoint_id === id && o.review_state !== "rejected")
          .map((o) => o.assignment_role),
      );
    const ownershipComplete = active.filter((e) =>
      OWNERSHIP_ROLES.every((r) => rolesFor(e.id).has(r)),
    );
    const endpointsNeedingOwnership = active.length - ownershipComplete.length;

    const email = active.filter((e) => e.channel === "email");
    const latestReview = new Map<string, string>();
    for (const r of identityResolution?.reviews ?? [])
      if (!latestReview.has(r.endpoint_id)) latestReview.set(r.endpoint_id, r.decision);
    const unresolvedIdentities = email.filter((e) => {
      const d = latestReview.get(e.id);
      return !d || d === "unresolved" || d === "rejected";
    }).length;

    const connViews = projectConnections(connections, { endpoints, identities });
    const connectionsNeedingAction = connViews.filter(
      (c) =>
        (c.adapterImplemented && !c.connected) || c.warnings.length > 0 || c.health === "degraded",
    ).length;

    const readinessBlockers = (readiness?.checks ?? []).filter((c) => !c.ok);

    return {
      active,
      ownershipComplete: ownershipComplete.length,
      endpointsNeedingOwnership,
      unresolvedIdentities,
      connViews,
      connectionsNeedingAction,
      readinessBlockers,
      confirmedIdentities: identities.length,
    };
  }, [endpoints, ownership, identities, connections, identityResolution, readiness]);

  // ── Setup requests (waiting on customer admin) ──
  const [tasks, setTasks] = useState<DelegatedTask[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!delegated) return;
    delegated
      .list()
      .then((t) => live && setTasks(t))
      .catch(() => live && setTasks([]));
    return () => {
      live = false;
    };
  }, [delegated]);
  const openTasks = (tasks ?? []).filter((t) =>
    ["created", "opened", "submitted"].includes(t.status),
  );
  const submittedTasks = (tasks ?? []).filter((t) => t.status === "submitted");

  const readinessLevel = readiness?.level ?? "not_ready";

  // ── Do next (deterministic rules) ──
  const doNext: {
    title: string;
    reason: string;
    area: string;
    cta: string;
    section: WorkspaceSection;
    tone: Tone;
  }[] = [];
  if (submittedTasks.length)
    doNext.push({
      title: `Review ${submittedTasks.length} submitted setup request${submittedTasks.length > 1 ? "s" : ""}`,
      reason: "A customer admin has submitted inventory for operator approval.",
      area: "Connections",
      cta: "Review",
      section: "connections",
      tone: "info",
    });
  if (signals.connectionsNeedingAction)
    doNext.push({
      title: `Resolve ${signals.connectionsNeedingAction} connection${signals.connectionsNeedingAction > 1 ? "s" : ""} needing action`,
      reason: "Not connected, degraded, or a boundary/warning to clear.",
      area: "Connections",
      cta: "Open",
      section: "connections",
      tone: "attention",
    });
  if (signals.unresolvedIdentities)
    doNext.push({
      title: `Review ${signals.unresolvedIdentities} unresolved mailbox${signals.unresolvedIdentities > 1 ? "es" : ""}`,
      reason: "Confirm who each mailbox represents (identity ≠ ownership).",
      area: "Directory › Identity review",
      cta: "Review",
      section: "review",
      tone: "attention",
    });
  if (signals.endpointsNeedingOwnership)
    doNext.push({
      title: `Configure ownership for ${signals.endpointsNeedingOwnership} endpoint${signals.endpointsNeedingOwnership > 1 ? "s" : ""}`,
      reason: "Assign accountable / primary handler / cover / escalation.",
      area: "Directory › Ownership",
      cta: "Assign",
      section: "ownership",
      tone: "attention",
    });
  if (signals.readinessBlockers.length)
    doNext.push({
      title: `Clear readiness blocker: ${signals.readinessBlockers[0].detail}`,
      reason: `${signals.readinessBlockers.length} check${signals.readinessBlockers.length > 1 ? "s" : ""} still failing before this tenant is ready.`,
      area: "Health & Readiness",
      cta: "Open",
      section: "health",
      tone: "risk",
    });

  // ── Readiness ladder (derived) ──
  const anyConnected = signals.connViews.some((c) => c.connected);
  const discovered = signals.active.length > 0;
  const ownComplete = signals.ownershipComplete;
  const ladder: {
    label: string;
    status: "done" | "active" | "blocked" | "todo";
    blockers?: number;
    detail: string;
    section: WorkspaceSection;
  }[] = [
    {
      label: "Connection",
      status: anyConnected ? "done" : "active",
      blockers: signals.connectionsNeedingAction || undefined,
      detail: `${signals.connViews.filter((c) => c.connected).length}/${signals.connViews.length} connected`,
      section: "connections",
    },
    {
      label: "Discovery",
      status: discovered ? "done" : "todo",
      detail: `${signals.active.length} canonical endpoints`,
      section: "connections",
    },
    {
      label: "Identity",
      status: signals.unresolvedIdentities ? "active" : discovered ? "done" : "todo",
      blockers: signals.unresolvedIdentities || undefined,
      detail: `${signals.confirmedIdentities} linked · ${signals.unresolvedIdentities} unresolved`,
      section: "review",
    },
    {
      label: "Ownership",
      status: signals.endpointsNeedingOwnership ? "active" : discovered ? "done" : "todo",
      blockers: signals.endpointsNeedingOwnership || undefined,
      detail: `${ownComplete}/${signals.active.length} ownership-complete`,
      section: "ownership",
    },
    {
      label: "Readiness",
      status: readinessLevel === "not_ready" ? "blocked" : "active",
      blockers: signals.readinessBlockers.length || undefined,
      detail: READINESS_LABEL[readinessLevel] ?? readinessLevel,
      section: "health",
    },
    {
      label: "Shadow",
      status: "todo",
      detail: "Not started — activation is operator-gated",
      section: "health",
    },
    { label: "Production", status: "todo", detail: "Not started", section: "health" },
  ];

  const activity = useMemo(() => summariseActivity(audit, 7), [audit]);

  return (
    <div className="space-y-4">
      {/* A. Page introduction */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Command Centre
          </div>
          <h2 className="text-xl font-semibold text-display">{tenantName}</h2>
          <p className="text-xs text-muted-foreground">
            {signals.active.length} canonical endpoints · {signals.ownershipComplete}/
            {signals.active.length} ownership-complete ·{" "}
            {signals.connViews.filter((c) => c.connected).length}/{signals.connViews.length}{" "}
            connections live
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={READINESS_TONE[readinessLevel] ?? "neutral"}>
            {READINESS_LABEL[readinessLevel] ?? readinessLevel}
          </StatusPill>
          {doNext[0] && (
            <button
              type="button"
              onClick={() => onGo(doNext[0].section)}
              className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            >
              {doNext[0].cta}: {doNext[0].title.replace(/^[A-Z]/, (m) => m.toLowerCase())}
            </button>
          )}
        </div>
      </div>

      {/* B. Needs attention (≤6 de-duplicated, entity-level signals) */}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Needs attention
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SignalCard
            label="Connections"
            count={signals.connectionsNeedingAction}
            meaning="need action"
            tone="attention"
            onGo={() => onGo("connections")}
          />
          <SignalCard
            label="Unmapped endpoints"
            count={signals.endpointsNeedingOwnership}
            meaning="need ownership"
            tone="attention"
            onGo={() => onGo("ownership")}
          />
          <SignalCard
            label="Unresolved identities"
            count={signals.unresolvedIdentities}
            meaning="mailboxes to review"
            tone="attention"
            onGo={() => onGo("review")}
          />
          <SignalCard
            label="Readiness blockers"
            count={signals.readinessBlockers.length}
            meaning="checks failing"
            tone={signals.readinessBlockers.length ? "risk" : "ok"}
            onGo={() => onGo("health")}
          />
          <SignalCard
            label="Open setup requests"
            count={tasks === null ? "…" : openTasks.length}
            meaning="awaiting customer"
            tone="info"
            onGo={() => onGo("connections")}
          />
          <SignalCard
            label="Data-quality"
            count={signals.endpointsNeedingOwnership + signals.unresolvedIdentities}
            meaning="entities affected"
            tone="attention"
            onGo={() => onGo("data_quality")}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* C. Do next */}
        <SectionCard
          title="Do next"
          icon={<ListChecks className="h-4 w-4 text-accent" />}
          right="rule-based"
        >
          {doNext.length === 0 ? (
            <EmptyState tone="ok">
              Nothing needs you right now — this tenant is on track.
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {doNext.map((d, i) => (
                <ActionItem
                  key={i}
                  title={d.title}
                  reason={d.reason}
                  area={d.area}
                  cta={d.cta}
                  tone={d.tone}
                  onGo={() => onGo(d.section)}
                />
              ))}
            </div>
          )}
        </SectionCard>

        {/* D. Waiting on others */}
        <SectionCard title="Waiting on others" icon={<Clock className="h-4 w-4 text-accent" />}>
          {tasks === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : openTasks.length === 0 ? (
            <EmptyState tone="ok">
              Nothing is currently blocked on a customer or provider.
            </EmptyState>
          ) : (
            <div className="divide-y divide-hairline">
              {openTasks.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                  <StatusPill tone={t.status === "submitted" ? "info" : "attention"}>
                    {t.status}
                  </StatusPill>
                  <span className="font-medium text-display">{t.task_type.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground">
                    {t.recipient_name ? `${t.recipient_name} · ` : ""}
                    {t.recipient_email}
                  </span>
                  <button
                    type="button"
                    onClick={() => onGo("connections")}
                    className="ml-auto rounded-md border border-hairline bg-white px-2 py-0.5 text-[10px] text-muted-foreground hover:text-display"
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* E. Tenant readiness ladder */}
      <SectionCard
        title="Tenant readiness"
        icon={<Compass className="h-4 w-4 text-accent" />}
        right={READINESS_LABEL[readinessLevel] ?? readinessLevel}
      >
        <div className="flex items-start gap-0">
          {ladder.map((s, i) => (
            <ReadinessStage
              key={s.label}
              label={s.label}
              status={s.status}
              blockers={s.blockers}
              detail={s.detail}
              onGo={() => onGo(s.section)}
              last={i === ladder.length - 1}
            />
          ))}
        </div>
      </SectionCard>

      {/* F. Recent meaningful changes */}
      <SectionCard
        title="Recent changes"
        icon={<Activity className="h-4 w-4 text-accent" />}
        right={
          <button type="button" onClick={() => onGo("audit")} className="hover:text-display">
            Full audit →
          </button>
        }
      >
        {activity.length === 0 ? (
          <EmptyState tone="ok">No meaningful configuration changes recently.</EmptyState>
        ) : (
          <div className="divide-y divide-hairline">
            {activity.map((a, i) => (
              <ActivityItem key={i} title={a.title} meta={a.meta} tone={a.tone} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
