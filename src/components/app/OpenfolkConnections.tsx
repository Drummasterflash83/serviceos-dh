/**
 * OpenFolk Control Plane — Connections section (presentational).
 *
 * First-class view of every system connected to a tenant, projected through the generic
 * connection lifecycle (see src/lib/openfolk-connections.ts). Renders a card per provider
 * and an inline detail drawer with the lifecycle sub-views. Read-only in this increment:
 * discovery/verify/re-authorise controls are shown as their real availability but not wired
 * to writes here. NEVER displays a secret value — secrets live in the server-side broker.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Plug,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  projectConnections,
  type CapabilityState,
  type ConnectionState,
  type ConnectionView,
} from "@/lib/openfolk-connections";
import type { Connections, DelegatedIssueResult, DelegatedTask, Workspace } from "@/lib/openfolk";

// Operator delegated-setup actions. Wired to the live Control Plane on /openfolk/$tenantId;
// the demo route supplies synthetic in-memory versions. Absent → the section is hidden.
export interface DelegatedActions {
  list: () => Promise<DelegatedTask[]>;
  issue: (input: {
    task_type: string;
    requested_action: string;
    recipient_email: string;
    recipient_name?: string;
    ttl_seconds?: number;
    origin?: string;
    reason: string;
  }) => Promise<DelegatedIssueResult | { error: string }>;
  revoke: (taskId: string, reason: string) => Promise<boolean>;
  getSubmission: (taskId: string) => Promise<Record<string, unknown> | null>;
}
const DELEGATED_TASK_TYPES = [
  "provide_telephony_inventory",
  "confirm_company_domains",
  "provide_provider_admin_contact",
  "authorise_google_workspace",
  "authorise_microsoft_365",
  "authorise_slack",
];

const LIFECYCLE_META: Partial<Record<ConnectionState, { cls: string }>> = {
  connected: { cls: "border-success/30 bg-success/5 text-success" },
  setup_required: { cls: "border-amber-500/30 bg-amber-500/5 text-amber-700" },
  awaiting_customer_admin: { cls: "border-amber-500/30 bg-amber-500/5 text-amber-700" },
  not_configured: { cls: "border-hairline bg-surface-alt text-muted-foreground" },
  verification_failed: { cls: "border-destructive/30 bg-destructive/5 text-destructive" },
  degraded: { cls: "border-amber-500/30 bg-amber-500/5 text-amber-700" },
  revoked: { cls: "border-destructive/30 bg-destructive/5 text-destructive" },
  disconnected: { cls: "border-hairline bg-surface-alt text-muted-foreground" },
  expired: { cls: "border-destructive/30 bg-destructive/5 text-destructive" },
};

const CAP_META: Record<CapabilityState, string> = {
  supported: "border-success/30 bg-success/5 text-success",
  read_only: "border-success/30 bg-success/5 text-success",
  manual: "border-hairline bg-surface-alt text-muted-foreground",
  planned: "border-amber-500/30 bg-amber-500/5 text-amber-700",
  unavailable: "border-hairline bg-surface-alt text-muted-foreground",
  unsupported: "border-hairline bg-surface-alt text-muted-foreground",
  requires_customer_admin: "border-amber-500/30 bg-amber-500/5 text-amber-700",
  requires_provider_support: "border-amber-500/30 bg-amber-500/5 text-amber-700",
};

function Pill({ children, cls }: { children: ReactNode; cls?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        cls ?? "border-hairline bg-surface-alt text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

export function OpenfolkConnections({
  connections,
  workspace,
  selectedId,
  onSelect,
  delegated,
}: {
  connections?: Connections;
  workspace: Pick<Workspace, "endpoints" | "identities">;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  delegated?: DelegatedActions;
}) {
  const views = useMemo(() => projectConnections(connections, workspace), [connections, workspace]);
  const selected = views.find((v) => v.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-hairline bg-white p-4 sm:p-5">
        <header className="mb-1 flex items-center gap-2">
          <Plug className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-display">Connections</h3>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {views.filter((v) => v.connected).length}/{views.length} connected
          </span>
        </header>
        <p className="mb-3 text-xs text-muted-foreground">
          Every integration flows through one generic lifecycle: Connection → Authorisation →
          Verification → Discovery → Canonical inventory → Identity review → Ownership → Readiness →
          Shadow → Production. Capability states reflect real provider limitations; credentials are
          never displayed.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {views.map((v) => (
            <ConnectionCard
              key={v.id}
              v={v}
              active={v.id === selectedId}
              onOpen={() => onSelect(v.id === selectedId ? null : v.id)}
            />
          ))}
        </div>
      </section>

      {selected && <ConnectionDetail v={selected} onClose={() => onSelect(null)} />}

      {delegated && <SetupRequests actions={delegated} />}
    </div>
  );
}

const DTASK_STATUS_META: Record<string, string> = {
  created: "border-amber-500/30 bg-amber-500/5 text-amber-700",
  opened: "border-accent/40 bg-accent/5 text-accent",
  submitted: "border-accent/40 bg-accent/5 text-accent",
  completed: "border-success/30 bg-success/5 text-success",
  expired: "border-hairline bg-surface-alt text-muted-foreground",
  revoked: "border-destructive/30 bg-destructive/5 text-destructive",
};

// Operator Setup-requests: list + create (issue-once link) + revoke + view staged submission.
// The raw link is shown ONCE and never persisted beyond the active confirmation view.
function SetupRequests({ actions }: { actions: DelegatedActions }) {
  const [tasks, setTasks] = useState<DelegatedTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<DelegatedIssueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submission, setSubmission] = useState<{
    id: string;
    data: Record<string, unknown> | null;
  } | null>(null);

  const [taskType, setTaskType] = useState(DELEGATED_TASK_TYPES[0]);
  const [reqAction, setReqAction] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState(7);

  // `actions` is a fresh object each parent render; hold it in a ref so the mount-load effect
  // stays stable (no refetch loop). Mutations update the list optimistically, then reconcile.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await actionsRef.current.list());
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (busy || !email.trim() || !reqAction.trim()) return;
    setBusy(true);
    setError(null);
    const captured = {
      taskType,
      reqAction: reqAction.trim(),
      email: email.trim().toLowerCase(),
      name: name.trim(),
      days,
    };
    const res = await actionsRef.current.issue({
      task_type: captured.taskType,
      requested_action: captured.reqAction,
      recipient_email: captured.email,
      recipient_name: captured.name || undefined,
      ttl_seconds: Math.max(captured.days, 1) * 24 * 3600,
      origin: typeof window !== "undefined" ? window.location.origin : undefined,
      reason: `operator issued ${captured.taskType} setup request`,
    });
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setIssued(res); // shown ONCE
    setCreating(false);
    setEmail("");
    setName("");
    setReqAction("");
    // Optimistically show the new task immediately (works for both live + demo).
    const optimistic: DelegatedTask = {
      id: res.task_id,
      tenant_id: "",
      provider: null,
      connection_id: null,
      task_type: captured.taskType,
      requested_action: captured.reqAction,
      recipient_email: captured.email,
      recipient_name: captured.name || null,
      status: "created",
      token_last4: res.token_last4,
      single_use: true,
      max_uses: 1,
      use_count: 0,
      expires_at: new Date(Date.now() + Math.max(captured.days, 1) * 86400000).toISOString(),
      opened_at: null,
      submitted_at: null,
      completed_at: null,
      revoked_at: null,
      created_by: null,
      correlation_id: res.task_id,
      created_at: new Date().toISOString(),
      submission_present: false,
    };
    setTasks((t) => [optimistic, ...t.filter((x) => x.id !== optimistic.id)]);
    void refresh();
  };

  const doRevoke = async (id: string) => {
    setBusy(true);
    setTasks((t) => t.map((x) => (x.id === id ? { ...x, status: "revoked" } : x)));
    await actionsRef.current.revoke(id, "operator revoked setup request");
    setBusy(false);
    void refresh();
  };
  const viewSubmission = async (id: string) => {
    setBusy(true);
    const data = await actionsRef.current.getSubmission(id);
    setBusy(false);
    setSubmission({ id, data });
  };

  return (
    <section className="rounded-xl border border-hairline bg-white p-4 sm:p-5">
      <header className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-display">Setup requests</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {tasks.length} request(s){loading ? " · loading…" : ""}
        </span>
      </header>
      <p className="mb-3 text-xs text-muted-foreground">
        Ask a named customer admin to complete ONE setup task (e.g. provide telephony inventory)
        without any Control Plane access. The setup link is shown once at creation and cannot be
        recovered; it is never sent automatically.
      </p>

      {/* One-time link banner */}
      {issued && (
        <div className="mb-3 rounded-lg border border-success/40 bg-success/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" /> Setup request created — copy the link now
          </div>
          <p className="mb-2 text-[11px] text-amber-700">{issued.warning}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded border border-hairline bg-white px-2 py-1 text-[11px]">
              {issued.setup_url}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(issued.setup_url);
                setCopied(true);
              }}
              className="rounded-md border border-accent bg-accent px-2 py-1 text-[11px] font-medium text-white"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIssued(null);
                setCopied(false);
              }}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-display"
            >
              Done (hide link)
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Recipient identifier: {issued.recipient_email} · token …{issued.token_last4}
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {/* Create form */}
      {creating ? (
        <div className="mb-3 rounded-lg border border-hairline bg-surface-alt/40 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-[11px] text-muted-foreground">
              Recipient name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Recipient email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@customer.example"
                className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Task type
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
              >
                {DELEGATED_TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-muted-foreground">
              Expiry (days)
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 7)}
                className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="text-[11px] text-muted-foreground sm:col-span-2">
              Requested action
              <input
                value={reqAction}
                onChange={(e) => setReqAction(e.target.value)}
                placeholder="Please upload your telephony inventory"
                className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs"
              />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !email.trim() || !reqAction.trim()}
              onClick={submit}
              className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create setup request"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-[11px] text-muted-foreground hover:text-display"
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mb-3 rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white"
        >
          Create setup request
        </button>
      )}

      {/* Task list — token_last4 only, never the hash */}
      <div className="divide-y divide-hairline">
        {tasks.length === 0 && !loading && (
          <p className="py-2 text-xs italic text-muted-foreground">No setup requests.</p>
        )}
        {tasks.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
            <Pill cls={DTASK_STATUS_META[t.status]}>{humanize(t.status)}</Pill>
            <span className="font-medium text-display">{humanize(t.task_type)}</span>
            <span className="text-muted-foreground">
              {t.recipient_name ? `${t.recipient_name} · ` : ""}
              {t.recipient_email}
            </span>
            <span className="text-muted-foreground/70">token …{t.token_last4 ?? "—"}</span>
            <span className="text-muted-foreground/70">
              expires {new Date(t.expires_at).toLocaleDateString()}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              {t.submission_present && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => viewSubmission(t.id)}
                  className="rounded-md border border-hairline bg-white px-2 py-0.5 text-[10px] text-muted-foreground hover:text-display disabled:opacity-50"
                >
                  View submission
                </button>
              )}
              {t.status !== "completed" && t.status !== "revoked" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doRevoke(t.id)}
                  className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium text-amber-700 disabled:opacity-50"
                >
                  Revoke
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {submission && (
        <div className="mt-3 rounded-lg border border-hairline bg-surface-alt/40 p-3">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-display">
            <span>Staged submission (not canonical until operator approves)</span>
            <button
              type="button"
              onClick={() => setSubmission(null)}
              className="text-[11px] text-muted-foreground hover:text-display"
            >
              close
            </button>
          </div>
          <pre className="overflow-x-auto rounded bg-white p-2 text-[11px] text-muted-foreground">
            {submission.data ? JSON.stringify(submission.data, null, 2) : "No submission yet."}
          </pre>
        </div>
      )}
    </section>
  );
}

