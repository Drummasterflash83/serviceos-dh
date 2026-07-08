/**
 * OperationsOverview — the Operations Centre landing page, now LIVE: every metric
 * is tenant-scoped real data (via RLS) from the existing tables. Composed from
 * the reusable ops component library + the connector registry — no vendor is
 * hardcoded. Handles loading, empty (no accounts / no data / RLS-empty) and
 * error states without crashing.
 */

import { Activity, Bot, Briefcase, Gauge, Mail, Phone, RotateCcw, Server } from "lucide-react";

import { useModules } from "@/lib/modules/useModules";
import { getConnector } from "@/lib/connectors/registry";
import type { ConnectorView, ConnectorAction } from "@/lib/connectors/types";
import {
  useOperationsMetrics,
  type ConnectorMetricSummary,
  type OperationsMetrics,
} from "@/lib/ops-metrics";
import { Button } from "@/components/ui/button";
import {
  ActivityTable,
  AlertCard,
  ConnectorCard,
  HealthBreakdownCard,
  JobsCard,
  MetricCard,
  QueueCard,
  type AlertItem,
  type Column,
  type HealthBreakdownItem,
  type JobsSummary,
  type QueueRow,
} from "@/components/ops";

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Build a ConnectorView (for ConnectorCard) from a live summary + the registry. */
function toConnectorView(c: ConnectorMetricSummary): ConnectorView {
  const descriptor = getConnector(c.id) ?? {
    id: c.id,
    name: c.name,
    provider: c.provider,
    category: "communications" as const,
    moduleId: "",
    actions: ["sync", "health", "logs", "settings"] as ConnectorAction[],
  };
  return {
    descriptor: { ...descriptor, name: c.name, provider: c.provider },
    state: {
      status: c.status,
      health: c.health,
      metrics: c.metrics,
      lastSyncAt: c.lastSyncAt,
      errors: c.errors24h,
    },
  };
}

function LoadingGrid() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-2xl border border-hairline bg-surface-alt"
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-44 animate-pulse rounded-2xl border border-hairline bg-surface-alt" />
        <div className="h-44 animate-pulse rounded-2xl border border-hairline bg-surface-alt" />
      </div>
    </div>
  );
}

function domainHealth(m: OperationsMetrics): {
  email: HealthBreakdownItem;
  phone: HealthBreakdownItem;
} {
  const emailPresent = m.email.workspace_mailboxes_total > 0 || m.email.gmail_oauth_accounts > 0;
  const emailWarn = m.email.recent_email_sync_failures_24h > 0 || m.email.backfill_errors > 0;
  const phonePresent = m.phone.phone_calls_total > 0 || m.phone.phone_recordings_total > 0;
  const phoneWarn = m.phone.phone_sync_failures_24h > 0;

  return {
    email: {
      label: "Email",
      icon: Mail,
      health: !emailPresent ? "unknown" : emailWarn ? "warning" : "healthy",
      detail: `${m.email.workspace_mailboxes_active} active mailboxes · ${m.email.gmail_oauth_accounts} OAuth · ${m.email.email_messages_total} messages`,
    },
    phone: {
      label: "Phone",
      icon: Phone,
      health: !phonePresent ? "unknown" : phoneWarn ? "warning" : "healthy",
      detail: `${m.phone.phone_calls_today} calls today · ${m.phone.phone_transcriptions_pending} pending transcription`,
    },
  };
}

