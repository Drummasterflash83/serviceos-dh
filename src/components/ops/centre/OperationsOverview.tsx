/**
 * OperationsOverview — the Operations Centre landing page: "show me the health
 * of my business in seconds". Composed ENTIRELY from the reusable ops component
 * library + the connector/module registries — no vendor is hardcoded.
 *
 * Connector runtime state and jobs/alerts/queues are STUBBED here (no backend
 * yet, per spec). When a real health/jobs backend exists, only this data layer
 * changes — the components stay the same.
 */

import { Activity, Cpu, Database, Gauge, Server } from "lucide-react";

import { useModules } from "@/lib/modules/useModules";
import { CONNECTORS } from "@/lib/connectors/registry";
import type { ConnectorView } from "@/lib/connectors/types";
import {
  ActivityTable,
  AlertCard,
  ConnectorCard,
  HealthCard,
  JobsCard,
  MetricCard,
  QueueCard,
  type AlertItem,
  type Column,
  type JobsSummary,
  type QueueRow,
} from "@/components/ops";

// ── Stub runtime state (replace with a health backend later) ────────────────
const STUB_STATE: Record<string, ConnectorView["state"]> = {
  gmail: {
    status: "connected",
    health: "healthy",
    lastSyncAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    metrics: [
      { label: "Mailboxes", value: 1 },
      { label: "Messages", value: "—" },
    ],
  },
  google_workspace: {
    status: "connected",
    health: "healthy",
    lastSyncAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    metrics: [
      { label: "Mailboxes", value: 30 },
      { label: "Active", value: 29 },
    ],
  },
  simwood: {
    status: "connected",
    health: "healthy",
    lastSyncAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    metrics: [
      { label: "Extensions", value: "—" },
      { label: "Calls today", value: "—" },
    ],
  },
};

const STUB_JOBS: JobsSummary = {
  running: 2,
  queued: 5,
  completedToday: 184,
  failed: 0,
  retryQueue: 0,
  processingRate: "128 / min",
};

const STUB_QUEUES: QueueRow[] = [
  { id: "sync", name: "Email sync", depth: 3, rate: "recent messages", status: "syncing" },
  {
    id: "backfill",
    name: "Workspace backfill",
    depth: 1,
    rate: "historical import",
    status: "syncing",
  },
  { id: "transcribe", name: "Call transcription", depth: 0, rate: "idle", status: "connected" },
  { id: "ai", name: "AI queue", depth: 0, rate: "not enabled", status: "disabled" },
];

const STUB_ALERTS: AlertItem[] = [];

interface ActivityRow extends Record<string, unknown> {
  when: string;
  system: string;
  event: string;
}
const STUB_ACTIVITY: ActivityRow[] = [
  { when: "2m ago", system: "Google Workspace", event: "Scheduled sync · 14 messages" },
  { when: "4m ago", system: "Simwood", event: "Recordings sync · 3 recordings" },
  { when: "9m ago", system: "Google Workspace", event: "Backfill page · 100 messages" },
];

export function OperationsOverview() {
  const { isEnabled } = useModules();

  // Only render connectors whose module is enabled for this tenant.
  const connectors: ConnectorView[] = CONNECTORS.filter((c) => isEnabled(c.moduleId)).map((c) => ({
    descriptor: c,
    state: STUB_STATE[c.id] ?? { status: "disabled", health: "unknown" },
  }));

  const healthy = connectors.filter((c) => c.state.health === "healthy").length;
  const warning = connectors.filter((c) => c.state.health === "warning").length;
  const critical = connectors.filter((c) => c.state.health === "critical").length;

  const activityCols: Column<ActivityRow>[] = [
    { key: "when", header: "When", className: "font-mono text-muted-foreground whitespace-nowrap" },
    { key: "system", header: "System" },
    { key: "event", header: "Event", className: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Connected" value={connectors.length} icon={Server} />
        <MetricCard label="Healthy" value={healthy} tone="success" icon={Gauge} />
        <MetricCard label="Warnings" value={warning} tone="warning" />
        <MetricCard label="Critical" value={critical} tone="critical" />
        <MetricCard label="Running jobs" value={STUB_JOBS.running} tone="accent" icon={Activity} />
        <MetricCard label="Failed jobs" value={STUB_JOBS.failed} tone="critical" />
      </div>

      {/* Health + jobs */}
      <div className="grid gap-6 lg:grid-cols-2">
        <HealthCard healthy={healthy} warning={warning} critical={critical} />
        <JobsCard jobs={STUB_JOBS} />
      </div>

      {/* Connected systems */}
      <div>
        <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          Connected systems
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {connectors.map((c) => (
            <ConnectorCard key={c.descriptor.id} connector={c} />
          ))}
        </div>
      </div>

      {/* Queues + alerts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <QueueCard queues={STUB_QUEUES} />
        <AlertCard alerts={STUB_ALERTS} />
      </div>

      {/* Resource + activity */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Storage" value="—" icon={Database} hint="not yet metered" />
        <MetricCard label="API usage" value="—" icon={Cpu} hint="not yet metered" />
        <MetricCard label="AI queue" value="—" hint="module not enabled" />
        <MetricCard label="Active users" value="—" icon={Server} hint="not yet metered" />
      </div>

      <ActivityTable
        title="Latest activity"
        columns={activityCols}
        rows={STUB_ACTIVITY}
        rowKey={(_, i) => String(i)}
      />
    </div>
  );
}
