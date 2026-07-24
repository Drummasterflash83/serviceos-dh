/**
 * OpenFolk Control Plane — Connections section (presentational).
 *
 * First-class view of every system connected to a tenant, projected through the generic
 * connection lifecycle (see src/lib/openfolk-connections.ts). Renders a card per provider
 * and an inline detail drawer with the lifecycle sub-views. Read-only in this increment:
 * discovery/verify/re-authorise controls are shown as their real availability but not wired
 * to writes here. NEVER displays a secret value — secrets live in the server-side broker.
 */
import { useMemo, useState, type ReactNode } from "react";
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
import type { Connections, Workspace } from "@/lib/openfolk";

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
}: {
  connections?: Connections;
  workspace: Pick<Workspace, "endpoints" | "identities">;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
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
    </div>
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
          <Row k="Authorisation" v={humanize(v.authorisation)} />
          <Row k="Verification" v={humanize(v.verification)} />
          <Row k="External read" v={v.externalRead ? "enabled" : "disabled"} />
          <Row
            k="External write / provisioning"
            v={v.externalWrite ? <span className="text-amber-700">enabled</span> : "disabled"}
          />
          <Row k="Last verified" v={v.lastVerified ?? <NotAvailable />} />
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
          <Row k="Last discovery" v={v.lastDiscovery ?? <NotAvailable />} />
          <Row
            k="Discovery"
            v={
              v.connected
                ? "manual, read-only, idempotent (run history not yet surfaced here)"
                : "unavailable until connected"
            }
          />
          <Row k="Raw evidence records" v={String(v.evidenceCount)} />
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