export function OperationsOverview() {
  const { isEnabled } = useModules();
  const { data, loading, error, refresh } = useOperationsMetrics();

  if (loading && !data) return <LoadingGrid />;
  const m = data;
  if (!m) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-sm text-destructive">
        {error ?? "Could not load operations metrics."}
      </div>
    );
  }

  // Only surface connectors whose module is enabled for this tenant.
  const connectorViews = m.connectors
    .filter((c) => {
      const d = getConnector(c.id);
      return d ? isEnabled(d.moduleId) : true;
    })
    .map(toConnectorView);
  const presentViews = connectorViews.filter(
    (v) => v.state.status !== "offline" && v.state.status !== "disabled",
  );

  const jobs: JobsSummary = {
    running: m.jobs.running,
    queued: m.jobs.queued,
    completedToday: m.jobs.completed_today,
    failed: m.jobs.failed_today,
    retryQueue: m.jobs.retry_placeholder,
    processingRate: "—",
  };

  const dh = domainHealth(m);
  const healthItems: HealthBreakdownItem[] = [
    dh.email,
    dh.phone,
    { label: "AI", icon: Bot, health: "unknown", detail: "Module not enabled" },
    {
      label: "Business Systems",
      icon: Briefcase,
      health: "unknown",
      detail: "No systems connected",
    },
  ];

  const queues: QueueRow[] = [
    {
      id: "backfill",
      name: "Workspace backfill",
      depth: m.email.backfill_running,
      rate: `${m.email.backfill_completed} completed`,
      status: m.email.backfill_running > 0 ? "syncing" : "connected",
    },
    {
      id: "transcribe",
      name: "Pending transcription",
      depth: m.phone.phone_transcriptions_pending,
      rate: `${m.phone.phone_recordings_total} recordings`,
      status: m.phone.phone_transcriptions_pending > 0 ? "warning" : "connected",
    },
    {
      id: "ai",
      name: "AI enrichment (pending)",
      depth: m.phone.phone_ai_pending,
      rate: "AI module not enabled",
      status: "disabled",
    },
  ];

  const alerts: AlertItem[] = m.alerts.map((a) => ({
    id: a.id,
    title: `${a.system} · ${a.message.split(":")[0]}`,
    detail: a.message.includes(":") ? a.message.split(":").slice(1).join(":").trim() : undefined,
    severity: a.severity,
    at: fmtTime(a.timestamp),
  }));

  const activityCols: Column<(typeof m.activity)[number]>[] = [
    {
      key: "timestamp",
      header: "When",
      className: "font-mono text-muted-foreground whitespace-nowrap",
      render: (r) => fmtTime(r.timestamp),
    },
    { key: "system", header: "System" },
    { key: "event", header: "Event", className: "text-muted-foreground" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span
          className={
            r.status === "failed"
              ? "text-destructive"
              : r.status === "success"
                ? "text-success"
                : "text-muted-foreground"
          }
        >
          {r.status}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Title + refresh */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Live · tenant-scoped
        </div>
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* Platform KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Connected" value={m.platform.connected_systems} icon={Server} />
        <MetricCard
          label="Healthy"
          value={m.platform.healthy_systems}
          tone="success"
          icon={Gauge}
        />
        <MetricCard label="Warnings" value={m.platform.warning_systems} tone="warning" />
        <MetricCard label="Critical" value={m.platform.critical_systems} tone="critical" />
        <MetricCard label="Running jobs" value={m.jobs.running} tone="accent" icon={Activity} />
        <MetricCard label="Failed today" value={m.jobs.failed_today} tone="critical" />
      </div>

      {/* Jobs + system health breakdown (replaces the duplicated health panel) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <JobsCard jobs={jobs} />
        <HealthBreakdownCard items={healthItems} />
      </div>

      {/* Connected systems (real) */}
      <div>
        <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          Connected systems
        </div>
        {presentViews.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-muted-foreground">
            No systems connected yet. Set up Email or Phone in Communications.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {presentViews.map((v) => (
              <ConnectorCard key={v.descriptor.id} connector={v} />
            ))}
          </div>
        )}
      </div>

      {/* Queues + alerts (real) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <QueueCard queues={queues} />
        <AlertCard alerts={alerts} />
      </div>

      {/* Recent activity (real) */}
      <ActivityTable
        title="Recent activity"
        columns={activityCols}
        rows={m.activity}
        rowKey={(r) => r.id}
        emptyLabel="No sync activity yet."
      />
    </div>
  );
}
