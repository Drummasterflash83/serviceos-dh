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
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  History,
  Mail,
  Phone,
  Plug,
  ShieldCheck,
  ShieldQuestion,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AuditEntry,
  CpEndpoint,
  CpIdentity,
  CpMember,
  DataQualityItem,
  EndpointValidation,
  SourceReadiness,
  Workspace,
} from "@/lib/openfolk";

const READINESS_META: Record<string, { label: string; cls: string }> = {
  not_ready: { label: "Not ready", cls: "text-destructive" },
  ready_for_evaluation: { label: "Ready for evaluation", cls: "text-amber-600" },
  ready_for_chris_shadow: { label: "Ready for Chris-only shadow", cls: "text-success" },
  ready_for_staff_pilot: { label: "Ready for staff pilot", cls: "text-success" },
};

type Section =
  | "overview"
  | "people"
  | "connections"
  | "phone"
  | "email"
  | "slack"
  | "ownership"
  | "data_quality"
  | "audit";
const SECTIONS: { key: Section; label: string; icon: ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <Activity className="h-3.5 w-3.5" /> },
  { key: "people", label: "People", icon: <Users className="h-3.5 w-3.5" /> },
  { key: "connections", label: "Connections", icon: <Plug className="h-3.5 w-3.5" /> },
  { key: "phone", label: "Phone", icon: <Phone className="h-3.5 w-3.5" /> },
  { key: "email", label: "Email", icon: <Mail className="h-3.5 w-3.5" /> },
  { key: "slack", label: "Slack", icon: <ShieldQuestion className="h-3.5 w-3.5" /> },
  { key: "ownership", label: "Ownership", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  { key: "data_quality", label: "Data Quality", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  { key: "audit", label: "Audit", icon: <History className="h-3.5 w-3.5" /> },
];

const MANUAL_KINDS = ["ddi", "extension", "queue", "ring_group", "voicemail", "sip", "device"];

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
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

function memberName(members: CpMember[], id: string | null): string {
  if (!id) return "—";
  return members.find((m) => m.id === id)?.display_name ?? id.slice(0, 8);
}

export interface WorkspaceActions {
  onDiscoverTelephony?: (reason: string) => void;
  onDiscoverEmail?: (reason: string) => void;
  onAssign?: (endpointId: string, memberId: string, role: string, reason: string) => void;
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
}: {
  tenantName: string;
  workspace: Workspace;
  readiness: SourceReadiness | null;
  audit: AuditEntry[];
  writeCapable?: boolean;
  busy?: boolean;
  lastRefresh?: string;
  actions?: WorkspaceActions;
}) {
  const [section, setSection] = useState<Section>("overview");
  const { summary, members, identities, endpoints, ownership, dataQuality, connections, phoneEvidence } =
    workspace;

  const active = useMemo(() => endpoints.filter((e) => e.status === "active"), [endpoints]);
  const phone = active.filter((e) => e.channel === "phone");
  const email = active.filter((e) => e.channel === "email");
  const accountableFor = (endpointId: string) =>
    ownership.find(
      (o) =>
        o.endpoint_id === endpointId &&
        o.assignment_role === "accountable" &&
        o.review_state !== "rejected",
    ) ?? null;
  const mapped = active.filter((e) => accountableFor(e.id)).length;
  const evidence = phoneEvidence ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[190px_1fr]">
      <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              section === s.key
                ? "bg-accent/10 text-accent"
                : "text-muted-foreground hover:bg-surface-alt",
            )}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </nav>

      <div className="space-y-4">
        {/* ── Overview ─────────────────────────────────────────────── */}
        {section === "overview" && (
          <>
            <Card title={`Configuration readiness — ${tenantName}`}>
              {readiness ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={cn("text-sm font-semibold", READINESS_META[readiness.level]?.cls)}>
                      {READINESS_META[readiness.level]?.label ?? readiness.level}
                    </span>
                    {lastRefresh && (
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        refreshed {new Date(lastRefresh).toLocaleTimeString()}
                      </span>
                    )}
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="People" n={summary.people} />
              <Stat label="Canonical endpoints" n={active.length} />
              <Stat label="Email endpoints" n={email.length} />
              <Stat label="Typed phone endpoints" n={phone.length} />
              <Stat label="Ownership-mapped" n={mapped} tone="ok" />
              <Stat label="Unmapped" n={active.length - mapped} tone="warn" />
              <Stat label="Excluded identities" n={connections?.google_workspace.excluded ?? 0} tone="warn" />
              <Stat label="Unclassified phone metadata" n={evidence.length} tone="warn" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Ownership assignments" n={ownership.length} />
              <Stat label="Data-quality issues" n={dataQuality.length} tone="warn" />
              <Stat label="Unverified IDs" n={summary.identities_unverified} tone="warn" />
              <Stat label="Conflicts" n={summary.ambiguous_assignments} tone="warn" />
            </div>
          </>
        )}

        {/* ── People ───────────────────────────────────────────────── */}
        {section === "people" && (
          <Card title="People" right={<span className="text-[11px] text-muted-foreground">{members.length} member(s)</span>}>
            <p className="mb-3 text-xs text-muted-foreground">
              Canonical <code className="text-[11px]">team_members</code>. A member may exist without a
              login. Identity links (Google/Slack/VoIP) are proposals with confidence + provenance —
              never auto-confirmed from a name match.
            </p>
            <div className="divide-y divide-hairline">
              {members.map((m) => (
                <PersonRow key={m.id} member={m} identities={identities} ownership={ownership} />
              ))}
              {members.length === 0 && (
                <p className="py-2 text-xs italic text-muted-foreground">No members yet.</p>
              )}
            </div>
          </Card>
        )}

        {/* ── Connections ──────────────────────────────────────────── */}
        {section === "connections" && (
          <div className="space-y-4">
            <Card title="Google Workspace">
              {connections ? (
                <ConnRows
                  rows={[
                    ["Status", connections.google_workspace.status],
                    ["Tenant-approved domain", connections.google_workspace.approved_domains.join(", ") || "—"],
                    ["Discovered eligible", String(connections.google_workspace.imported)],
                    ["Excluded", String(connections.google_workspace.excluded)],
                    [
                      "Excluded domains",
                      Object.entries(connections.google_workspace.excluded_domains)
                        .map(([d, n]) => `${d} (${n})`)
                        .join(", ") || "—",
                    ],
                    ["External access", connections.google_workspace.read_only ? "read-only" : "read/write"],
                  ]}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Connection details unavailable.</p>
              )}
              {connections && connections.google_workspace.excluded > 0 && (
                <Warn>Connected directory contains identities outside this tenant’s approved domains</Warn>
              )}
            </Card>

            <Card title="Telephony">
              {connections ? (
                <>
                  <ConnRows
                    rows={[
                      ["Commercial provider", connections.telephony.commercial_provider],
                      ["Underlying provider / API", connections.telephony.underlying_provider],
                      ["Customer / account", connections.telephony.account_ref],
                      ["Credentials", connections.telephony.credentials],
                      ["External write / provisioning", connections.telephony.external_write],
                      ["Unclassified evidence records", String(connections.telephony.evidence_count)],
                    ]}
                  />
                  {connections.telephony.capabilities && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.entries(connections.telephony.capabilities).map(([k, v]) => (
                        <span
                          key={k}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px]",
                            v === "supported"
                              ? "border-success/30 bg-success/5 text-success"
                              : v === "manual"
                                ? "border-hairline bg-surface-alt text-muted-foreground"
                                : "border-amber-500/30 bg-amber-500/5 text-amber-700",
                          )}
                        >
                          {k.replace(/_/g, " ")}: {v}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Connection details unavailable.</p>
              )}
            </Card>

            <Card title="Slack">
              <p className="text-xs text-muted-foreground">
                {connections?.slack.note ?? "Identity model ready — ingestion not connected"}
              </p>
            </Card>
          </div>
        )}

        {/* ── Phone ────────────────────────────────────────────────── */}
        {section === "phone" && (
          <div className="space-y-4">
            <Card
              title="Canonical phone inventory"
              right={<span className="text-[11px] text-muted-foreground">{phone.length} endpoint(s)</span>}
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

            <Card
              title="Unclassified provider metadata — not eligible for canonical endpoint import"
              right={<span className="text-[11px] text-muted-foreground">{evidence.length} record(s)</span>}
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

        {/* ── Email ────────────────────────────────────────────────── */}
        {section === "email" && (
          <Card
            title="Email"
            right={
              writeCapable && actions.onDiscoverEmail ? (
                <ConfirmButton
                  label="Run email discovery"
                  confirm="Re-run approved-domain email discovery? (read-only against Google Workspace)"
                  busy={busy}
                  onGo={() => actions.onDiscoverEmail?.("operator email discovery from Control Plane UI")}
                />
              ) : (
                <span className="text-[11px] text-muted-foreground">{email.length} endpoint(s)</span>
              )
            }
          >
            <div className="divide-y divide-hairline">
              {email.map((e) => (
                <EndpointRow
                  key={e.id}
                  e={e}
                  acc={accountableFor(e.id)}
                  members={members}
                  writeCapable={writeCapable}
                  busy={busy}
                  onArchive={actions.onArchiveEndpoint}
                  onAssign={actions.onAssign}
                />
              ))}
              {email.length === 0 && (
                <p className="py-2 text-xs italic text-muted-foreground">No email endpoints.</p>
              )}
            </div>
          </Card>
        )}

        {/* ── Slack ────────────────────────────────────────────────── */}
        {section === "slack" && (
          <Card title="Slack">
            <p className="text-xs text-muted-foreground">
              {connections?.slack.note ?? "Identity model ready — ingestion not connected"}
            </p>
          </Card>
        )}

        {/* ── Ownership ────────────────────────────────────────────── */}
        {section === "ownership" && (
          <Card title="Ownership" right={<span className="text-[11px] text-muted-foreground">{mapped}/{active.length} mapped</span>}>
            <p className="mb-3 text-xs text-muted-foreground">
              Identity linking and operational ownership are distinct. Suggestions are never
              auto-saved. <code className="text-[11px]">waiting_on</code> is dynamic operational state,
              not endpoint configuration.
            </p>
            {(() => {
              const complete = active.filter((e) => accountableFor(e.id));
              const incomplete = active.filter((e) => !accountableFor(e.id));
              return (
                <div className="space-y-4">
                  <OwnGroup title="Incomplete — no accountable owner" tone="warn">
                    {incomplete.map((e) => (
                      <EndpointRow
                        key={e.id}
                        e={e}
                        acc={null}
                        members={members}
                        writeCapable={writeCapable}
                        busy={busy}
                        onAssign={actions.onAssign}
                        onArchive={undefined}
                      />
                    ))}
                    {incomplete.length === 0 && <Empty>All endpoints have an accountable owner.</Empty>}
                  </OwnGroup>
                  <OwnGroup title="Complete" tone="ok">
                    {complete.map((e) => (
                      <EndpointRow
                        key={e.id}
                        e={e}
                        acc={accountableFor(e.id)}
                        members={members}
                        writeCapable={false}
                        busy={busy}
                      />
                    ))}
                    {complete.length === 0 && <Empty>No endpoints have an accountable owner yet.</Empty>}
                  </OwnGroup>
                </div>
              );
            })()}
          </Card>
        )}

        {/* ── Data Quality ─────────────────────────────────────────── */}
        {section === "data_quality" && (
          <Card
            title="Data Quality"
            right={<span className="text-[11px] text-muted-foreground">{dataQuality.length} item(s)</span>}
          >
            {dataQuality.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No data-quality issues.</p>
            ) : (
              <ul className="space-y-1.5">
                {dataQuality.map((d: DataQualityItem, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 rounded-md bg-surface-alt/50 px-2.5 py-1.5 text-xs"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      <span className="font-medium text-display">{d.kind}</span>
                      <span className="text-muted-foreground"> — {d.detail}</span>
                      {d.ref && <span className="text-muted-foreground/60"> · {d.ref.slice(0, 8)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {/* ── Audit ────────────────────────────────────────────────── */}
        {section === "audit" && <AuditPanel audit={audit} />}
      </div>
    </div>
  );
}

function ConnRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 gap-y-1.5 text-xs sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-40 shrink-0 text-muted-foreground">{k}</dt>
          <dd className="font-medium text-display">{v}</dd>
        </div>
      ))}
    </dl>
  );
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
function OwnGroup({ title, tone, children }: { title: string; tone: "warn" | "ok"; children: ReactNode }) {
  return (
    <div>
      <div className={cn("mb-1.5 text-xs font-semibold", tone === "warn" ? "text-amber-600" : "text-success")}>
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function PersonRow({
  member,
  identities,
  ownership,
}: {
  member: CpMember;
  identities: CpIdentity[];
  ownership: Workspace["ownership"];
}) {
  const [open, setOpen] = useState(false);
  const ids = identities.filter((i) => i.team_member_id === member.id);
  const owns = ownership.filter((o) => o.owner_member_id === member.id).length;
  return (
    <div className="py-2 text-sm">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
        <span className="font-medium text-display">{member.display_name}</span>
        <span className="text-xs text-muted-foreground">
          {member.formal_role ?? "—"} · {ids.length} identity · {owns} owned
        </span>
      </button>
      {open && (
        <div className="mt-2 rounded-md bg-surface-alt/50 p-2.5 text-xs">
          <div className="mb-1 text-muted-foreground">
            {member.effective_to ? "Inactive" : "Active"} · linked profile:{" "}
            {member.org_unit_id ? "team unit set" : "—"}
          </div>
          {ids.length === 0 ? (
            <p className="italic text-muted-foreground">
              No linked identities. Identity matches are proposed with confidence + evidence, never
              auto-confirmed from a name.
            </p>
          ) : (
            <ul className="space-y-1">
              {ids.map((i) => (
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
}: {
  e: CpEndpoint;
  acc: Workspace["ownership"][number] | null;
  members: CpMember[];
  writeCapable: boolean;
  busy: boolean;
  onArchive?: (endpointId: string, reason: string) => void;
  onAssign?: (endpointId: string, memberId: string, role: string, reason: string) => void;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-alt/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-display">
          <span className="text-muted-foreground">{e.endpoint_kind}</span> ·{" "}
          {e.display_value ?? e.normalized_value}
          {e.provider && <span className="ml-1 text-[11px] text-muted-foreground">({e.provider})</span>}
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
      {writeCapable && onAssign && !acc && (
        <MapControl endpointId={e.id} members={members} onAssign={onAssign} busy={busy} />
      )}
    </div>
  );
}

const CATS: { key: string; label: string; match: (a: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "discovery", label: "Discovery runs", match: (a) => a.includes("discovery") },
  { key: "endpoint", label: "Endpoint changes", match: (a) => a.includes("endpoint") },
  { key: "ownership", label: "Ownership", match: (a) => a.includes("ownership") },
  { key: "identity", label: "Identity", match: (a) => a.includes("identity") || a.includes("member") },
  { key: "config", label: "Config / authority", match: (a) => a.includes("authority") || a.includes("config") },
];
function AuditPanel({ audit }: { audit: AuditEntry[] }) {
  const [cat, setCat] = useState("all");
  const m = CATS.find((c) => c.key === cat)!;
  const rows = audit.filter((a) => m.match(a.action));
  return (
    <Card title="Audit — configuration changes" right={<Database className="h-4 w-4 text-muted-foreground" />}>
      <div className="mb-3 flex flex-wrap gap-1">
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px]",
              cat === c.key ? "border-accent bg-accent/10 text-accent" : "border-hairline text-muted-foreground",
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
              <span className="tabular text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
            </div>
            <div className="text-muted-foreground">
              {a.actor} · {a.resource_type} · {a.reason ?? "—"}
              {a.view_as_active && <span className="text-amber-600"> · (View-As)</span>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="py-2 text-xs italic text-muted-foreground">No matching changes.</p>}
      </div>
    </Card>
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
  const [ctx, setCtx] = useState("sipcentric:3950");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<EndpointValidation | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const doValidate = async () => {
    setSaved(null);
    setPreview(await onValidate({ endpoint_kind: kind, value, display_value: display, provider_context: ctx }));
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
      <div className="mb-2 text-xs font-semibold text-display">Add manual endpoint (source = manual)</div>
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
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Value (number / extension / id)
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "ddi" ? "020 7946 0018" : kind === "extension" ? "201" : "identifier"}
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
                <span className="text-amber-700"> · duplicate of an existing {preview.duplicate.source} endpoint</span>
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
        disabled={busy}
        onClick={() => {
          onGo();
          setArmed(false);
        }}
        className="rounded-md border border-accent bg-accent px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50"
      >
        yes
      </button>
      <button onClick={() => setArmed(false)} className="text-[10px] text-muted-foreground">
        no
      </button>
    </span>
  ) : (
    <button
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
        disabled={busy || !member || !reason.trim()}
        onClick={() => onAssign(endpointId, member, role, reason)}
        className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        Confirm
      </button>
    </div>
  );
}
