/**
 * OpenFolk Control Plane — tenant workspace (presentational).
 *
 * OpenFolk-operated managed-service configuration for ONE tenant. Manual-first,
 * discovery-assisted: provider discovery populates candidate endpoints; the operator
 * enters typed manual inventory and confirms ownership (accountable / handler / cover /
 * escalation) with a reason. Data-plane state comes from the gated openfolk-control-plane
 * function; this component only renders + emits actions (a demo route feeds synthetic data,
 * so every callback and the connections/phoneEvidence payloads are optional).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle2,
  Database,
  HeartPulse,
  History,
  Lock,
  Mail,
  MessagesSquare,
  Phone,
  Plug,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DIRECTORY_SECTIONS,
  OWNERSHIP_ROLES,
  evaluateConcentration,
  isOwnershipComplete,
  nextMissingRole,
  type ConcentrationFinding,
  type OwnershipRole,
  type WorkspaceSection,
} from "@/lib/openfolk-workspace-nav";
import { projectConnections } from "@/lib/openfolk-connections";
import { OpenfolkConnections, type DelegatedActions } from "@/components/app/OpenfolkConnections";
import { OpenfolkCommandCentre } from "@/components/app/OpenfolkCommandCentre";
import { LearningSection } from "@/components/app/LearningSection";
import { IdentityResolutionSection } from "@/components/app/IdentityResolutionSection";
import { PersonIntelligenceHub } from "@/components/app/PersonIntelligenceHub";
import { TeamMemberPreview } from "@/components/app/TeamMemberPreview";
import type {
  AuditEntry,
  CpEndpoint,
  CpIdentity,
  CpMember,
  CpOwnership,
  DataQualityItem,
  EmailClassification,
  EndpointValidation,
  IdentitySuggestion,
  OperationalClass,
  ProviderMailboxType,
  ReviewDecision,
  SourceReadiness,
  Workspace,
} from "@/lib/openfolk";

// Roles + section keys are shared with the route's URL `validateSearch` via the pure
// navigation module, so both agree on order, completeness, and the safe default.
const REQUIRED_ROLES = OWNERSHIP_ROLES;
type OwnRole = OwnershipRole;
type ReviewRow = {
  endpoint_id: string;
  decision: string;
  team_member_id: string | null;
  created_at: string;
};

const READINESS_META: Record<string, { label: string; cls: string }> = {
  not_ready: { label: "Not ready", cls: "text-destructive" },
  ready_for_evaluation: { label: "Ready for evaluation", cls: "text-amber-600" },
  ready_for_chris_shadow: { label: "Ready for Chris-only shadow", cls: "text-success" },
  ready_for_staff_pilot: { label: "Ready for staff pilot", cls: "text-success" },
};

// The section keys are shared with the route's URL `validateSearch` and the shell's grouped
// sidebar; this component renders only the CONTENT for the active section (the shell owns nav).
type Section = WorkspaceSection;
// Communications re-homes the former Email / Phone / Slack sub-tabs (identity review now lives
// under the Directory nav group).
const COMM_TABS = ["email", "phone", "slack"] as const;
type CommTab = (typeof COMM_TABS)[number];
const COMM_TAB_LABEL: Record<CommTab, string> = {
  email: "Email",
  phone: "Phone",
  slack: "Slack",
};

// Operational classification is DISTINCT from the raw provider mailbox type.
const OPCLASS_META: Record<OperationalClass, { label: string; cls: string }> = {
  personal: { label: "personal", cls: "border-hairline text-muted-foreground" },
  shared: { label: "shared responsibility", cls: "border-accent/40 text-accent" },
  team: { label: "team/group", cls: "border-accent/40 text-accent" },
  service: { label: "service/system", cls: "border-hairline text-muted-foreground" },
  inactive: { label: "inactive", cls: "border-amber-500/40 text-amber-700" },
  unknown: { label: "unknown", cls: "border-amber-500/40 text-amber-700" },
};
const PROVIDER_TYPE_LABEL: Record<ProviderMailboxType, string> = {
  user: "user",
  group: "group",
  alias: "alias",
  shared: "shared",
  suspended: "suspended",
  unknown: "unknown",
};

const MANUAL_KINDS = ["ddi", "extension", "queue", "ring_group", "voicemail", "sip", "device"];

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-white p-4 sm:p-5">
      <header className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-display">{title}</h3>
        {right && <span className="ml-auto">{right}</span>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, n, tone }: { label: string; n: number; tone?: "warn" | "ok" }) {
  return (
    <div className="rounded-xl border border-hairline bg-white p-3">
      <div
        className={cn(
          "text-2xl font-semibold text-display tabular",
          tone === "warn" && n > 0 && "text-amber-600",
          tone === "ok" && n > 0 && "text-success",
        )}
      >
        {n}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

// A Stat that links to another section (Overview metrics link to their detail section).
function StatLink({
  label,
  n,
  tone,
  onGo,
}: {
  label: string;
  n: number;
  tone?: "warn" | "ok";
  onGo: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onGo}
      className="rounded-xl border border-hairline bg-white p-3 text-left transition-colors hover:border-accent/40"
    >
      <div
        className={cn(
          "text-2xl font-semibold text-display tabular",
          tone === "warn" && n > 0 && "text-amber-600",
          tone === "ok" && n > 0 && "text-success",
        )}
      >
        {n}
      </div>
      <div className="text-[11px] text-muted-foreground">{label} →</div>
    </button>
  );
}

function memberName(members: CpMember[], id: string | null): string {
  if (!id) return "—";
  return members.find((m) => m.id === id)?.display_name ?? id.slice(0, 8);
}

export interface WorkspaceActions {
  onDiscoverTelephony?: (reason: string) => void;
  onDiscoverEmail?: (reason: string) => void;
  // Resolves true on a successful assignment so the caller can advance focus to the next
  // missing role and show an inline success state without unmounting/resetting the view.
  onAssign?: (
    endpointId: string,
    memberId: string,
    role: string,
    reason: string,
  ) => Promise<boolean> | void;
  onValidateEndpoint?: (input: {
    endpoint_kind: string;
    value?: string;
    display_value?: string;
    provider_context?: string;
  }) => Promise<EndpointValidation | null>;
  onCreateEndpoint?: (input: {
    endpoint_kind: string;
    value?: string;
    display_value?: string;
    provider_context?: string;
    notes?: string;
    reason: string;
  }) => Promise<boolean>;
  onArchiveEndpoint?: (endpointId: string, reason: string) => void;
  onReviewIdentity?: (input: {
    endpoint_id: string;
    decision: ReviewDecision;
    team_member_id?: string | null;
    confidence?: string;
    reason: string;
  }) => void;
  onEndOwnership?: (input: {
    assignment_id: string;
    effective_to?: string | null;
    expected_updated_at?: string | null;
    reason: string;
  }) => void;
  onUpdateEndpoint?: (input: {
    endpoint_id: string;
    display_value?: string;
    provider_context?: string;
    expected_updated_at?: string | null;
    reason: string;
  }) => Promise<{ ok: boolean; outcome?: string; error?: string }>;
  onRestoreEndpoint?: (endpointId: string, reason: string) => void;
}

export function OpenfolkWorkspace({
  tenantName,
  workspace,
  readiness,
  audit,
  writeCapable = false,
  busy = false,
  lastRefresh,
  actions = {},
  section: controlledSection,
  onSectionChange,
  selectedEndpoint = null,
  onSelectEndpoint,
  selectedPerson = null,
  onSelectPerson,
  delegatedActions,
}: {
  tenantName: string;
  workspace: Workspace;
  readiness: SourceReadiness | null;
  audit: AuditEntry[];
  writeCapable?: boolean;
  busy?: boolean;
  lastRefresh?: string;
  actions?: WorkspaceActions;
  // The active section is durable state, owned by the URL on the live route. When these
  // controlled props are supplied the section lives in the URL (survives refresh, mutation
  // refetch, Back/Forward); otherwise it falls back to local state (e.g. the read-only demo).
  section?: Section;
  onSectionChange?: (s: Section) => void;
  selectedEndpoint?: string | null;
  onSelectEndpoint?: (endpointId: string | null) => void;
  // Selected person = durable URL state (?person=), opens the Person Intelligence Hub.
  selectedPerson?: string | null;
  onSelectPerson?: (memberId: string | null) => void;
  delegatedActions?: DelegatedActions;
}) {
  const [localSection, setLocalSection] = useState<Section>(controlledSection ?? "overview");
  const section = controlledSection ?? localSection;
  const setSection = useCallback(
    (s: Section) => (onSectionChange ? onSectionChange(s) : setLocalSection(s)),
    [onSectionChange],
  );
  // Communications sub-tab + selected connection are local (the main section stays durable
  // in the URL). Identity review is reachable via the Communications "Identity review" tab.
  const [commTab, setCommTab] = useState<CommTab>("email");
  const [selectedConn, setSelectedConn] = useState<string | null>(null);
  // Person selection falls back to local state on the read-only demo (no URL param there).
  const [localPerson, setLocalPerson] = useState<string | null>(null);
  const personId = selectedPerson ?? localPerson;
  const selectPerson = useCallback(
    (id: string | null) => (onSelectPerson ? onSelectPerson(id) : setLocalPerson(id)),
    [onSelectPerson],
  );
  // Operator preview is read-only and never attributed to the actor (clearly banner-marked).
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const {
    summary,
    members,
    identities,
    endpoints,
    ownership,
    ownershipHistory = [],
    dataQuality,
    connections,
    phoneEvidence,
    identityResolution,
  } = workspace;

  const suggestionByEndpoint = useMemo(
    () => new Map((identityResolution?.suggestions ?? []).map((s) => [s.endpoint_id, s])),
    [identityResolution],
  );
  const classByEndpoint = useMemo(
    () => new Map((identityResolution?.classifications ?? []).map((c) => [c.endpoint_id, c])),
    [identityResolution],
  );
  const reviewByEndpoint = useMemo(() => {
    const m = new Map<string, { decision: string; team_member_id: string | null }>();
    for (const r of identityResolution?.reviews ?? [])
      if (!m.has(r.endpoint_id)) m.set(r.endpoint_id, r);
    return m;
  }, [identityResolution]);

  const classifications = useMemo(
    () => identityResolution?.classifications ?? [],
    [identityResolution],
  );
  // Provider mailbox-type counts (raw provider fact) — kept SEPARATE from operational class.
  const providerTypeCounts = useMemo(() => {
    const c = { user: 0, group: 0, alias: 0, shared: 0, suspended: 0, unknown: 0 } as Record<
      ProviderMailboxType,
      number
    >;
    for (const x of classifications)
      c[x.provider_mailbox_type] = (c[x.provider_mailbox_type] ?? 0) + 1;
    return c;
  }, [classifications]);
  // Operational-classification counts (how the box is actually used) — from reviewed evidence.
  const opClassCounts = useMemo(() => {
    const c = { personal: 0, shared: 0, team: 0, service: 0, inactive: 0, unknown: 0 } as Record<
      OperationalClass,
      number
    >;
    for (const x of classifications) c[x.operational_class] = (c[x.operational_class] ?? 0) + 1;
    return c;
  }, [classifications]);

  // Latest decision per endpoint (reviews arrive newest-first). Only a confirmed PERSON
  // decision creates an identity LINK.
  const latestDecisionCounts = useMemo(() => {
    const seen = new Set<string>();
    const c = {
      confirmed_person: 0,
      shared: 0,
      team: 0,
      system: 0,
      rejected: 0,
      unresolved: 0,
    } as Record<string, number>;
    for (const r of identityResolution?.reviews ?? []) {
      if (seen.has(r.endpoint_id)) continue;
      seen.add(r.endpoint_id);
      c[r.decision] = (c[r.decision] ?? 0) + 1;
    }
    return c;
  }, [identityResolution]);
  const confirmedIdentityCount = latestDecisionCounts.confirmed_person;
  const rejectedCount = latestDecisionCounts.rejected;
  const suspendedCount = opClassCounts.inactive;

  const active = useMemo(() => endpoints.filter((e) => e.status === "active"), [endpoints]);
  const phone = active.filter((e) => e.channel === "phone");
  const email = active.filter((e) => e.channel === "email");
  const unresolvedIdentityCount = email.filter((e) => {
    const d = reviewByEndpoint.get(e.id)?.decision;
    return !d || d === "unresolved" || d === "rejected";
  }).length;
  const accountableFor = (endpointId: string) =>
    ownership.find(
      (o) =>
        o.endpoint_id === endpointId &&
        o.assignment_role === "accountable" &&
        o.review_state !== "rejected",
    ) ?? null;
  const mapped = active.filter((e) => accountableFor(e.id)).length;
  const rolesFor = (id: string) =>
    new Set(
      ownership
        .filter((o) => o.endpoint_id === id && o.review_state !== "rejected")
        .map((o) => o.assignment_role),
    );
  const ownershipComplete = active.filter((e) =>
    REQUIRED_ROLES.every((r) => rolesFor(e.id).has(r)),
  ).length;
  // Missing-role counts across active endpoints — distinct categories, never one flat total.
  const missingRole = useMemo(() => {
    const m: Record<OwnRole, number> = {
      accountable: 0,
      primary_handler: 0,
      cover: 0,
      escalation: 0,
    };
    for (const e of active) {
      const s = rolesFor(e.id);
      for (const r of REQUIRED_ROLES) if (!s.has(r)) m[r]++;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ownership]);
  const evidence = phoneEvidence ?? [];
  const archivedManualPhone = useMemo(
    () =>
      endpoints.filter(
        (e) => e.channel === "phone" && e.status === "inactive" && e.source === "manual",
      ),
    [endpoints],
  );
  // Generic connection projection — reused by Overview, Connections, Security, Data Quality.
  const connViews = useMemo(
    () => projectConnections(connections, { endpoints, identities }),
    [connections, endpoints, identities],
  );
  const connectedCount = connViews.filter((c) => c.connected).length;
  const connActionCount = connViews.filter(
    (c) => !c.connected || c.warnings.length > 0 || c.health === "degraded",
  ).length;
  // Connection-oriented data-quality issues, derived from the projection (§18).
  const connectionIssues = useMemo(() => {
    const out: { kind: string; detail: string }[] = [];
    for (const c of connViews) {
      if (c.adapterImplemented && !c.connected)
        out.push({
          kind: "connection_not_authorised",
          detail: `${c.providerLabel} is not connected`,
        });
      for (const w of c.warnings)
        out.push({ kind: "outside_boundary_identities", detail: `${c.providerLabel}: ${w}` });
      if (c.connected && c.readiness === "connected" && c.family === "telephony")
        out.push({
          kind: "provider_data_without_canonical",
          detail: `${c.providerLabel}: ${c.evidenceCount} raw evidence record(s), 0 typed canonical endpoints`,
        });
    }
    return out;
  }, [connViews]);

  return (
    <div>
      {/* Directory sub-nav (People / Identity review / Ownership share one nav home). */}
      {DIRECTORY_SECTIONS.includes(section) && (
        <nav className="mb-3 flex flex-wrap gap-1">
          {(
            [
              ["people", "People"],
              ["review", "Identity review"],
              ["ownership", "Ownership"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium",
                section === key
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-hairline text-muted-foreground hover:text-display",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      <div className="space-y-4">
        {/* ── Command Centre (was the Overview stat wall) ───────────── */}
        {section === "overview" && (
          <OpenfolkCommandCentre
            tenantName={tenantName}
            workspace={workspace}
            readiness={readiness}
            audit={audit}
            onGo={setSection}
            delegated={delegatedActions}
          />
        )}

        {/* ── Learning (read-only Source Truth + Existing Intelligence) ─ */}
        {section === "learning" && <LearningSection tenantId={summary.tenant_id} />}

        {/* ── Identity Resolution V1 (governed review, read-only mode) ── */}
        {section === "identity" && <IdentityResolutionSection tenantId={summary.tenant_id} />}

        {/* ── People / Person Intelligence Hub ─────────────────────── */}
        {section === "people" &&
          (() => {
            const selected = personId ? members.find((m) => m.id === personId) : null;
            if (selected) {
              // Directory → Person Intelligence Hub → (Preview) → generated ServiceOS experience →
              // exit returns to the SAME hub. Preview keeps auth context untouched (never impersonates).
              if (previewFor === selected.id) {
                return (
                  <TeamMemberPreview
                    actor={selected}
                    workspace={workspace}
                    onExit={() => setPreviewFor(null)}
                  />
                );
              }
              return (
                <PersonIntelligenceHub
                  actor={selected}
                  workspace={workspace}
                  writeCapable={writeCapable}
                  busy={busy}
                  onReviewIdentity={actions.onReviewIdentity}
                  onBack={() => selectPerson(null)}
                  onPreview={(id) => setPreviewFor(id)}
                />
              );
            }
            return (
              <Card
                title="People"
                right={
                  <span className="text-[11px] text-muted-foreground">
                    {members.length} member(s)
                  </span>
                }
              >
                <p className="mb-3 text-xs text-muted-foreground">
                  Canonical <code className="text-[11px]">team_members</code>. Open any actor for
                  the Person Intelligence Hub — what we currently know, organised as evidence with
                  confidence + provenance. Identity links are never auto-confirmed from a name
                  match.
                </p>
                <div className="divide-y divide-hairline">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <PersonRow
                          member={m}
                          identities={identities}
                          ownership={ownership}
                          ownershipHistory={ownershipHistory}
                          endpoints={endpoints}
                          suggestions={identityResolution?.suggestions ?? []}
                          reviews={identityResolution?.reviews ?? []}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => selectPerson(m.id)}
                        className="shrink-0 rounded-md border border-hairline bg-white px-2 py-1 text-[11px] font-medium text-accent hover:border-accent/50"
                      >
                        Open hub →
                      </button>
                    </div>
                  ))}
                  {members.length === 0 && (
                    <p className="py-2 text-xs italic text-muted-foreground">No members yet.</p>
                  )}
                </div>
              </Card>
            );
          })()}

        {/* ── Communications (re-homes Email / Phone / Slack / Identity review) ── */}
        {section === "communications" && (
          <nav className="flex flex-wrap gap-1">
            {COMM_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCommTab(t)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-medium",
                  commTab === t
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-hairline text-muted-foreground hover:text-display",
                )}
              >
                {COMM_TAB_LABEL[t]}
              </button>
            ))}
          </nav>
        )}

        {/* ── Operator review queue (Directory › Identity review) ── */}
        {section === "review" && (
          <ReviewQueue
            email={email}
            members={members}
            classByEndpoint={classByEndpoint}
            suggestionByEndpoint={suggestionByEndpoint}
            reviewByEndpoint={reviewByEndpoint}
            accountableFor={accountableFor}
            writeCapable={writeCapable}
            busy={busy}
            onReview={actions.onReviewIdentity}
          />
        )}

        {/* ── Connections (generic lifecycle) ──────────────────────── */}
        {section === "connections" && (
          <OpenfolkConnections
            connections={connections}
            workspace={{ endpoints, identities }}
            selectedId={selectedConn}
            onSelect={setSelectedConn}
            delegated={delegatedActions}
          />
        )}

        {/* ── Phone (Communications › Phone) ───────────────────────── */}
        {section === "communications" && commTab === "phone" && (
          <div className="space-y-4">
            <Card
              title="Canonical phone inventory"
              right={
                <span className="text-[11px] text-muted-foreground">
                  {phone.length} endpoint(s)
                </span>
              }
            >
              {writeCapable && actions.onValidateEndpoint && actions.onCreateEndpoint && (
                <AddEndpointForm
                  busy={busy}
                  onValidate={actions.onValidateEndpoint}
                  onCreate={actions.onCreateEndpoint}
                />
              )}
              <div className="mt-3 space-y-2">
                {phone.map((e) => (
                  <EndpointRow
                    key={e.id}
                    e={e}
                    acc={accountableFor(e.id)}
                    members={members}
                    writeCapable={writeCapable}
                    busy={busy}
                    onArchive={actions.onArchiveEndpoint}
                    onAssign={actions.onAssign}
                    onUpdate={actions.onUpdateEndpoint}
                    onValidate={actions.onValidateEndpoint}
                  />
                ))}
                {phone.length === 0 && (
                  <p className="text-xs italic text-muted-foreground">
                    No typed phone endpoints. Provider inventory discovery is unavailable for this
                    provider (DDI/queue discovery is “planned”, extensions/devices are “manual”) —
                    add typed inventory above.
                  </p>
                )}
              </div>
            </Card>

            {archivedManualPhone.length > 0 && (
              <Card
                title="Archived manual phone endpoints"
                right={
                  <span className="text-[11px] text-muted-foreground">
                    {archivedManualPhone.length}
                  </span>
                }
              >
                <p className="mb-2 text-xs text-muted-foreground">
                  Deactivated (history kept, never deleted). Manual endpoints can be restored.
                </p>
                <div className="space-y-2">
                  {archivedManualPhone.map((e) => (
                    <div
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-surface-alt/40 p-3"
                    >
                      <span className="text-sm text-muted-foreground">
                        <span>{e.endpoint_kind}</span> · {e.display_value ?? e.normalized_value}
                        <span className="ml-1 text-[11px]">(inactive)</span>
                      </span>
                      {writeCapable && actions.onRestoreEndpoint && (
                        <ConfirmButton
                          label="Restore"
                          variant="ghost"
                          confirm={`Restore ${e.display_value ?? e.normalized_value} to active?`}
                          busy={busy}
                          onGo={() =>
                            actions.onRestoreEndpoint?.(
                              e.id,
                              "operator restored from Control Plane UI",
                            )
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card
              title="Unclassified provider metadata — not eligible for canonical endpoint import"
              right={
                <span className="text-[11px] text-muted-foreground">
                  {evidence.length} record(s)
                </span>
              }
            >
              <p className="mb-2 text-xs text-muted-foreground">
                Raw provider references seen in call metadata. These are API URLs/opaque ids, not
                dialable numbers — preserved as evidence, never promoted to a canonical endpoint
                without an operator entering and validating the real typed value.
              </p>
              <div className="divide-y divide-hairline">
                {evidence.map((r) => (
                  <div key={r.id} className="py-2 text-xs">
                    <div className="font-medium text-display">
                      {r.canonical_type} · {r.label ?? r.external_ref}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {r.provider} · {r.external_ref} · {r.discovery_source}
                    </div>
                  </div>
                ))}
                {evidence.length === 0 && (
                  <p className="py-2 text-xs italic text-muted-foreground">No provider evidence.</p>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* ── Email (Communications › Email) ───────────────────────── */}
        {section === "communications" && commTab === "email" && (
          <Card
            title="Email"
            right={
              writeCapable && actions.onDiscoverEmail ? (
                <ConfirmButton
                  label="Run email discovery"
                  confirm="Re-run approved-domain email discovery? (read-only against Google Workspace)"
                  busy={busy}
                  onGo={() =>
                    actions.onDiscoverEmail?.("operator email discovery from Control Plane UI")
                  }
                />
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  {email.length} endpoint(s)
                </span>
              )
            }
          >
            <p className="mb-3 text-xs text-muted-foreground">
              Classification is from provider metadata (not the address text). Identity links are
              <strong> review-only</strong> — confirming a link records who the mailbox represents
              and never creates ownership. Ownership is configured separately.
            </p>
            <div className="space-y-2">
              {email.map((e) => (
                <EmailRow
                  key={e.id}
                  e={e}
                  cls={classByEndpoint.get(e.id)}
                  suggestion={suggestionByEndpoint.get(e.id)}
                  review={reviewByEndpoint.get(e.id)}
                  members={members}
                  writeCapable={writeCapable}
                  busy={busy}
                  onReview={actions.onReviewIdentity}
                />
              ))}
              {email.length === 0 && (
                <p className="py-2 text-xs italic text-muted-foreground">No email endpoints.</p>
              )}
            </div>
          </Card>
        )}

        {/* ── Slack (Communications › Slack) ───────────────────────── */}
        {section === "communications" && commTab === "slack" && (
          <Card title="Slack">
            <p className="text-xs text-muted-foreground">
              {connections?.slack.note ?? "Identity model ready — ingestion not connected"}
            </p>
          </Card>
        )}

        {/* ── Ownership ────────────────────────────────────────────── */}
        {section === "ownership" && (
          <Card
            title="Ownership"
            right={
              <span className="text-[11px] text-muted-foreground">
                {ownershipComplete}/{active.length} ownership-complete
              </span>
            }
          >
            <p className="mb-3 text-xs text-muted-foreground">
              Ownership is <strong>separate</strong> from identity. An endpoint is
              ownership-complete only when all four roles — accountable, primary handler, cover,
              escalation — are actively assigned. Each role is its own governed assignment.
            </p>
            <div className="space-y-3">
              {active.map((e) => (
                <OwnershipEndpoint
                  key={e.id}
                  e={e}
                  assignments={ownership.filter(
                    (o) => o.endpoint_id === e.id && o.review_state !== "rejected",
                  )}
                  members={members}
                  writeCapable={writeCapable}
                  busy={busy}
                  selected={selectedEndpoint === e.id}
                  onSelect={onSelectEndpoint}
                  onAssign={actions.onAssign}
                  onEnd={actions.onEndOwnership}
                />
              ))}
              {active.length === 0 && <Empty>No active endpoints.</Empty>}
            </div>
          </Card>
        )}

        {/* ── Company ──────────────────────────────────────────────── */}
        {section === "company" && (
          <Card title="Company">
            <p className="mb-3 text-xs text-muted-foreground">
              Tenant identity and operating context. Fields not yet captured show as configuration
              gaps — no value is fabricated.
            </p>
            <dl className="grid grid-cols-1 gap-y-1.5 text-xs sm:grid-cols-2">
              <ConnRowsInline k="Display name" v={summary.display_name ?? "—"} />
              <ConnRowsInline k="Tenant slug" v={summary.slug ?? "—"} />
              <ConnRowsInline
                k="Approved email domains"
                v={connections?.google_workspace.approved_domains.join(", ") || "—"}
              />
              <ConnRowsInline k="People" v={String(summary.people)} />
              <ConnRowsInline k="Locations" v={<Gap />} />
              <ConnRowsInline k="Business hours" v={<Gap />} />
              <ConnRowsInline k="Departments / teams" v={<Gap />} />
              <ConnRowsInline k="Primary / escalation contacts" v={<Gap />} />
              <ConnRowsInline k="Timezone" v={<Gap />} />
              <ConnRowsInline k="Data region" v={<Gap />} />
            </dl>
            <Warn>
              Company profile is partially configured — locations, hours, departments, contacts,
              timezone and data region are not yet captured for this tenant.
            </Warn>
          </Card>
        )}

        {/* ── Agents ───────────────────────────────────────────────── */}
        {section === "agents" && (
          <Card title="Agents">
            <p className="text-xs text-muted-foreground">
              No agents are configured for this tenant. Agent capabilities are governed by readiness
              and remain unavailable until their source connections reach production — nothing is
              active.
            </p>
          </Card>
        )}

        {/* ── Automations ──────────────────────────────────────────── */}
        {section === "automations" && (
          <Card title="Automations">
            <p className="text-xs text-muted-foreground">
              No automations are active for this tenant. The Automation Engine is frozen for this
              increment; no automation runs, and no external side effects occur.
            </p>
          </Card>
        )}

        {/* ── Health ───────────────────────────────────────────────── */}
        {section === "health" && (
          <div className="space-y-4">
            <Card title={`Configuration readiness — ${tenantName}`}>
              {readiness ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={cn("text-sm font-semibold", READINESS_META[readiness.level]?.cls)}
                    >
                      {READINESS_META[readiness.level]?.label ?? readiness.level}
                    </span>
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">{readiness.summary}</p>
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {readiness.checks.map((c) => (
                      <li key={c.key} className="flex items-start gap-1.5 text-xs">
                        {c.ok ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        )}
                        <span className="text-muted-foreground">{c.detail}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Readiness unavailable.</p>
              )}
            </Card>
            <Card title="Customer Health source — preparation only (inactive)">
              <p className="mb-3 text-xs text-muted-foreground">
                Customer Health is prepared but NOT enabled. No Health objects, commitments,
                Actions, Outcomes, notifications or customer contact exist.
              </p>
              <dl className="grid grid-cols-1 gap-y-1.5 text-xs sm:grid-cols-2">
                <ConnRowsInline k="Policy" v="draft" />
                <ConnRowsInline k="Source allowlist" v="disabled" />
                <ConnRowsInline k="Sources" v="empty" />
                <ConnRowsInline k="Processing" v="inactive" />
              </dl>
            </Card>
          </div>
        )}

        {/* ── Security ─────────────────────────────────────────────── */}
        {section === "security" && (
          <div className="space-y-4">
            <Card title="Connection security posture">
              <dl className="grid grid-cols-1 gap-y-1.5 text-xs sm:grid-cols-2">
                <ConnRowsInline k="Active connections" v={String(connectedCount)} />
                <ConnRowsInline k="Connections needing action" v={String(connActionCount)} />
                <ConnRowsInline
                  k="External write / provisioning"
                  v={connViews.some((c) => c.externalWrite) ? "enabled on some" : "disabled"}
                />
                <ConnRowsInline k="Secret storage" v="server-side broker (references only)" />
                <ConnRowsInline k="Customer-admin invitations" v="0" />
                <ConnRowsInline k="Processing source" v="inactive" />
              </dl>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Raw credentials are never displayed. Revocation / disable are operator-only controls
                (server-enforced) and are not exposed in this read-only projection.
              </p>
            </Card>
            {connViews.some((c) => c.warnings.length > 0) && (
              <Card title="Cross-tenant boundary warnings">
                <ul className="space-y-1.5">
                  {connViews.flatMap((c) =>
                    c.warnings.map((w, i) => (
                      <li
                        key={`${c.id}-${i}`}
                        className="flex items-start gap-1.5 text-xs text-amber-700"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">{c.providerLabel}:</span> {w}
                        </span>
                      </li>
                    )),
                  )}
                </ul>
              </Card>
            )}
          </div>
        )}

        {/* ── Data Quality ─────────────────────────────────────────── */}
        {section === "data_quality" && (
          <div className="space-y-4">
            {connectionIssues.length > 0 && (
              <Card
                title="Connection issues"
                right={
                  <span className="text-[11px] text-muted-foreground">
                    {connectionIssues.length}
                  </span>
                }
              >
                <ul className="space-y-1.5">
                  {connectionIssues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="text-muted-foreground">
                        <span className="font-medium text-display">
                          {issue.kind.replace(/_/g, " ")}
                        </span>{" "}
                        — {issue.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card
              title="Data Quality"
              right={
                <span className="text-[11px] text-muted-foreground">
                  {new Set(dataQuality.map((d) => d.kind)).size} categories · {dataQuality.length}{" "}
                  items
                </span>
              }
            >
              {dataQuality.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">No data-quality issues.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(
                    dataQuality.reduce(
                      (acc, d) => {
                        (acc[d.kind] ??= []).push(d);
                        return acc;
                      },
                      {} as Record<string, DataQualityItem[]>,
                    ),
                  )
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([kind, list]) => (
                      <details
                        key={kind}
                        className="rounded-md bg-surface-alt/50 px-2.5 py-1.5 text-xs"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            <span className="font-medium text-display">
                              {kind.replace(/_/g, " ")}
                            </span>
                          </span>
                          <span className="tabular text-muted-foreground">{list.length}</span>
                        </summary>
                        <ul className="mt-1 space-y-0.5 pl-5">
                          {list.slice(0, 50).map((d, i) => (
                            <li key={i} className="text-muted-foreground">
                              {d.detail}
                              {d.ref && (
                                <span className="text-muted-foreground/50">
                                  {" "}
                                  · {d.ref.slice(0, 8)}
                                </span>
                              )}
                            </li>
                          ))}
                          {list.length > 50 && (
                            <li className="italic text-muted-foreground/60">
                              +{list.length - 50} more
                            </li>
                          )}
                        </ul>
                      </details>
                    ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── Audit ────────────────────────────────────────────────── */}
        {section === "audit" && <AuditPanel audit={audit} />}
      </div>
    </div>
  );
}

function ConnRowsInline({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-44 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="font-medium text-display">{v}</dd>
    </div>
  );
}
function Gap() {
  return <span className="italic text-amber-700">not configured</span>;
}
function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-700">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {children}
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="py-1 text-xs italic text-muted-foreground">{children}</p>;
}
function SubHead({ children }: { children: ReactNode }) {
  return (
    <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}
// ── Ownership: one endpoint with its four required roles + governed end/assign. ──
// The active role-form + inline success live here (not in the route), so confirming a role
// refreshes the data in place, keeps this endpoint selected/expanded, shows success, and
// moves focus to the next missing role — never back to Overview.
function OwnershipEndpoint({
  e,
  assignments,
  members,
  writeCapable,
  busy,
  selected,
  onSelect,
  onAssign,
  onEnd,
}: {
  e: CpEndpoint;
  assignments: CpOwnership[];
  members: CpMember[];
  writeCapable: boolean;
  busy: boolean;
  selected: boolean;
  onSelect?: (endpointId: string | null) => void;
  onAssign?: WorkspaceActions["onAssign"];
  onEnd?: NonNullable<WorkspaceActions["onEndOwnership"]>;
}) {
  const byRole = new Map<string, CpOwnership>();
  for (const a of assignments) if (!byRole.has(a.assignment_role)) byRole.set(a.assignment_role, a);
  const complete = isOwnershipComplete(byRole.keys());
  // Separation-of-duties: warn only on genuine concentration — NOT for the expected
  // accountable == primary_handler pairing on a personal mailbox. Team-owned roles
  // (owner_member_id null) never count toward person concentration.
  const roleOwners = Object.fromEntries(
    REQUIRED_ROLES.map((r) => [r, byRole.get(r)?.owner_member_id ?? null]),
  ) as Partial<Record<OwnRole, string | null>>;
  const concentration = evaluateConcentration(roleOwners);

  // Which role's assign-form is open, which role just succeeded (inline success + autofocus).
  const [openRole, setOpenRole] = useState<OwnRole | null>(null);
  const [savedRole, setSavedRole] = useState<OwnRole | null>(null);
  const [focusRole, setFocusRole] = useState<OwnRole | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Keep the endpoint the operator is working on in view after a confirmation, without a
  // jarring jump (block:'nearest' preserves scroll where practical).
  useEffect(() => {
    if (savedRole) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [savedRole]);

  const openFor = (role: OwnRole) => {
    onSelect?.(e.id);
    setSavedRole(null);
    setFocusRole(null);
    setOpenRole(role);
  };
  const handleAssign = useCallback(
    async (role: OwnRole, memberId: string, reason: string): Promise<boolean> => {
      if (!onAssign) return false;
      onSelect?.(e.id);
      const ok = (await onAssign(e.id, memberId, role, reason)) !== false;
      if (ok) {
        setSavedRole(role);
        // Optimistically advance: byRole doesn't yet include `role` until the refetch lands.
        const next = nextMissingRole(byRole.keys(), role);
        setOpenRole(next);
        setFocusRole(next);
      }
      return ok;
    },
    // byRole is derived each render from the latest assignments prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onAssign, onSelect, e.id, assignments],
  );

  const savedNext = savedRole ? nextMissingRole(byRole.keys()) : null;

  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-lg border bg-surface-alt/40 p-3 transition-colors",
        selected ? "border-accent/60 ring-1 ring-accent/30" : "border-hairline",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-display">
          <span className="text-muted-foreground">{e.endpoint_kind}</span> ·{" "}
          {e.display_value ?? e.normalized_value}
        </span>
        {complete ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-success/30 px-2 py-0.5 text-[11px] text-success">
            <CheckCircle2 className="h-3 w-3" /> ownership complete
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[11px] text-amber-700">
            <AlertTriangle className="h-3 w-3" /> incomplete
          </span>
        )}
      </div>
      {/* Inline success state — persists after the in-place refresh (no page/section reset). */}
      {savedRole && (
        <div
          role="status"
          className="mb-2 flex items-center gap-1.5 rounded-md border border-success/30 bg-success/5 px-2.5 py-1 text-[11px] text-success"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {savedRole.replace(/_/g, " ")} confirmed
          {savedNext
            ? ` — next: ${savedNext.replace(/_/g, " ")}`
            : complete
              ? " — ownership complete"
              : ""}
        </div>
      )}
      <div className="space-y-1.5">
        {REQUIRED_ROLES.map((role) => {
          const a = byRole.get(role);
          return (
            <div key={role} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-28 shrink-0 font-medium text-display">
                {role.replace(/_/g, " ")}
              </span>
              {a ? (
                <>
                  <span className="text-muted-foreground">
                    {a.owner_kind === "team" ? "team" : memberName(members, a.owner_member_id)}
                  </span>
                  {savedRole === role && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="just assigned" />
                  )}
                  {writeCapable && onEnd && (
                    <EndAssignmentControl a={a} busy={busy} onEnd={onEnd} />
                  )}
                </>
              ) : (
                <>
                  <span className="text-amber-700">missing</span>
                  {writeCapable && onAssign && (
                    <AssignRole
                      role={role}
                      members={members}
                      busy={busy}
                      open={openRole === role}
                      autoFocus={focusRole === role}
                      onOpen={() => openFor(role)}
                      onCancel={() => setOpenRole(null)}
                      onSubmit={handleAssign}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {concentration.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {concentration.map((f, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
                f.severity === "critical"
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "border-amber-500/30 bg-amber-500/5 text-amber-700",
              )}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium">
                  {f.severity === "critical" ? "Critical concentration: " : "Concentration: "}
                </span>
                {concentrationReason(f, members)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Precise, human reason for a concentration finding — names the person and roles involved.
function concentrationReason(f: ConcentrationFinding, members: CpMember[]): string {
  const name = memberName(members, f.member_id);
  const roleList = f.roles.map((r) => r.replace(/_/g, " ")).join(", ");
  switch (f.code) {
    case "single_person_all":
      return `${name} holds all four ownership roles — no separation of duties`;
    case "holds_three_roles":
      return `${name} holds three roles (${roleList}) — limited separation of duties`;
    case "primary_equals_cover":
      return `Primary handler and cover are both ${name} — no handling fallback`;
    case "cover_equals_escalation":
      return `Cover and escalation are both ${name} — escalation has no independent fallback`;
    case "threshold_exceeded":
      return `${name} holds ${f.roles.length} ownership roles (${roleList}), over the configured limit`;
  }
}

function AssignRole({
  role,
  members,
  busy,
  open,
  autoFocus,
  onOpen,
  onCancel,
  onSubmit,
}: {
  role: OwnRole;
  members: CpMember[];
  busy: boolean;
  open: boolean;
  autoFocus: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onSubmit: (role: OwnRole, memberId: string, reason: string) => Promise<boolean>;
}) {
  const [member, setMember] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  // When this form is opened by advancing from the previous role, move focus straight here.
  useEffect(() => {
    if (open && autoFocus) selectRef.current?.focus();
  }, [open, autoFocus]);

  if (!open)
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md border border-hairline bg-white px-2 py-0.5 text-[10px] text-muted-foreground hover:text-display"
      >
        Assign
      </button>
    );

  const disabled = busy || pending || !member || !reason.trim();
  const submit = async () => {
    if (disabled) return;
    setPending(true);
    const ok = await onSubmit(role, member, reason);
    setPending(false);
    // Clear only THIS role's temporary form state after a successful confirm.
    if (ok) {
      setMember("");
      setReason("");
    }
  };

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select
        ref={selectRef}
        value={member}
        onChange={(ev) => setMember(ev.target.value)}
        className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
      >
        <option value="">person…</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(ev) => setReason(ev.target.value)}
        placeholder="reason"
        className="w-28 rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        className="rounded-md border border-accent bg-accent px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50"
      >
        {pending ? "Confirming…" : "Confirm"}
      </button>
      <button type="button" onClick={onCancel} className="text-[10px] text-muted-foreground">
        cancel
      </button>
    </span>
  );
}

// End an OWNERSHIP assignment: explicit effective-end date, reason, confirmation. The
// assignment's updated_at is the optimistic-concurrency token; history is never deleted.
function EndAssignmentControl({
  a,
  busy,
  onEnd,
}: {
  a: CpOwnership;
  busy: boolean;
  onEnd: NonNullable<WorkspaceActions["onEndOwnership"]>;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-hairline bg-white px-2 py-0.5 text-[10px] text-muted-foreground hover:text-display"
      >
        End
      </button>
    );
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-hairline bg-white px-1.5 py-0.5 text-[10px]"
        title="effective end date (defaults to now)"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="reason"
        className="w-28 rounded-md border border-hairline bg-white px-2 py-0.5 text-[10px]"
      />
      <button
        type="button"
        disabled={busy || !reason.trim()}
        onClick={() =>
          onEnd({
            assignment_id: a.id,
            effective_to: date ? new Date(date).toISOString() : null,
            expected_updated_at: a.updated_at ?? null,
            reason,
          })
        }
        className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium text-amber-700 disabled:opacity-50"
      >
        Confirm end
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[10px] text-muted-foreground"
      >
        cancel
      </button>
    </span>
  );
}

function PersonRow({
  member,
  identities,
  ownership,
  ownershipHistory,
  endpoints,
  suggestions,
  reviews,
}: {
  member: CpMember;
  identities: CpIdentity[];
  ownership: CpOwnership[];
  ownershipHistory: CpOwnership[];
  endpoints: CpEndpoint[];
  suggestions: IdentitySuggestion[];
  reviews: ReviewRow[];
}) {
  const [open, setOpen] = useState(false);
  const epLabel = (id: string) => {
    const e = endpoints.find((x) => x.id === id);
    return e ? (e.display_value ?? e.normalized_value) : id.slice(0, 8);
  };
  // ── Identity (who this endpoint represents) — kept visibly separate from ownership. ──
  const confirmedIds = identities.filter((i) => i.team_member_id === member.id);
  const latestReviewByEp = new Map<string, string>();
  for (const r of reviews)
    if (!latestReviewByEp.has(r.endpoint_id)) latestReviewByEp.set(r.endpoint_id, r.decision);
  const pending = suggestions.filter(
    (s) =>
      s.suggested_member_id === member.id &&
      s.suggested_kind === "person" &&
      !latestReviewByEp.has(s.endpoint_id),
  );
  const rejected = reviews.filter(
    (r) => r.team_member_id === member.id && r.decision === "rejected",
  );
  // ── Ownership (who is accountable) — the OTHER axis. ──
  const activeOwn = ownership.filter((o) => o.owner_member_id === member.id);
  const histOwn = ownershipHistory.filter((o) => o.owner_member_id === member.id);
  const warnings: string[] = [];
  if (confirmedIds.length === 0) warnings.push("no confirmed identity link");
  if (activeOwn.length === 0) warnings.push("holds no active ownership role");
  // concentration: multiple roles on the same endpoint
  const perEp = new Map<string, number>();
  for (const o of activeOwn) perEp.set(o.endpoint_id, (perEp.get(o.endpoint_id) ?? 0) + 1);
  const concentrated = [...perEp.values()].some((n) => n >= 3);
  if (concentrated) warnings.push("holds 3+ roles on one endpoint (concentration)");

  return (
    <div className="py-2 text-sm">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium text-display">{member.display_name}</span>
        <span className="text-xs text-muted-foreground">
          {member.formal_role ?? "—"} · {confirmedIds.length} identity · {activeOwn.length} role(s)
          {warnings.length > 0 && <span className="text-amber-600"> · ⚠ {warnings.length}</span>}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <div className="text-muted-foreground">
            {member.effective_to ? "Inactive member" : "Active member"} · linked profile:{" "}
            {member.org_unit_id ? "team unit set" : "—"}
          </div>

          {/* IDENTITY panel */}
          <div className="rounded-md border border-hairline bg-surface-alt/40 p-2.5">
            <div className="mb-1 font-semibold text-display">
              Identity — who endpoints represent
            </div>
            <div className="mb-1 text-[11px] text-muted-foreground">Confirmed identity links</div>
            {confirmedIds.length === 0 ? (
              <p className="italic text-muted-foreground">
                None. Matches are proposed with confidence + evidence, never auto-confirmed.
              </p>
            ) : (
              <ul className="space-y-1">
                {confirmedIds.map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <span className="font-medium text-display">{i.provider}</span>
                    <span className="text-muted-foreground">{i.external_ref}</span>
                    <span
                      className={cn(
                        "ml-auto rounded-full border px-1.5 py-0.5 text-[10px]",
                        i.verification_state === "verified"
                          ? "border-success/30 text-success"
                          : "border-amber-500/30 text-amber-700",
                      )}
                    >
                      {i.verification_state}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 && (
              <>
                <div className="mb-1 mt-2 text-[11px] text-muted-foreground">
                  Pending suggestions
                </div>
                <ul className="space-y-0.5">
                  {pending.map((s) => (
                    <li key={s.endpoint_id} className="text-amber-700">
                      {s.endpoint_email} · {s.confidence} · {s.evidence}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {rejected.length > 0 && (
              <>
                <div className="mb-1 mt-2 text-[11px] text-muted-foreground">
                  Rejected suggestions
                </div>
                <ul className="space-y-0.5">
                  {rejected.map((r, i) => (
                    <li key={i} className="text-muted-foreground line-through">
                      {epLabel(r.endpoint_id)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* OWNERSHIP panel */}
          <div className="rounded-md border border-hairline bg-surface-alt/40 p-2.5">
            <div className="mb-1 font-semibold text-display">
              Ownership — operational accountability
            </div>
            <div className="mb-1 text-[11px] text-muted-foreground">Active roles</div>
            {activeOwn.length === 0 ? (
              <p className="italic text-muted-foreground">No active ownership roles.</p>
            ) : (
              <ul className="space-y-0.5">
                {activeOwn.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[10px] text-display">
                      {o.assignment_role}
                    </span>
                    <span className="text-muted-foreground">{epLabel(o.endpoint_id)}</span>
                  </li>
                ))}
              </ul>
            )}
            {histOwn.length > 0 && (
              <>
                <div className="mb-1 mt-2 text-[11px] text-muted-foreground">
                  Historical (ended) roles
                </div>
                <ul className="space-y-0.5">
                  {histOwn.map((o) => (
                    <li key={o.id} className="text-muted-foreground">
                      {o.assignment_role} · {epLabel(o.endpoint_id)} · ended{" "}
                      {o.effective_to ? new Date(o.effective_to).toLocaleDateString() : "—"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {warnings.length > 0 && <Warn>Unresolved: {warnings.join("; ")}</Warn>}
        </div>
      )}
    </div>
  );
}

function EndpointRow({
  e,
  acc,
  members,
  writeCapable,
  busy,
  onArchive,
  onAssign,
  onUpdate,
  onValidate,
}: {
  e: CpEndpoint;
  acc: Workspace["ownership"][number] | null;
  members: CpMember[];
  writeCapable: boolean;
  busy: boolean;
  onArchive?: (endpointId: string, reason: string) => void;
  onAssign?: (endpointId: string, memberId: string, role: string, reason: string) => void;
  onUpdate?: NonNullable<WorkspaceActions["onUpdateEndpoint"]>;
  onValidate?: NonNullable<WorkspaceActions["onValidateEndpoint"]>;
}) {
  const [editing, setEditing] = useState(false);
  const editable = e.source === "manual"; // provider-discovered evidence is NOT editable
  return (
    <div className="rounded-lg border border-hairline bg-surface-alt/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-display">
          <span className="text-muted-foreground">{e.endpoint_kind}</span> ·{" "}
          {e.display_value ?? e.normalized_value}
          {e.provider && (
            <span className="ml-1 text-[11px] text-muted-foreground">({e.provider})</span>
          )}
          <span className="ml-1 text-[10px] text-muted-foreground/70">[{e.source}]</span>
        </span>
        <span className="flex items-center gap-1.5">
          {acc ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white px-2 py-0.5 text-[11px] text-success">
              <CheckCircle2 className="h-3 w-3" />{" "}
              {acc.owner_kind === "team" ? "team" : memberName(members, acc.owner_member_id)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[11px] text-amber-700">
              <AlertTriangle className="h-3 w-3" /> unmapped
            </span>
          )}
          {writeCapable && onUpdate && editable && !editing && (
            <button
              disabled={busy}
              onClick={() => setEditing(true)}
              className="rounded-md border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-display disabled:opacity-50"
            >
              Edit
            </button>
          )}
          {writeCapable && onArchive && (
            <ConfirmButton
              label="Archive"
              variant="ghost"
              confirm={`Archive ${e.display_value ?? e.normalized_value}? It is deactivated (history kept), not deleted.`}
              busy={busy}
              onGo={() => onArchive(e.id, "operator archived from Control Plane UI")}
            />
          )}
        </span>
      </div>
      {writeCapable && onUpdate && editable && editing && (
        <EditEndpointForm
          e={e}
          busy={busy}
          onValidate={onValidate}
          onUpdate={onUpdate}
          onClose={() => setEditing(false)}
        />
      )}
      {writeCapable && onUpdate && !editable && editing && (
        <p className="mt-2 text-[11px] text-amber-700">
          Provider-discovered evidence is not editable.
        </p>
      )}
      {writeCapable && onAssign && !acc && (
        <MapControl endpointId={e.id} members={members} onAssign={onAssign} busy={busy} />
      )}
    </div>
  );
}

// Edit a MANUAL endpoint: validation preview, optimistic-concurrency token (updated_at),
// save/cancel, explicit stale-write + no-op handling.
function EditEndpointForm({
  e,
  busy,
  onValidate,
  onUpdate,
  onClose,
}: {
  e: CpEndpoint;
  busy: boolean;
  onValidate?: NonNullable<WorkspaceActions["onValidateEndpoint"]>;
  onUpdate: NonNullable<WorkspaceActions["onUpdateEndpoint"]>;
  onClose: () => void;
}) {
  const [display, setDisplay] = useState(e.display_value ?? "");
  const [ctx, setCtx] = useState(e.provider ?? "");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<EndpointValidation | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "err"; msg: string } | null>(null);

  const dirty = display !== (e.display_value ?? "") || ctx !== (e.provider ?? "");

  const doValidate = async () => {
    if (!onValidate) return;
    setResult(null);
    setPreview(
      await onValidate({
        endpoint_kind: e.endpoint_kind,
        value: e.normalized_value,
        display_value: display,
        provider_context: ctx,
      }),
    );
  };
  const doSave = async () => {
    setResult(null);
    const res = await onUpdate({
      endpoint_id: e.id,
      display_value: display,
      provider_context: ctx,
      expected_updated_at: e.updated_at, // optimistic-concurrency token
      reason,
    });
    if (!res.ok) {
      const stale = /stale_write/i.test(res.error ?? "");
      setResult({
        tone: "err",
        msg: stale
          ? "Stale write — this endpoint changed since you opened it. Reload and retry."
          : (res.error ?? "Save failed"),
      });
      return;
    }
    if (res.outcome === "unchanged")
      setResult({ tone: "warn", msg: "No changes — nothing to save (no audit written)." });
    else {
      setResult({ tone: "ok", msg: "Saved." });
      onClose();
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-hairline bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-display">Edit manual endpoint</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-muted-foreground">
          Display label
          <input
            value={display}
            onChange={(ev) => setDisplay(ev.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Provider / account context
          <input
            value={ctx}
            onChange={(ev) => setCtx(ev.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
          />
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        Dialable value ({e.normalized_value}) is immutable — archive + re-add to change it.
      </p>
      {preview && (
        <div
          className={cn(
            "mt-2 rounded-md border px-2.5 py-1.5 text-xs",
            preview.valid
              ? "border-success/30 bg-success/5 text-success"
              : "border-destructive/30 bg-destructive/5 text-destructive",
          )}
        >
          {preview.valid ? (
            <>
              Valid → {preview.canonical} ({preview.kind})
            </>
          ) : (
            <>Rejected: {(preview.errors ?? []).join("; ")}</>
          )}
        </div>
      )}
      {result && (
        <div
          className={cn(
            "mt-2 text-xs",
            result.tone === "ok"
              ? "text-success"
              : result.tone === "warn"
                ? "text-amber-600"
                : "text-destructive",
          )}
        >
          {result.msg}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {onValidate && (
          <button
            disabled={busy}
            onClick={doValidate}
            className="rounded-md border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-surface-alt disabled:opacity-50"
          >
            Validation preview
          </button>
        )}
        <input
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="reason (required)"
          className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
        />
        <button
          disabled={busy || !reason.trim() || !dirty}
          onClick={doSave}
          className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onClose}
          className="ml-auto rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-display"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const CONF_META: Record<string, string> = {
  high: "text-success",
  medium: "text-amber-600",
  low: "text-amber-600",
  unresolved: "text-muted-foreground",
};

function RButton({
  label,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  tone?: "ok" | "warn";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[10px] font-medium disabled:opacity-40",
        tone === "ok"
          ? "border-accent bg-accent text-white"
          : tone === "warn"
            ? "border-amber-500/40 text-amber-700"
            : "border-hairline text-muted-foreground hover:text-display",
      )}
    >
      {label}
    </button>
  );
}

function EmailRow({
  e,
  cls,
  suggestion,
  review,
  members,
  writeCapable,
  busy,
  onReview,
}: {
  e: CpEndpoint;
  cls?: EmailClassification;
  suggestion?: IdentitySuggestion;
  review?: { decision: string; team_member_id: string | null };
  members: CpMember[];
  writeCapable: boolean;
  busy: boolean;
  onReview?: NonNullable<WorkspaceActions["onReviewIdentity"]>;
}) {
  const [reason, setReason] = useState("");
  const [person, setPerson] = useState("");
  const suggestedName = suggestion?.suggested_member_id
    ? memberName(members, suggestion.suggested_member_id)
    : null;
  const decided = review?.decision;
  const chosen = person || suggestion?.suggested_member_id || null;
  const doReview = (
    decision: "confirmed_person" | "shared" | "system" | "rejected" | "unresolved",
    member: string | null,
  ) => {
    if (!onReview || !reason.trim()) return;
    onReview({
      endpoint_id: e.id,
      decision,
      team_member_id: member,
      confidence: suggestion?.confidence,
      reason,
    });
    setReason("");
  };
  return (
    <div className="rounded-lg border border-hairline bg-surface-alt/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-display">
          {e.display_value ?? e.normalized_value}
        </span>
        <span className="flex items-center gap-1.5">
          {cls && (
            <span
              className="rounded-full border border-hairline px-2 py-0.5 text-[10px] text-muted-foreground"
              title="raw provider mailbox type"
            >
              {PROVIDER_TYPE_LABEL[cls.provider_mailbox_type]}
            </span>
          )}
          {cls && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px]",
                OPCLASS_META[cls.operational_class].cls,
              )}
              title="operational classification (from reviewed evidence)"
            >
              {OPCLASS_META[cls.operational_class].label}
              {!cls.operational_reviewed && "?"}
            </span>
          )}
          {decided ? (
            <span className="rounded-full border border-success/30 px-2 py-0.5 text-[10px] text-success">
              identity: {decided}
            </span>
          ) : (
            <span className="rounded-full border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-700">
              identity: unreviewed
            </span>
          )}
        </span>
      </div>
      {suggestion && !decided && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          Suggestion:{" "}
          {suggestion.suggested_kind === "person" && suggestedName ? (
            <span className="font-medium text-display">{suggestedName}</span>
          ) : (
            <span>{suggestion.suggested_kind}</span>
          )}{" "}
          · <span className={CONF_META[suggestion.confidence]}>{suggestion.confidence}</span> ·{" "}
          {suggestion.evidence}
        </div>
      )}
      {writeCapable && onReview && !decided && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder="reason (required)"
            className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
          />
          <select
            value={person}
            onChange={(ev) => setPerson(ev.target.value)}
            className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
          >
            <option value="">{suggestedName ? `use ${suggestedName}` : "choose person…"}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
          <RButton
            label="Confirm person"
            tone="ok"
            disabled={busy || !reason.trim() || !chosen}
            onClick={() => doReview("confirmed_person", chosen)}
          />
          <RButton
            label="Shared"
            disabled={busy || !reason.trim()}
            onClick={() => doReview("shared", null)}
          />
          <RButton
            label="System"
            disabled={busy || !reason.trim()}
            onClick={() => doReview("system", null)}
          />
          <RButton
            label="Reject"
            tone="warn"
            disabled={busy || !reason.trim()}
            onClick={() => doReview("rejected", chosen)}
          />
          <RButton
            label="Unresolved"
            disabled={busy || !reason.trim()}
            onClick={() => doReview("unresolved", null)}
          />
        </div>
      )}
    </div>
  );
}

const CATS: { key: string; label: string; match: (a: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  {
    key: "connection",
    label: "Connections",
    match: (a) => a.includes("connection") || a.includes("authoris") || a.includes("verif"),
  },
  { key: "discovery", label: "Discovery runs", match: (a) => a.includes("discovery") },
  {
    key: "delegated",
    label: "Delegated setup",
    match: (a) => a.includes("delegat") || a.includes("invitation") || a.includes("setup"),
  },
  { key: "endpoint", label: "Endpoint changes", match: (a) => a.includes("endpoint") },
  { key: "ownership", label: "Ownership", match: (a) => a.includes("ownership") },
  {
    key: "identity",
    label: "Identity",
    match: (a) => a.includes("identity") || a.includes("member"),
  },
  {
    key: "config",
    label: "Config / capability",
    match: (a) => a.includes("authority") || a.includes("config") || a.includes("capability"),
  },
];
function AuditPanel({ audit }: { audit: AuditEntry[] }) {
  const [cat, setCat] = useState("all");
  const m = CATS.find((c) => c.key === cat)!;
  const rows = audit.filter((a) => m.match(a.action));
  return (
    <Card
      title="Audit — configuration changes"
      right={<Database className="h-4 w-4 text-muted-foreground" />}
    >
      <div className="mb-3 flex flex-wrap gap-1">
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px]",
              cat === c.key
                ? "border-accent bg-accent/10 text-accent"
                : "border-hairline text-muted-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="divide-y divide-hairline">
        {rows.map((a, i) => (
          <div key={i} className="py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-display">{a.action}</span>
              <span className="tabular text-muted-foreground">
                {new Date(a.created_at).toLocaleString()}
              </span>
            </div>
            <div className="text-muted-foreground">
              {a.actor} · {a.resource_type} · {a.reason ?? "—"}
              {a.view_as_active && <span className="text-amber-600"> · (View-As)</span>}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-2 text-xs italic text-muted-foreground">No matching changes.</p>
        )}
      </div>
    </Card>
  );
}

// ── Operator review queue: one email endpoint at a time, every decision explicit + audited.
// No bulk approval. "Next unresolved" jumps to the next undecided item.
function ReviewQueue({
  email,
  members,
  classByEndpoint,
  suggestionByEndpoint,
  reviewByEndpoint,
  accountableFor,
  writeCapable,
  busy,
  onReview,
}: {
  email: CpEndpoint[];
  members: CpMember[];
  classByEndpoint: Map<string, EmailClassification>;
  suggestionByEndpoint: Map<string, IdentitySuggestion>;
  reviewByEndpoint: Map<string, { decision: string; team_member_id: string | null }>;
  accountableFor: (endpointId: string) => CpOwnership | null;
  writeCapable: boolean;
  busy: boolean;
  onReview?: NonNullable<WorkspaceActions["onReviewIdentity"]>;
}) {
  const [idx, setIdx] = useState(0);
  const [reason, setReason] = useState("");
  const [person, setPerson] = useState("");
  const isUnresolved = (e: CpEndpoint) => {
    const d = reviewByEndpoint.get(e.id)?.decision;
    return !d || d === "unresolved" || d === "rejected";
  };
  const unresolvedCount = email.filter(isUnresolved).length;

  if (email.length === 0)
    return (
      <Card title="Operator review queue">
        <Empty>No email endpoints to review.</Empty>
      </Card>
    );

  const clamp = (n: number) => (n + email.length) % email.length;
  const e = email[clamp(idx)];
  const cls = classByEndpoint.get(e.id);
  const suggestion = suggestionByEndpoint.get(e.id);
  const review = reviewByEndpoint.get(e.id);
  const acc = accountableFor(e.id);
  const suggestedName = suggestion?.suggested_member_id
    ? memberName(members, suggestion.suggested_member_id)
    : null;
  const chosen = person || suggestion?.suggested_member_id || null;

  const gotoNextUnresolved = () => {
    for (let i = 1; i <= email.length; i++) {
      const j = clamp(idx + i);
      if (isUnresolved(email[j])) {
        setIdx(j);
        setReason("");
        setPerson("");
        return;
      }
    }
  };
  const decide = (decision: ReviewDecision, member: string | null) => {
    if (!onReview || !reason.trim()) return;
    onReview({
      endpoint_id: e.id,
      decision,
      team_member_id: member,
      confidence: suggestion?.confidence,
      reason,
    });
    setReason("");
    setPerson("");
    setTimeout(gotoNextUnresolved, 0);
  };

  return (
    <Card
      title="Operator review queue"
      right={
        <span className="text-[11px] text-muted-foreground">
          {unresolvedCount} unresolved · item {clamp(idx) + 1}/{email.length}
        </span>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setIdx(clamp(idx - 1))}
          className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px] text-muted-foreground hover:text-display"
        >
          ← Prev
        </button>
        <button
          onClick={() => setIdx(clamp(idx + 1))}
          className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px] text-muted-foreground hover:text-display"
        >
          Next →
        </button>
        <button
          onClick={gotoNextUnresolved}
          className="rounded-md border border-accent bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent"
        >
          Next unresolved item
        </button>
      </div>

      <div className="rounded-lg border border-hairline bg-surface-alt/40 p-3 text-xs">
        <div className="mb-2 text-sm font-semibold text-display">
          {e.display_value ?? e.normalized_value}
        </div>
        <dl className="grid grid-cols-1 gap-y-1 sm:grid-cols-2">
          <Field k="Email address" v={e.normalized_value} />
          <Field k="Provider display name" v={cls?.provider_display_name ?? "—"} />
          <Field
            k="Provider mailbox type"
            v={cls ? PROVIDER_TYPE_LABEL[cls.provider_mailbox_type] : "—"}
          />
          <Field
            k="Operational classification"
            v={
              cls
                ? `${OPCLASS_META[cls.operational_class].label}${cls.operational_reviewed ? " (reviewed)" : " (unreviewed)"}`
                : "—"
            }
          />
          <Field
            k="Suggested"
            v={
              suggestion
                ? suggestion.suggested_kind === "person" && suggestedName
                  ? suggestedName
                  : suggestion.suggested_kind
                : "—"
            }
          />
          <Field k="Confidence" v={suggestion?.confidence ?? "—"} />
          <Field k="Evidence" v={suggestion?.evidence ?? "—"} wide />
          <Field
            k="Ambiguity"
            v={
              suggestion && suggestion.ambiguity.length > 0
                ? suggestion.ambiguity.map((id) => memberName(members, id)).join(", ")
                : "none"
            }
            wide
          />
          <Field
            k="Identity-link state"
            v={review ? `reviewed: ${review.decision}` : "unreviewed"}
          />
          <Field
            k="Ownership state"
            v={
              acc
                ? `accountable: ${acc.owner_kind === "team" ? "team" : memberName(members, acc.owner_member_id)}`
                : "no accountable owner"
            }
          />
        </dl>

        {writeCapable && onReview ? (
          <div className="mt-3 space-y-2 border-t border-hairline pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
                placeholder="reason (required for every decision)"
                className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
              />
              <select
                value={person}
                onChange={(ev) => setPerson(ev.target.value)}
                className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
                title="Select a different person"
              >
                <option value="">
                  {suggestedName ? `use ${suggestedName}` : "choose person…"}
                </option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <RButton
                label="Confirm identity"
                tone="ok"
                disabled={busy || !reason.trim() || !chosen}
                onClick={() => decide("confirmed_person", chosen)}
              />
              <RButton
                label="Mark shared"
                disabled={busy || !reason.trim()}
                onClick={() => decide("shared", null)}
              />
              <RButton
                label="Mark team/group"
                disabled={busy || !reason.trim()}
                onClick={() => decide("team", null)}
              />
              <RButton
                label="Mark service/system"
                disabled={busy || !reason.trim()}
                onClick={() => decide("system", null)}
              />
              <RButton
                label="Reject suggestion"
                tone="warn"
                disabled={busy || !reason.trim()}
                onClick={() => decide("rejected", chosen)}
              />
              <RButton
                label="Leave unresolved"
                disabled={busy || !reason.trim()}
                onClick={() => decide("unresolved", null)}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Confirm identity records who this mailbox represents — it never creates ownership.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">Read-only (no write authority).</p>
        )}
      </div>
    </Card>
  );
}
function Field({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={cn("flex gap-2", wide && "sm:col-span-2")}>
      <dt className="w-36 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="font-medium text-display">{v}</dd>
    </div>
  );
}

function AddEndpointForm({
  busy,
  onValidate,
  onCreate,
}: {
  busy: boolean;
  onValidate: NonNullable<WorkspaceActions["onValidateEndpoint"]>;
  onCreate: NonNullable<WorkspaceActions["onCreateEndpoint"]>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("ddi");
  const [value, setValue] = useState("");
  const [display, setDisplay] = useState("");
  // No tenant identifier is hard-coded in the UI — the operator supplies the provider/account
  // context (a hint placeholder shows the shape). Discovered connections carry their own.
  const [ctx, setCtx] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<EndpointValidation | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const doValidate = async () => {
    setSaved(null);
    setPreview(
      await onValidate({
        endpoint_kind: kind,
        value,
        display_value: display,
        provider_context: ctx,
      }),
    );
  };
  const doCreate = async () => {
    const ok = await onCreate({
      endpoint_kind: kind,
      value,
      display_value: display,
      provider_context: ctx,
      reason,
    });
    if (ok) {
      setSaved("Added.");
      setValue("");
      setDisplay("");
      setPreview(null);
      setReason("");
    }
  };

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90"
      >
        Add endpoint
      </button>
    );

  return (
    <div className="rounded-lg border border-hairline bg-surface-alt/40 p-3">
      <div className="mb-2 text-xs font-semibold text-display">
        Add manual endpoint (source = manual)
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-muted-foreground">
          Type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-foreground"
          >
            {MANUAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-muted-foreground">
          Provider / account context
          <input
            value={ctx}
            onChange={(e) => setCtx(e.target.value)}
            placeholder="provider:account (e.g. from a connected source)"
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Value (number / extension / id)
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              kind === "ddi" ? "020 7946 0018" : kind === "extension" ? "201" : "identifier"
            }
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Display label (optional; required for queue/ring group)
          <input
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
          />
        </label>
      </div>

      {preview && (
        <div
          className={cn(
            "mt-2 rounded-md border px-2.5 py-1.5 text-xs",
            preview.valid
              ? "border-success/30 bg-success/5 text-success"
              : "border-destructive/30 bg-destructive/5 text-destructive",
          )}
        >
          {preview.valid ? (
            <>
              Valid → <span className="font-mono">{preview.canonical}</span> ({preview.kind})
              {preview.duplicate && (
                <span className="text-amber-700">
                  {" "}
                  · duplicate of an existing {preview.duplicate.source} endpoint
                </span>
              )}
            </>
          ) : (
            <>Rejected: {(preview.errors ?? []).join("; ")}</>
          )}
        </div>
      )}
      {saved && <div className="mt-2 text-xs text-success">{saved}</div>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          disabled={busy}
          onClick={doValidate}
          className="rounded-md border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-surface-alt disabled:opacity-50"
        >
          Validate
        </button>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason (required to save)"
          className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
        />
        <button
          disabled={busy || !preview?.valid || !!preview?.duplicate || !reason.trim()}
          onClick={doCreate}
          className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          Save endpoint
        </button>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-display"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ConfirmButton({
  label,
  confirm,
  onGo,
  busy,
  variant = "solid",
}: {
  label: string;
  confirm: string;
  onGo: () => void;
  busy: boolean;
  variant?: "solid" | "ghost";
}) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="inline-flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground" title={confirm}>
        sure?
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onGo();
          setArmed(false);
        }}
        className="rounded-md border border-accent bg-accent px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50"
      >
        yes
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-[10px] text-muted-foreground"
      >
        no
      </button>
    </span>
  ) : (
    <button
      type="button"
      disabled={busy}
      onClick={() => setArmed(true)}
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] font-medium disabled:opacity-50",
        variant === "solid"
          ? "border border-accent bg-accent text-white hover:bg-accent/90"
          : "border border-hairline bg-white text-muted-foreground hover:text-display",
      )}
    >
      {label}
    </button>
  );
}

function MapControl({
  endpointId,
  members,
  onAssign,
  busy,
}: {
  endpointId: string;
  members: CpMember[];
  onAssign: (endpointId: string, memberId: string, role: string, reason: string) => void;
  busy: boolean;
}) {
  const [member, setMember] = useState("");
  const [role, setRole] = useState("accountable");
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
      >
        {["accountable", "primary_handler", "cover", "escalation"].map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <select
        value={member}
        onChange={(e) => setMember(e.target.value)}
        className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
      >
        <option value="">Assign person…</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="reason (required)"
        className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
      />
      <button
        type="button"
        disabled={busy || !member || !reason.trim()}
        onClick={() => onAssign(endpointId, member, role, reason)}
        className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        Confirm
      </button>
    </div>
  );
}
