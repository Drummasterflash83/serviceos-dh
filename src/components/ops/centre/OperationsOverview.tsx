/**
 * OperationsOverview — LIVE and fully connector-agnostic. It loops the Connector
 * Runtime: platform health, per-connector cards, jobs and logs are all derived by
 * the providers. Every card action does real work — Sync/Reconnect call the
 * runtime action runner, Health opens a diagnostics drawer, Logs filters the
 * activity feed, Settings hands off to the detail surface. Adding a connector
 * never edits this file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bot, Briefcase, Gauge, RotateCcw, Server, X } from "lucide-react";

import { getConnector } from "@/lib/connectors/registry";
import type { ConnectorAction, ConnectorHealth } from "@/lib/connectors/types";
import { useAuth } from "@/lib/auth";
import { useConnectorRuntime, toConnectorView } from "@/lib/runtime";
import { toBucket } from "@/lib/runtime/ConnectorHealth";
import { runConnectorAction } from "@/lib/runtime/ConnectorActionRunner";
import type { RuntimeConnector } from "@/lib/runtime/types";
import {
  getPlatformJobSummary,
  listPlatformJobs,
  type PlatformJob,
  type PlatformJobSummary,
} from "@/lib/platform-jobs";
import {
  getInteractionSummary,
  syncInteractions,
  type InteractionSummary,
} from "@/lib/interactions";
import { getCardsSummary, type CardsSummary } from "@/lib/cards";
import { getMatchSummary, type MatchSummary } from "@/lib/matching";
import { getSchedulerHealth, type SchedulerHealthItem } from "@/lib/scheduler-health";
import { getLiveCallOpsSummary, type LiveCallOpsSummary } from "@/lib/live-calls";
import { getIdentitySummary, type IdentitySummary } from "@/lib/identity";
import { getPhonePipelineStatus, getEmailConnectorStatus } from "@/lib/api";
import {
  getBusinessGraphSummary,
  listGraphEdges,
  listGraphNodes,
  syncBusinessGraph,
  type GraphSummary,
  type GraphNode,
  type GraphEdge,
} from "@/lib/business-graph";
import {
  getCustomerCardSummary,
  syncCustomerCards,
  type CustomerCardSummary,
} from "@/lib/customer-cards";
import {
  getRecommendationSummary,
  syncRecommendations,
  type RecommendationSummary,
} from "@/lib/recommendations";
import type { ApiResult, PhonePipelineStatusResult, EmailConnectorStatusResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  ActivityTable,
  AlertCard,
  ConnectorCard,
  ConnectorHealthPanel,
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
import type { OpsNavTarget } from "./nav";

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

/** Seconds elapsed since an ISO timestamp (0 if unparseable). */
function ageSeconds(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/** Humanise a duration in seconds ("clear" handled by caller): "3m" · "2h 5m" · "1d 4h". */
function fmtDur(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return "<1m";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

/** Seconds-precision "last refreshed" label (now · 3 sec ago · 35 sec ago · 2m ago). */
function fmtRefreshed(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 3) return "now";
  if (secs < 60) return `${secs} sec ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return fmtTime(iso);
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

const connectorName = (id: string): string => getConnector(id)?.name ?? id;

/** Which detail sub-section a connector's Settings action opens. */
function settingsFocus(id: string): string {
  if (id === "google_workspace") return "workspace-settings";
  if (id === "gmail") return "gmail";
  return "diagnostics";
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

export function OperationsOverview({
  onNavigate,
}: {
  onNavigate?: (target: OpsNavTarget) => void;
}) {
  const { snapshot, connectors, platform, logs, loading, error, refresh } = useConnectorRuntime();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? "";

  const [busy, setBusy] = useState<{ id: string; action: ConnectorAction } | null>(null);
  const [healthConn, setHealthConn] = useState<RuntimeConnector | null>(null);
  const [logFilter, setLogFilter] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{
    ok: boolean;
    title: string;
    message: string;
  } | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const activityRef = useRef<HTMLDivElement>(null);

  // Real Platform Jobs + Business Timeline (separate reads from the snapshot).
  const [jobsSummary, setJobsSummary] = useState<ApiResult<PlatformJobSummary> | null>(null);
  const [recentJobs, setRecentJobs] = useState<PlatformJob[]>([]);
  const [interactions, setInteractions] = useState<ApiResult<InteractionSummary> | null>(null);
  const [cards, setCards] = useState<ApiResult<CardsSummary> | null>(null);
  const [matches, setMatches] = useState<ApiResult<MatchSummary> | null>(null);
  const [schedulers, setSchedulers] = useState<ApiResult<SchedulerHealthItem[]> | null>(null);
  const [liveCalls, setLiveCalls] = useState<ApiResult<LiveCallOpsSummary> | null>(null);
  const [identity, setIdentity] = useState<ApiResult<IdentitySummary> | null>(null);
  const [phonePipeline, setPhonePipeline] = useState<ApiResult<PhonePipelineStatusResult> | null>(
    null,
  );
  const [emailStatus, setEmailStatus] = useState<ApiResult<EmailConnectorStatusResult> | null>(
    null,
  );
  const [graph, setGraph] = useState<ApiResult<GraphSummary> | null>(null);
  const [buildingGraph, setBuildingGraph] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [customerCards, setCustomerCards] = useState<ApiResult<CustomerCardSummary> | null>(null);
  const [buildingCards, setBuildingCards] = useState(false);
  const [recs, setRecs] = useState<ApiResult<RecommendationSummary> | null>(null);
  const [buildingRecs, setBuildingRecs] = useState(false);
  const [buildingTimeline, setBuildingTimeline] = useState(false);

  const loadJobs = useCallback(async () => {
    const noTenant = <T,>(): Promise<ApiResult<T>> =>
      Promise.resolve<ApiResult<T>>({
        ok: false,
        error: { code: "no_tenant", message: "No tenant in session" },
      });
    const [sum, list, inter, card, match, sched, live, ident, phone, email, gr, cc, rc] =
      await Promise.all([
        getPlatformJobSummary(),
        listPlatformJobs({ limit: 12 }),
        getInteractionSummary(),
        getCardsSummary(),
        getMatchSummary(),
        getSchedulerHealth(),
        getLiveCallOpsSummary(),
        getIdentitySummary(),
        // Business-health summaries — the SAME single sources Admin reads for full
        // diagnostics. Skipped until a tenant is known.
        tenantId ? getPhonePipelineStatus(tenantId) : noTenant<PhonePipelineStatusResult>(),
        tenantId ? getEmailConnectorStatus(tenantId) : noTenant<EmailConnectorStatusResult>(),
        getBusinessGraphSummary(),
        getCustomerCardSummary(),
        getRecommendationSummary(),
      ]);
    setJobsSummary(sum);
    setRecentJobs(list.ok ? list.data : []);
    setInteractions(inter);
    setCards(card);
    setMatches(match);
    setSchedulers(sched);
    setLiveCalls(live);
    setIdentity(ident);
    setPhonePipeline(phone);
    setEmailStatus(email);
    setGraph(gr);
    setCustomerCards(cc);
    setRecs(rc);
  }, [tenantId]);

  async function buildCards() {
    setBuildingCards(true);
    await syncCustomerCards();
    setBuildingCards(false);
    void loadJobs();
  }

  async function buildRecs() {
    setBuildingRecs(true);
    await syncRecommendations();
    setBuildingRecs(false);
    void loadJobs();
  }

  async function buildGraph() {
    setBuildingGraph(true);
    await syncBusinessGraph("all");
    setBuildingGraph(false);
    void loadJobs();
    if (showGraph) void loadGraphDetail();
  }

  const loadGraphDetail = useCallback(async () => {
    const [n, e] = await Promise.all([listGraphNodes(15), listGraphEdges(15)]);
    setGraphNodes(n.ok ? n.data : []);
    setGraphEdges(e.ok ? e.data : []);
  }, []);

  function toggleGraphExplorer() {
    setShowGraph((v) => {
      const next = !v;
      if (next) void loadGraphDetail();
      return next;
    });
  }

  async function buildTimeline() {
    setBuildingTimeline(true);
    await syncInteractions("all");
    setBuildingTimeline(false);
    void loadJobs();
  }

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const refreshAll = useCallback(() => {
    void refresh();
    void loadJobs();
  }, [refresh, loadJobs]);

  useEffect(() => {
    if (!loading) setLastRefreshedAt(new Date().toISOString());
  }, [loading]);

  // Live clock so "last refreshed" ticks in real time (1s). Cheap re-render only.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-refresh every 30s, but ONLY while the tab is visible (no background poll).
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") refreshAll();
    }, 30000);
    return () => clearInterval(id);
  }, [refreshAll]);

  const present = useMemo(() => connectors.filter((c) => c.present), [connectors]);

  async function handleAction(c: RuntimeConnector, action: ConnectorAction) {
    const id = c.descriptor.id;

    // UI-only actions — no backend, no mutation.
    if (action === "health") {
      setHealthConn(c);
      return;
    }
    if (action === "logs") {
      setLogFilter(id);
      activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (action === "settings") {
      onNavigate?.({
        section: "communications",
        surface: c.settings.surface,
        focus: settingsFocus(id),
      });
      return;
    }
    // Workspace Sync is a handoff to the authoritative Email surface (per design).
    if (action === "sync" && id === "google_workspace") {
      onNavigate?.({ section: "communications", surface: "email", focus: "workspace-sync" });
      return;
    }

    // Real backend actions: Sync (gmail/simwood) + Reconnect (all).
    setBusy({ id, action });
    setActionResult(null);
    const res = await runConnectorAction(id, action, { tenantId });
    setBusy(null);
    setActionResult({ ok: res.ok, title: res.title, message: res.message });
    if (!res.redirected) {
      void refresh();
      void loadJobs();
    }
  }

  if (loading && connectors.length === 0) return <LoadingGrid />;
  if (error && connectors.length === 0) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const runningJobs = connectors.reduce((n, c) => n + c.metrics.runningJobs, 0);
  const queuedJobs = connectors.reduce((n, c) => n + c.metrics.queuedJobs, 0);

  // Jobs widget reads REAL platform_jobs. Unavailable (table unreadable) is shown
  // honestly, never as zero. Empty-but-readable shows zeros + "No platform jobs".
  const jobsData = jobsSummary?.ok ? jobsSummary.data : null;
  const jobsUnavailable = jobsSummary !== null && !jobsSummary.ok;
  const jobs: JobsSummary = {
    running: jobsData?.running ?? 0,
    queued: jobsData?.queued ?? 0,
    completedToday: jobsData?.succeeded_today ?? 0,
    failed: jobsData?.failed_today ?? 0,
    retryQueue: jobsData?.retrying ?? 0,
    processingRate:
      jobsData && jobsData.avg_duration_seconds !== null
        ? `${fmtDuration(jobsData.avg_duration_seconds)} avg`
        : "—",
  };
  const lastCompleted = jobsData?.last_completed ?? null;

  // Business timeline (canonical interactions) — honest empty/unavailable states.
  const interData = interactions?.ok ? interactions.data : null;
  const interUnavailable = interactions !== null && !interactions.ok;
  const timelineNotBuilt = !!interData && interData.latest_interaction_at === null;

  // Signals / cards / matches / scheduler — all honest (real evidence only).
  const cardsData = cards?.ok ? cards.data : null;
  const matchData = matches?.ok ? matches.data : null;
  const schedulerItems = schedulers?.ok ? schedulers.data : null;
  const liveData = liveCalls?.ok ? liveCalls.data : null;
  const liveUnavailable = liveCalls !== null && !liveCalls.ok;
  const identData = identity?.ok ? identity.data : null;
  const identUnavailable = identity !== null && !identity.ok;
  /** Show a real count, or "—" when the source is unavailable. */
  const metric = (v: number | null | undefined): string | number =>
    typeof v === "number" ? v : "—";

  // Health breakdown — one row per present connector (+ honest placeholders).
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

  // Operational warnings — fully provider-owned (no vendor branching here). Each
  // warning names its own recommended action, wired generically to handleAction.
  const warnings: AlertItem[] = connectors.flatMap((c) =>
    c.warnings.map((w) => ({
      id: w.id,
      title: `${c.descriptor.name} · ${w.title}`,
      detail: w.detail,
      severity: w.severity,
      action: w.recommendedAction
        ? {
            label: w.actionLabel ?? "Fix",
            onClick: () => void handleAction(c, w.recommendedAction!),
          }
        : { label: "Open details", onClick: () => setHealthConn(c) },
    })),
  );

  const shownLogs = logFilter ? logs.filter((l) => l.connector === logFilter) : logs;

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

  const jobStatusCls = (s: string): string =>
    s === "running"
      ? "text-accent"
      : s === "succeeded"
        ? "text-success"
        : s === "failed"
          ? "text-destructive"
          : s === "cancelled" || s === "skipped"
            ? "text-muted-foreground"
            : "text-warning"; // queued | retrying

  const jobCols: Column<PlatformJob>[] = [
    {
      key: "connector",
      header: "Connector",
      render: (j) =>
        connectorName((j.connector_id ?? "").replace("google-workspace", "google_workspace")),
    },
    { key: "job_type", header: "Job", className: "font-mono text-muted-foreground" },
    {
      key: "status",
      header: "Status",
      render: (j) => <span className={jobStatusCls(j.status)}>{j.status}</span>,
    },
    {
      key: "progress",
      header: "Progress",
      className: "tabular text-muted-foreground",
      render: (j) => (j.progress_total ? `${j.progress_current}/${j.progress_total}` : "—"),
    },
    {
      key: "records",
      header: "Records",
      className: "tabular text-muted-foreground",
      render: (j) => String(j.records_processed),
    },
    {
      key: "when",
      header: "When",
      className: "whitespace-nowrap text-muted-foreground",
      render: (j) => fmtTime(j.completed_at ?? j.failed_at ?? j.started_at ?? j.created_at),
    },
    {
      key: "error",
      header: "Error",
      className: "text-destructive",
      render: (j) => (j.last_error ? j.last_error.slice(0, 60) : ""),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Title + last refreshed + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Live · operations centre · last refreshed {fmtRefreshed(lastRefreshedAt)}
        </div>
        <Button size="sm" variant="outline" onClick={refreshAll} disabled={loading}>
          <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* Action result banner */}
      {actionResult && (
        <div
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            actionResult.ok
              ? "border-success/20 bg-success/10 text-success"
              : "border-destructive/20 bg-destructive/10 text-destructive"
          }`}
        >
          <span>
            <span className="font-medium">{actionResult.title}:</span> {actionResult.message}
          </span>
          <button
            onClick={() => setActionResult(null)}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Operational warnings — the "what needs attention" surface (provider-owned) */}
      {warnings.length > 0 && <AlertCard title="Operational warnings" alerts={warnings} />}

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
        {jobsUnavailable ? (
          <div className="rounded-2xl border border-hairline bg-white p-6">
            <div className="text-sm font-semibold">Jobs</div>
            <p className="mt-3 text-xs text-muted-foreground">
              Jobs unavailable — the platform jobs table could not be read.
            </p>
          </div>
        ) : (
          <div>
            <JobsCard jobs={jobs} title="Platform jobs" />
            <div className="mt-2 px-1 text-[11px] text-muted-foreground">
              {lastCompleted
                ? `Last completed · ${lastCompleted.job_type} · ${fmtTime(lastCompleted.completed_at)}`
                : "No completed jobs yet."}
            </div>
          </div>
        )}
        <HealthBreakdownCard items={healthItems} />
      </div>

      {/* Business timeline — canonical interactions status (honest states) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Business timeline</div>
            <div className="text-xs text-muted-foreground">
              Builds automatically from calls &amp; email — this button is a recovery override.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void buildTimeline()}
            disabled={buildingTimeline}
            title="Override: rebuild the timeline now (normally automatic)"
          >
            {buildingTimeline ? "Building…" : timelineNotBuilt ? "Build timeline" : "Rebuild"}
          </Button>
        </div>
        {interUnavailable ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Timeline unavailable — the interactions table could not be read.
          </p>
        ) : timelineNotBuilt ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Timeline not built yet — build it from existing calls and emails.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <MetricCard label="Interactions today" value={interData?.total_today ?? 0} />
            <MetricCard label="Calls today" value={interData?.phone_today ?? 0} tone="accent" />
            <MetricCard label="Emails today" value={interData?.email_today ?? 0} tone="accent" />
            <MetricCard
              label="Pending"
              value={interData?.pending_processing ?? 0}
              tone={interData && interData.pending_processing > 0 ? "warning" : "default"}
            />
            <MetricCard label="Latest" value={fmtTime(interData?.latest_interaction_at ?? null)} />
          </div>
        )}
      </div>

      {/* Signals & customer cards — the foundation for the daily work surface */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-hairline bg-white p-6">
          <div className="text-sm font-semibold">Signals &amp; cards</div>
          <div className="text-xs text-muted-foreground">
            Every interaction is a signal; cards &amp; matches build over time.
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetricCard
              label="Signals today"
              value={metric(interData?.total_today)}
              tone="accent"
            />
            <MetricCard
              label="Unprocessed"
              value={metric(interData?.pending_processing)}
              tone={interData && interData.pending_processing > 0 ? "warning" : "default"}
            />
            <MetricCard label="Customer cards" value={metric(cardsData?.total)} />
            <MetricCard
              label="Suggested matches"
              value={metric(matchData?.pending)}
              tone={matchData && matchData.pending > 0 ? "accent" : "default"}
            />
            <MetricCard
              label="Urgent cards"
              value={metric(cardsData?.urgent)}
              tone={cardsData && cardsData.urgent > 0 ? "critical" : "default"}
            />
            <MetricCard label="Waiting" value={metric(cardsData?.waiting)} />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {cardsData && cardsData.total === 0
              ? "No customer cards yet — cards build automatically as signals are enriched."
              : "Cards & match suggestions are populated by background enrichment (no fake data)."}
          </p>
        </div>

        {/* Scheduler health — is automatic processing actually running? */}
        <div className="rounded-2xl border border-hairline bg-white p-6">
          <div className="text-sm font-semibold">Scheduler health</div>
          <div className="text-xs text-muted-foreground">
            Automatic processing cadence — “never” means the cron isn’t configured yet.
          </div>
          {!schedulerItems ? (
            <p className="mt-3 text-xs text-muted-foreground">Scheduler status unavailable.</p>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {schedulerItems.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-foreground">{s.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {fmtTime(s.lastRunAt)}
                    </span>
                    <span
                      className={
                        s.status === "healthy"
                          ? "text-success"
                          : s.status === "stale"
                            ? "text-warning"
                            : s.status === "never"
                              ? "text-muted-foreground"
                              : "text-destructive"
                      }
                    >
                      {s.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Phone system — BUSINESS health (is the business operating correctly?).
          The full stage-by-stage diagnostics live in Admin › Phone Operations,
          reachable via "View diagnostics". Both read one source of truth. */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">Phone system</div>
            {phonePipeline?.ok && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  phonePipeline.data.health === "healthy"
                    ? "border-success/20 bg-success/10 text-success"
                    : phonePipeline.data.health === "warning"
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                {phonePipeline.data.health}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onNavigate?.({ section: "communications", surface: "phone", focus: "diagnostics" })
            }
          >
            View diagnostics
          </Button>
        </div>

        {!phonePipeline || !phonePipeline.ok ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Phone pipeline status unavailable — the pipeline tables could not be read.
          </p>
        ) : (
          <>
            <div className="mt-1 text-xs text-muted-foreground">
              {phonePipeline.data.health_reason}
            </div>
            {/* Business-facing only (§14): no all-time failures, no admin buttons. */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard
                label="Calls waiting"
                value={metric(phonePipeline.data.eligible_backlog)}
                tone={phonePipeline.data.eligible_backlog > 0 ? "warning" : "default"}
              />
              <MetricCard
                label="Oldest waiting"
                value={
                  phonePipeline.data.eligible_backlog === 0
                    ? "—"
                    : fmtDur(phonePipeline.data.oldest_pending_age_seconds)
                }
                tone={
                  (phonePipeline.data.oldest_pending_age_seconds ?? 0) > 1800
                    ? "critical"
                    : "default"
                }
              />
              <MetricCard
                label="Current failures"
                value={metric(phonePipeline.data.current_unresolved_failures)}
                tone={phonePipeline.data.current_unresolved_failures > 0 ? "critical" : "default"}
              />
              <MetricCard
                label="Catch-up ETA"
                value={
                  phonePipeline.data.eligible_backlog === 0
                    ? "clear"
                    : phonePipeline.data.estimated_drain_seconds === null
                      ? "waiting"
                      : fmtDur(phonePipeline.data.estimated_drain_seconds)
                }
              />
              <MetricCard
                label="Last ingestion"
                value={fmtTime(phonePipeline.data.last_ingestion_at)}
              />
              <MetricCard
                label="Last processing"
                value={fmtTime(phonePipeline.data.last_useful_at)}
              />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Throughput{" "}
              {phonePipeline.data.throughput_total_per_hour > 0
                ? `${phonePipeline.data.throughput_total_per_hour} stage advance(s)/hr`
                : "idle"}{" "}
              · ingestion every 5 min, processing every 2 min — both automatic.
            </p>
          </>
        )}
      </div>

      {/* Email — BUSINESS health for Gmail + Workspace (§14). Read the ONE
          authoritative source; full diagnostics live in Admin › Email. Only
          current (never historical) failures show; no OAuth/setup jargon. */}
      {(() => {
        const data = emailStatus?.ok ? emailStatus.data : null;
        const bad = new Set([
          "connected_failing",
          "auth_expired",
          "delegation_failed",
          "backfill_failed",
        ]);
        const warn = new Set(["connected_stale", "no_mailboxes", "needs_setup", "unknown"]);
        const badge = (state: string) =>
          bad.has(state)
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : warn.has(state)
              ? "border-warning/30 bg-warning/10 text-warning"
              : "border-success/20 bg-success/10 text-success";
        const evStr = (ev: Record<string, unknown>, k: string): string | null => {
          const v = ev[k];
          return typeof v === "string" ? v : null;
        };
        const evNum = (ev: Record<string, unknown>, k: string): number =>
          typeof ev[k] === "number" ? (ev[k] as number) : 0;
        const pipeNum = (k: string): number =>
          data && typeof data.pipeline[k] === "number" ? (data.pipeline[k] as number) : 0;
        const openDiag = () =>
          onNavigate?.({ section: "communications", surface: "email", focus: "diagnostics" });
        return (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Gmail */}
            <div className="rounded-2xl border border-hairline bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">Gmail</div>
                  {data && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badge(data.gmail.state)}`}
                    >
                      {data.gmail.state.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={openDiag}>
                  View diagnostics
                </Button>
              </div>
              {!data ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Email health unavailable — the email tables could not be read.
                </p>
              ) : (
                <>
                  <div className="mt-1 text-xs text-muted-foreground">{data.gmail.reason}</div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MetricCard
                      label="Last sync"
                      value={fmtTime(evStr(data.gmail.evidence, "last_success_at"))}
                    />
                    <MetricCard
                      label="Messages (60m)"
                      value={pipeNum("messages_last_60m")}
                      tone="accent"
                    />
                    <MetricCard
                      label="Oldest pending"
                      value={
                        pipeNum("unprojected_backlog") === 0
                          ? "—"
                          : fmtDur(pipeNum("oldest_unprojected_age_seconds"))
                      }
                      tone={
                        pipeNum("oldest_unprojected_age_seconds") > 900 ? "critical" : "default"
                      }
                    />
                    <MetricCard
                      label="Current failures"
                      value={data.gmail.currentFailure ? "yes" : 0}
                      tone={data.gmail.currentFailure ? "critical" : "default"}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Workspace */}
            <div className="rounded-2xl border border-hairline bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">Google Workspace</div>
                  {data && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badge(data.workspace.state)}`}
                    >
                      {data.workspace.state.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={openDiag}>
                  View diagnostics
                </Button>
              </div>
              {!data ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Email health unavailable — the email tables could not be read.
                </p>
              ) : (
                <>
                  <div className="mt-1 text-xs text-muted-foreground">{data.workspace.reason}</div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MetricCard
                      label="Delegation"
                      value={data.workspace.needsDelegationRetest ? "failing" : "healthy"}
                      tone={data.workspace.needsDelegationRetest ? "critical" : "success"}
                    />
                    <MetricCard
                      label="Enabled mailboxes"
                      value={evNum(data.workspace.evidence, "mailboxes_enabled")}
                    />
                    <MetricCard
                      label="Last sync"
                      value={fmtTime(evStr(data.workspace.evidence, "last_success_at"))}
                    />
                    <MetricCard
                      label="Current failures"
                      value={data.workspace.currentFailure ? "yes" : 0}
                      tone={data.workspace.currentFailure ? "critical" : "default"}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Business Graph — the shared memory layer. Nodes/edges projected from the
          system of record. "Build graph" is a manual override; normal operation is
          automatic (identity trigger + scheduled sync). No fake relationships. */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Business Graph</div>
            <div className="text-xs text-muted-foreground">
              The shared relationship layer — people, companies, interactions, cards and
              recommendations projected as nodes and edges.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {graph?.ok && graph.data.totalNodes > 0 && (
              <Button size="sm" variant="outline" onClick={toggleGraphExplorer}>
                {showGraph ? "Hide" : "Explore"}
              </Button>
            )}
            <Button size="sm" onClick={buildGraph} disabled={buildingGraph}>
              {buildingGraph ? "Building…" : "Build graph"}
            </Button>
          </div>
        </div>

        {!graph || !graph.ok ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Business Graph unavailable — the graph tables could not be read.
          </p>
        ) : graph.data.totalNodes === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Business Graph not built yet — press “Build graph”, or it builds automatically as
            identities are enriched.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Nodes" value={metric(graph.data.totalNodes)} />
              <MetricCard label="Edges" value={metric(graph.data.totalEdges)} />
              <MetricCard label="People" value={metric(graph.data.people)} />
              <MetricCard label="Companies" value={metric(graph.data.companies)} />
              <MetricCard label="Interactions" value={metric(graph.data.interactions)} />
              <MetricCard label="Cards" value={metric(graph.data.cards)} />
              <MetricCard label="Recommendations" value={metric(graph.data.recommendations)} />
              <MetricCard
                label="Avg confidence"
                value={graph.data.avgConfidence === null ? "—" : String(graph.data.avgConfidence)}
              />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Latest graph event{" "}
              {graph.data.latestEvent ? fmtTime(graph.data.latestEvent.created_at) : "never"} ·
              builds automatically on enrichment and on a schedule.
            </p>

            {showGraph && (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Recent nodes
                  </div>
                  <ul className="mt-2 divide-y divide-hairline rounded-xl border border-hairline">
                    {graphNodes.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-muted-foreground">No nodes.</li>
                    ) : (
                      graphNodes.map((n) => (
                        <li
                          key={n.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <span className="min-w-0 truncate">{n.label ?? n.node_type}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {n.node_type}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Recent edges
                  </div>
                  <ul className="mt-2 divide-y divide-hairline rounded-xl border border-hairline">
                    {graphEdges.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-muted-foreground">No edges.</li>
                    ) : (
                      graphEdges.map((e) => (
                        <li
                          key={e.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <span className="font-mono text-[11px]">{e.edge_type}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {e.confidence === null ? "—" : e.confidence}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Customer Health — projections of the Business Graph (health/activity/
          confidence). "Build cards" is a manual override; normal operation is
          automatic (scheduled after the graph). No fake data. */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Customer health</div>
            <div className="text-xs text-muted-foreground">
              Projected from the Business Graph — read-only, all calculated and explainable.
            </div>
          </div>
          <Button size="sm" onClick={buildCards} disabled={buildingCards}>
            {buildingCards ? "Building…" : "Build cards"}
          </Button>
        </div>

        {!customerCards || !customerCards.ok ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Customer cards unavailable — the projection tables could not be read.
          </p>
        ) : customerCards.data.projected === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No projected cards yet — press “Build cards”, or they build automatically after the
            graph.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Excellent" value={metric(customerCards.data.excellent)} />
              <MetricCard label="Good" value={metric(customerCards.data.good)} />
              <MetricCard
                label="Attention"
                value={metric(customerCards.data.attention)}
                tone={customerCards.data.attention > 0 ? "warning" : "default"}
              />
              <MetricCard
                label="Critical"
                value={metric(customerCards.data.critical)}
                tone={customerCards.data.critical > 0 ? "critical" : "default"}
              />
              <MetricCard
                label="Avg activity"
                value={
                  customerCards.data.avgActivityScore === null
                    ? "—"
                    : String(customerCards.data.avgActivityScore)
                }
              />
              <MetricCard
                label="Avg confidence"
                value={
                  customerCards.data.avgConfidence === null
                    ? "—"
                    : String(customerCards.data.avgConfidence)
                }
              />
              <MetricCard label="Projected" value={metric(customerCards.data.projected)} />
              <MetricCard
                label="Latest card"
                value={fmtTime(customerCards.data.latestProjectedAt)}
              />
            </div>
            {customerCards.data.topWaiting && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Top waiting customer:{" "}
                <span className="text-foreground">
                  {customerCards.data.topWaiting.title ?? "Customer"}
                </span>{" "}
                · {customerCards.data.topWaiting.waiting} waiting action(s)
              </p>
            )}
          </>
        )}
      </div>

      {/* Recommendations — deterministic next-actions from card/interaction state.
          "Generate" is a manual override; normal operation is automatic (scheduled
          after customer cards). No fake data, no auto-execution. */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Recommendations</div>
            <div className="text-xs text-muted-foreground">
              Rule-based next-actions — the bridge from cards to My Day. No AI, no auto-execution.
            </div>
          </div>
          <Button size="sm" onClick={buildRecs} disabled={buildingRecs}>
            {buildingRecs ? "Generating…" : "Generate"}
          </Button>
        </div>

        {!recs || !recs.ok ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Recommendations unavailable — the table could not be read.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Open" value={metric(recs.data.open)} />
              <MetricCard
                label="Critical"
                value={metric(recs.data.critical)}
                tone={recs.data.critical > 0 ? "critical" : "default"}
              />
              <MetricCard
                label="High"
                value={metric(recs.data.high)}
                tone={recs.data.high > 0 ? "warning" : "default"}
              />
              <MetricCard
                label="Overdue"
                value={metric(recs.data.overdue)}
                tone={recs.data.overdue > 0 ? "critical" : "default"}
              />
              <MetricCard label="Generated today" value={metric(recs.data.today)} />
              <MetricCard label="Closed today" value={metric(recs.data.closedToday)} />
              <MetricCard label="Latest" value={fmtTime(recs.data.latestGeneratedAt)} />
            </div>
            {recs.data.open === 0 && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                No open recommendations — nothing needs action right now.
              </p>
            )}
          </>
        )}
      </div>

      {/* Worker queue — async platform_jobs queue (Async Worker Queue v1). Truthful
          state only: dead-letters and expired leases are surfaced, never hidden. */}
      {(() => {
        const q = jobsSummary?.ok ? jobsSummary.data : null;
        return (
          <div className="rounded-2xl border border-hairline bg-white p-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Worker queue</div>
                <div className="text-xs text-muted-foreground">
                  Schedulers enqueue; the worker claims and processes asynchronously.
                </div>
              </div>
              {q && q.dead_letter > 0 && (
                <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                  {q.dead_letter} dead-letter
                </span>
              )}
            </div>
            {!jobsSummary || !jobsSummary.ok ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Queue unavailable — platform_jobs could not be read.
              </p>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricCard label="Queued" value={metric(q?.queued)} />
                  <MetricCard label="Running" value={metric(q?.running)} tone="accent" />
                  <MetricCard
                    label="Retrying"
                    value={metric(q?.retrying)}
                    tone={q && q.retrying > 0 ? "warning" : "default"}
                  />
                  <MetricCard
                    label="Dead-letter"
                    value={metric(q?.dead_letter)}
                    tone={q && q.dead_letter > 0 ? "critical" : "default"}
                  />
                  <MetricCard label="Succeeded today" value={metric(q?.succeeded_today)} />
                  <MetricCard
                    label="Failed today"
                    value={metric(q?.failed_today)}
                    tone={q && q.failed_today > 0 ? "warning" : "default"}
                  />
                  <MetricCard
                    label="Oldest queued"
                    value={q?.oldest_queued_at ? fmtDur(ageSeconds(q.oldest_queued_at)) : "—"}
                    tone={
                      q?.oldest_queued_at && ageSeconds(q.oldest_queued_at) > 900
                        ? "warning"
                        : "default"
                    }
                  />
                  <MetricCard
                    label="Avg duration"
                    value={q?.avg_duration_seconds == null ? "—" : fmtDur(q.avg_duration_seconds)}
                  />
                </div>
                {q && q.expired_leases > 0 && (
                  <p className="mt-3 text-[11px] text-warning">
                    {q.expired_leases} running job(s) with an expired lease — reclaimed on the next
                    worker tick.
                  </p>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Intelligence — identity resolution engine (evidence-based, honest states) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="text-sm font-semibold">Intelligence · identity engine</div>
        <div className="text-xs text-muted-foreground">
          Evidence-based who/company resolution, card enrichment and recommendations.
        </div>
        {identUnavailable ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Identity engine unavailable — the engine tables could not be read.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                label="Identity jobs today"
                value={metric(identData?.identityJobsToday)}
              />
              <MetricCard
                label="Signals processed"
                value={metric(identData?.signalsProcessed)}
                tone="accent"
              />
              <MetricCard
                label="Cards enriched today"
                value={metric(identData?.cardsEnrichedToday)}
              />
              <MetricCard
                label="Recommendations today"
                value={metric(identData?.recommendationsToday)}
                tone={identData && identData.recommendationsToday > 0 ? "accent" : "default"}
              />
              <MetricCard
                label="Open recommendations"
                value={metric(identData?.recommendationsOpen)}
                tone={identData && identData.recommendationsOpen > 0 ? "warning" : "default"}
              />
              <MetricCard
                label="Unknown people"
                value={metric(identData?.unknownPeople)}
                tone={identData && identData.unknownPeople > 0 ? "warning" : "default"}
              />
              <MetricCard label="Unknown companies" value={metric(identData?.unknownCompanies)} />
              <MetricCard
                label="Avg confidence"
                value={
                  identData && identData.avgConfidence !== null
                    ? `${Math.round(identData.avgConfidence * 100)}%`
                    : "—"
                }
                tone="accent"
              />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Last identity job {fmtTime(identData?.latestIdentityJobAt ?? null)}. Matches are
              evidence-led and reversible — never silently merged.
            </p>
          </>
        )}
      </div>

      {/* Live calls — real-time operational surface health */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="text-sm font-semibold">Live calls</div>
        <div className="text-xs text-muted-foreground">
          Real-time inbound calls surfaced to the assigned user; webhook health.
        </div>
        {liveUnavailable ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Live calls unavailable — the live-call tables could not be read.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Active"
              value={metric(liveData?.active)}
              tone={liveData && liveData.active > 0 ? "accent" : "default"}
            />
            <MetricCard
              label="Unassigned"
              value={metric(liveData?.unassigned)}
              tone={liveData && liveData.unassigned > 0 ? "warning" : "default"}
            />
            <MetricCard label="Extension mappings" value={metric(liveData?.mappings)} />
            <MetricCard label="Latest webhook" value={fmtTime(liveData?.latestEventAt ?? null)} />
          </div>
        )}
      </div>

      {/* Recent platform jobs — the durable execution record */}
      {!jobsUnavailable && (
        <ActivityTable
          title="Recent jobs"
          columns={jobCols}
          rows={recentJobs}
          rowKey={(j) => j.id}
          emptyLabel="No platform jobs yet."
        />
      )}

      {/* Connected systems — looped from the runtime, every action live */}
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
              <ConnectorCard
                key={c.descriptor.id}
                connector={toConnectorView(c)}
                reason={c.health.reasons[0]}
                score={c.health.score}
                busy={busy?.id === c.descriptor.id ? busy.action : null}
                onAction={(a) => void handleAction(c, a)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Queues */}
      <QueueCard queues={queues} />

      {/* Recent logs (aggregated across connectors) */}
      <div ref={activityRef}>
        {logFilter && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-hairline bg-surface-alt/60 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              Filtered to{" "}
              <span className="font-medium text-foreground">{connectorName(logFilter)}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => setLogFilter(null)}
            >
              <X className="h-3.5 w-3.5" />
              Clear filter
            </Button>
          </div>
        )}
        <ActivityTable
          title="Recent activity"
          columns={logCols}
          rows={shownLogs}
          rowKey={(l) => l.id}
          emptyLabel={
            logFilter ? "No activity for this connector yet." : "No connector activity yet."
          }
        />
      </div>

      <ConnectorHealthPanel
        connector={healthConn}
        open={healthConn !== null}
        onOpenChange={(o) => {
          if (!o) setHealthConn(null);
        }}
        onAction={(a) => {
          if (healthConn) void handleAction(healthConn, a);
        }}
      />
    </div>
  );
}
