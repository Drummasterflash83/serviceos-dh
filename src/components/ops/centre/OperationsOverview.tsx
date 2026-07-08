/**
 * OperationsOverview — LIVE and fully connector-agnostic. It loops the Connector
 * Runtime: platform health, per-connector cards, jobs and logs are all derived by
 * the providers. Adding a connector never edits this file. Handles loading /
 * empty / error without crashing.
 */

import { Activity, Bot, Briefcase, Gauge, RotateCcw, Server } from "lucide-react";

import { getConnector } from "@/lib/connectors/registry";
import type { ConnectorHealth } from "@/lib/connectors/types";
import { useConnectorRuntime, toConnectorView } from "@/lib/runtime";
import { toBucket } from "@/lib/runtime/ConnectorHealth";
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
import type { ConnectorLog } from "@/lib/runtime/types";

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

const connectorName = (id: string): string => getConnector(id)?.name ?? id;

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

export function OperationsOverview() {
  const { snapshot, connectors, platform, logs, loading, error, refresh } = useConnectorRuntime();

  if (loading && connectors.length === 0) return <LoadingGrid />;
  if (error && connectors.length === 0) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const present = connectors.filter((c) => c.present);
  const runningJobs = connectors.reduce((n, c) => n + c.metrics.runningJobs, 0);
  const queuedJobs = connectors.reduce((n, c) => n + c.metrics.queuedJobs, 0);

  const jobs: JobsSummary = {
    running: runningJobs,
    queued: queuedJobs,
    completedToday: snapshot.global.completedToday,
    failed: snapshot.global.failedToday,
    retryQueue: 0,
    processingRate: "—",
  };

  // Health breakdown — one row per present connector (+ planned placeholders).
  const healthItems: HealthBreakdownItem[] = [
    ...present.map((c) => ({
      label: c.descriptor.name,
      icon: c.descriptor.icon,
      health: toBucket(c.status) as ConnectorHealth,
      detail:
        c.health.reasons[0] ?? `${c.metrics.records} records · ${c.metrics.errors24h} errors 24h`,
    })),
    { label: "AI", icon: Bot, health: "unknown", detail: "Module not enabled" },
    {
      label: "Business Systems",
      icon: Briefcase,
      health: "unknown",
      detail: "No systems connected",
    },
  ];

  // Queues — derived generically from each connector's queued work.
  const queues: QueueRow[] = present.map((c) => ({
    id: c.descriptor.id,
    name: `${c.descriptor.name} queue`,
    depth: c.metrics.queuedJobs,
    rate: `${c.metrics.runningJobs} running`,
    status: c.metrics.queuedJobs > 0 ? "syncing" : "connected",
  }));
  queues.push({
    id: "ai",
    name: "AI enrichment",
    depth: snapshot.phone.aiPending,
    rate: "AI module not enabled",
    status: "disabled",
  });

  const alerts: AlertItem[] = logs
    .filter((l) => l.severity === "error")
    .slice(0, 8)
    .map((l) => ({
      id: l.id,
      title: `${connectorName(l.connector)} · ${l.message.split(":")[0]}`,
      detail: l.message.includes(":") ? l.message.split(":").slice(1).join(":").trim() : undefined,
      severity: "warning",
      at: fmtTime(l.timestamp),
    }));

  const logCols: Column<ConnectorLog>[] = [
    {
      key: "timestamp",
      header: "When",
      className: "font-mono text-muted-foreground whitespace-nowrap",
      render: (l) => fmtTime(l.timestamp),
    },
    { key: "connector", header: "Connector", render: (l) => connectorName(l.connector) },
    { key: "message", header: "Event", className: "text-muted-foreground" },
    {
      key: "severity",
      header: "Severity",
      render: (l) => (
        <span className={l.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
          {l.severity}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Title + refresh */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Live · connector runtime
        </div>
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* Platform KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Connected" value={platform.connected} icon={Server} />
        <MetricCard label="Healthy" value={platform.healthy} tone="success" icon={Gauge} />
        <MetricCard label="Warnings" value={platform.warning} tone="warning" />
        <MetricCard label="Critical" value={platform.critical} tone="critical" />
        <MetricCard label="Running jobs" value={runningJobs} tone="accent" icon={Activity} />
        <MetricCard label="Failed today" value={snapshot.global.failedToday} tone="critical" />
      </div>

      {/* Jobs + system health breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        <JobsCard jobs={jobs} />
        <HealthBreakdownCard items={healthItems} />
      </div>

      {/* Connected systems — looped from the runtime */}
      <div>
        <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          Connected systems
        </div>
        {present.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-muted-foreground">
            No systems connected yet. Set up a connector in Communications.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {present.map((c) => (
              <ConnectorCard key={c.descriptor.id} connector={toConnectorView(c)} />
            ))}
          </div>
        )}
      </div>

      {/* Queues + alerts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <QueueCard queues={queues} />
        <AlertCard alerts={alerts} />
      </div>

      {/* Recent logs (aggregated across connectors) */}
      <ActivityTable
        title="Recent activity"
        columns={logCols}
        rows={logs}
        rowKey={(l) => l.id}
        emptyLabel="No connector activity yet."
      />
    </div>
  );
}