function ConnectionCard({
  v,
  active,
  onOpen,
}: {
  v: ConnectionView;
  active: boolean;
  onOpen: () => void;
}) {
  const lc = LIFECYCLE_META[v.lifecycle] ?? { cls: "border-hairline text-muted-foreground" };
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-surface-alt/40 p-3 text-left transition-colors hover:border-accent/40",
        active ? "border-accent/60 ring-1 ring-accent/30" : "border-hairline",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-display">{v.providerLabel}</span>
        {v.connected ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-muted-foreground/60" />
        )}
        <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="text-[11px] text-muted-foreground">
        {v.commercialProvider ?? v.providerLabel}
        {v.underlyingProvider && <span> · {v.underlyingProvider}</span>}
        {v.accountRef && <span> · acct {v.accountRef}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill cls={lc.cls}>{humanize(v.lifecycle)}</Pill>
        <Pill>{humanize("readiness: " + v.readiness)}</Pill>
        {v.externalWrite ? (
          <Pill cls="border-amber-500/30 bg-amber-500/5 text-amber-700">write enabled</Pill>
        ) : (
          <Pill>read-only</Pill>
        )}
      </div>
      {v.notConnectedReason && (
        <div className="text-[11px] text-amber-700">{v.notConnectedReason}</div>
      )}
      {v.warnings.length > 0 && (
        <div className="flex items-start gap-1 text-[11px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{v.warnings[0]}</span>
        </div>
      )}
    </button>
  );
}

