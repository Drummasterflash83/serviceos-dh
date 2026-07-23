/**
 * OpenFolk Control Plane — tenant workspace (presentational).
 *
 * OpenFolk-operated managed-service configuration for ONE tenant. Manual-first,
 * discovery-assisted: provider discovery populates candidate endpoints; the operator
 * confirms ownership (accountable / handler / cover / escalation) with effective dates
 * and a reason. Data-plane state comes from the gated openfolk-control-plane function;
 * this component only renders + emits actions (so a demo route can feed synthetic data).
 */
import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  History,
  Mail,
  Phone,
  ShieldQuestion,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AuditEntry,
  CpMember,
  DataQualityItem,
  SourceReadiness,
  Workspace,
} from "@/lib/openfolk";

const READINESS_META: Record<string, { label: string; cls: string }> = {
  not_ready: { label: "Not ready", cls: "text-destructive" },
  ready_for_evaluation: { label: "Ready for evaluation", cls: "text-amber-600" },
  ready_for_chris_shadow: { label: "Ready for Chris-only shadow", cls: "text-success" },
  ready_for_staff_pilot: { label: "Ready for staff pilot", cls: "text-success" },
};

type Section = "overview" | "people" | "phone" | "email" | "slack" | "data_quality" | "audit";
const SECTIONS: { key: Section; label: string; icon: ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <Activity className="h-3.5 w-3.5" /> },
  { key: "people", label: "People & Identities", icon: <Users className="h-3.5 w-3.5" /> },
  { key: "phone", label: "Phone / VoIP", icon: <Phone className="h-3.5 w-3.5" /> },
  { key: "email", label: "Email", icon: <Mail className="h-3.5 w-3.5" /> },
  { key: "slack", label: "Slack", icon: <ShieldQuestion className="h-3.5 w-3.5" /> },
  { key: "data_quality", label: "Data Quality", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  { key: "audit", label: "Audit", icon: <History className="h-3.5 w-3.5" /> },
];

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

function memberName(members: CpMember[], id: string | null): string {
  if (!id) return "—";
  return members.find((m) => m.id === id)?.display_name ?? id.slice(0, 8);
}

export function OpenfolkWorkspace({
  tenantName,
  workspace,
  readiness,
  audit,
  writeCapable = false,
  onDiscoverTelephony,
  onAssign,
  busy = false,
}: {
  tenantName: string;
  workspace: Workspace;
  readiness: SourceReadiness | null;
  audit: AuditEntry[];
  writeCapable?: boolean;
  onDiscoverTelephony?: (reason: string) => void;
  onAssign?: (endpointId: string, memberId: string, role: string, reason: string) => void;
  busy?: boolean;
}) {
  const [section, setSection] = useState<Section>("overview");
  const { summary, members, endpoints, ownership, dataQuality } = workspace;
  const accountableFor = (endpointId: string) =>
    ownership.find(
      (o) =>
        o.endpoint_id === endpointId &&
        o.assignment_role === "accountable" &&
        o.review_state !== "rejected",
    ) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr]">
      {/* Section nav */}
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
        {section === "overview" && (
          <>
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["People", summary.people],
                ["Endpoints", summary.endpoints_total],
                ["Unmapped", summary.endpoints_unmapped],
                ["Unverified IDs", summary.identities_unverified],
              ].map(([label, n]) => (
                <div
                  key={label as string}
                  className="rounded-xl border border-hairline bg-white p-3"
                >
                  <div className="text-2xl font-semibold text-display tabular">{n as number}</div>
                  <div className="text-[11px] text-muted-foreground">{label as string}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {section === "people" && (
          <Card
            title="People & Identities"
            right={
              <span className="text-[11px] text-muted-foreground">{members.length} member(s)</span>
            }
          >
            <p className="mb-3 text-xs text-muted-foreground">
              A team member may exist without a ServiceOS login. External identities
              (Google/Slack/VoIP) link a member to a source-system account.
            </p>
            <div className="divide-y divide-hairline">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-display">{m.display_name}</span>
                  <span className="text-xs text-muted-foreground">{m.formal_role ?? "—"}</span>
                </div>
              ))}
              {members.length === 0 && (
                <p className="py-2 text-xs italic text-muted-foreground">No members yet.</p>
              )}
            </div>
          </Card>
        )}

        {section === "phone" && (
          <Card
            title="Phone / VoIP endpoints"
            right={
              writeCapable && onDiscoverTelephony ? (
                <button
                  disabled={busy}
                  onClick={() => onDiscoverTelephony("operator refresh from Control Plane UI")}
                  className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  Discover from provider
                </button>
              ) : undefined
            }
          >
            <div className="space-y-2">
              {endpoints
                .filter((e) => e.channel === "phone")
                .map((e) => {
                  const acc = accountableFor(e.id);
                  return (
                    <div
                      key={e.id}
                      className="rounded-lg border border-hairline bg-surface-alt/40 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-display">
                          {e.endpoint_kind} · {e.display_value ?? e.normalized_value}
                        </span>
                        {acc ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white px-2 py-0.5 text-[11px] text-success">
                            <CheckCircle2 className="h-3 w-3" />{" "}
                            {acc.owner_kind === "team"
                              ? "team"
                              : memberName(members, acc.owner_member_id)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[11px] text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> unmapped
                          </span>
                        )}
                      </div>
                      {writeCapable && onAssign && !acc && (
                        <MapControl
                          endpointId={e.id}
                          members={members}
                          onAssign={onAssign}
                          busy={busy}
                        />
                      )}
                    </div>
                  );
                })}
              {endpoints.filter((e) => e.channel === "phone").length === 0 && (
                <p className="text-xs italic text-muted-foreground">
                  No phone endpoints yet — use “Discover from provider”.
                </p>
              )}
            </div>
          </Card>
        )}

        {(section === "email" || section === "slack") && (
          <Card title={section === "email" ? "Email" : "Slack"}>
            <p className="text-xs text-muted-foreground">
              {section === "email"
                ? "Mailboxes/aliases/shared inboxes map to owners with the same effective-dated model. Discovery seams from Google Workspace populate candidates."
                : "Slack workspace/user/channel endpoints use the same identity + ownership model. Ingestion is not connected in this increment; manual endpoint mapping is supported."}
            </p>
          </Card>
        )}

        {section === "data_quality" && (
          <Card
            title="Data Quality"
            right={
              <span className="text-[11px] text-muted-foreground">
                {dataQuality.length} item(s)
              </span>
            }
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
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {section === "audit" && (
          <Card
            title="Audit — configuration changes"
            right={<Database className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="divide-y divide-hairline">
              {audit.map((a, i) => (
                <div key={i} className="py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-display">{a.action}</span>
                    <span className="tabular text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {a.actor} · {a.reason ?? "—"}
                    {a.view_as_active && <span className="text-amber-600"> · (View-As)</span>}
                  </div>
                </div>
              ))}
              {audit.length === 0 && (
                <p className="py-2 text-xs italic text-muted-foreground">No changes recorded.</p>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
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
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={member}
        onChange={(e) => setMember(e.target.value)}
        className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]"
      >
        <option value="">Assign accountable…</option>
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
        onClick={() => onAssign(endpointId, member, "accountable", reason)}
        className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        Confirm owner
      </button>
    </div>
  );
}