const DETAIL_TABS = [
  "Overview",
  "Authorisation",
  "Capabilities",
  "Boundaries",
  "Discovery",
  "Inventory",
  "Health",
  "Security",
  "Audit",
] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function ConnectionDetail({ v, onClose }: { v: ConnectionView; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>("Overview");
  return (
    <section className="rounded-xl border border-accent/40 bg-white p-4 ring-1 ring-accent/20 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-display">{v.providerLabel}</h3>
        <Pill cls={(LIFECYCLE_META[v.lifecycle] ?? {}).cls}>{humanize(v.lifecycle)}</Pill>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-display"
        >
          Close
        </button>
      </header>
      <nav className="mb-3 flex flex-wrap gap-1">
        {DETAIL_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px]",
              tab === t
                ? "border-accent bg-accent/10 text-accent"
                : "border-hairline text-muted-foreground hover:text-display",
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="text-xs">{renderTab(tab, v)}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5">
      <dt className="w-44 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="font-medium text-display">{v}</dd>
    </div>
  );
}
function NotAvailable() {
  return (
    <span className="italic text-muted-foreground">
      Not available from the current backend projection
    </span>
  );
}

function renderTab(tab: DetailTab, v: ConnectionView): ReactNode {
  switch (tab) {
    case "Overview":
      return (
        <dl>
          <Row k="Commercial provider" v={v.commercialProvider ?? "—"} />
          <Row k="Underlying provider / API" v={v.underlyingProvider ?? "—"} />
          <Row k="Account / organisation ref" v={v.accountRef ?? "—"} />
          <Row k="Lifecycle" v={humanize(v.lifecycle)} />
          <Row k="Readiness" v={humanize(v.readiness)} />
          <Row k="Adapter implemented" v={v.adapterImplemented ? "yes" : "no"} />
          {v.notConnectedReason && (
            <Row
              k="Status detail"
              v={<span className="text-amber-700">{v.notConnectedReason}</span>}
            />
          )}
        </dl>
      );
    case "Authorisation":
      return (
        <dl>
          <Row k="Real connection status" v={v.lifecycleDetail?.status ?? <NotAvailable />} />
          <Row k="Auth mode" v={v.lifecycleDetail?.auth_mode ?? <NotAvailable />} />
          <Row k="Authorisation" v={humanize(v.authorisation)} />
          <Row k="Verification" v={humanize(v.verification)} />
          <Row k="External read" v={v.externalRead ? "enabled" : "disabled"} />
          <Row
            k="External write / provisioning"
            v={v.externalWrite ? <span className="text-amber-700">enabled</span> : "disabled"}
          />
          <Row k="Last verified" v={v.lifecycleDetail?.verified_at ?? <NotAvailable />} />
          <Row
            k="Last test"
            v={
              v.lifecycleDetail?.last_test_status ? (
                `${v.lifecycleDetail.last_test_status}${v.lifecycleDetail.last_test_at ? ` · ${v.lifecycleDetail.last_test_at}` : ""}`
              ) : (
                <NotAvailable />
              )
            }
          />
          <Row k="Revoked at" v={v.lifecycleDetail?.revoked_at ?? "—"} />
          <Row
            k="Configured fields"
            v={
              v.lifecycleDetail?.configured_fields?.length
                ? v.lifecycleDetail.configured_fields.join(", ")
                : "—"
            }
          />
          <Row
            k="Secrets present"
            v={
              v.lifecycleDetail ? (
                v.lifecycleDetail.has_secrets ? (
                  "yes (brokered)"
                ) : (
                  "no"
                )
              ) : (
                <NotAvailable />
              )
            }
          />
          <Row
            k="Credentials"
            v={<span className="text-muted-foreground">brokered — never displayed</span>}
          />
        </dl>
      );
    case "Capabilities":
      return v.capabilities.length === 0 ? (
        <p className="italic text-muted-foreground">No capabilities declared.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {v.capabilities.map((c) => (
            <Pill key={c.key} cls={CAP_META[c.state]}>
              {humanize(c.key)}: {humanize(c.state)}
            </Pill>
          ))}
        </div>
      );
    case "Boundaries":
      return v.boundaries.length === 0 ? (
        <p className="text-amber-700">
          No explicit tenant boundary — default deny. Nothing is imported without an approved scope.
        </p>
      ) : (
        <dl>
          {v.boundaries.map((b, i) => (
            <Row key={i} k={b.label} v={b.value} />
          ))}
        </dl>
      );
    case "Discovery":
      return (
        <dl>
          <Row
            k="Latest event"
            v={
              v.lifecycleDetail?.latest_event ? (
                `${v.lifecycleDetail.latest_event}${v.lifecycleDetail.latest_event_at ? ` · ${v.lifecycleDetail.latest_event_at}` : ""}`
              ) : (
                <NotAvailable />
              )
            }
          />
          <Row
            k="Last successful discovery"
            v={v.lifecycleDetail?.last_successful_discovery ?? <NotAvailable />}
          />
          <Row k="Last failed discovery" v={v.lifecycleDetail?.last_failed_discovery ?? "—"} />
          <Row
            k="Last run processed"
            v={
              v.lifecycleDetail?.discovery_counts?.last_run_processed != null ? (
                String(v.lifecycleDetail.discovery_counts.last_run_processed)
              ) : (
                <NotAvailable />
              )
            }
          />
          <Row
            k="Discovery mode"
            v={v.connected ? "manual, read-only, idempotent" : "unavailable until connected"}
          />
          <Row k="Raw evidence records" v={String(v.evidenceCount)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Full run history is in the Discovery history panel below the connection cards.
          </p>
        </dl>
      );
    case "Inventory":
      return (
        <dl>
          <Row k="Canonical records (this connection)" v={String(v.inventoryCount)} />
          <Row k="Raw evidence (non-canonical)" v={String(v.evidenceCount)} />
          <Row
            k="Note"
            v={
              <span className="text-muted-foreground">
                Discovery feeds existing canonical models (endpoints / identities); provider
                payloads remain raw evidence/provenance.
              </span>
            }
          />
        </dl>
      );
    case "Health":
      return (
        <dl>
          <Row k="Health" v={humanize(v.health)} />
          <Row k="Warnings" v={v.warnings.length ? String(v.warnings.length) : "none"} />
          {v.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1 py-0.5 text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </dl>
      );
    case "Security":
      return (
        <dl>
          <Row k="Secret storage" v="server-side broker (Vault) — references only" />
          <Row k="External write" v={v.externalWrite ? "enabled" : "disabled"} />
          <Row k="Boundary" v={v.boundaries.length ? "scoped" : "default deny"} />
          <Row k="Processing source" v="inactive" />
        </dl>
      );
    case "Audit":
      return (
        <p className="text-muted-foreground">
          Connection events (created / authorised / verified / discovery / disconnected) are
          recorded server-side in the connection audit trail. Surfacing per-connection event history
          in this drawer is pending a backend projection.
        </p>
      );
  }
}
