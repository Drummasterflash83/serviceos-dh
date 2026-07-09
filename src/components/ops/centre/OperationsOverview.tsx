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
import type { ApiResult } from "@/lib/types";
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
  const [buildingTimeline, setBuildingTimeline] = useState(false);

  const loadJobs = useCallback(async () => {
    const [sum, list, inter, card, match, sched, live, ident] = await Promise.all([
      getPlatformJobSummary(),
      listPlatformJobs({ limit: 12 }),
      getInteractionSummary(),
      getCardsSummary(),
      getMatchSummary(),
      getSchedulerHealth(),
      getLiveCallOpsSummary(),
      getIdentitySummary(),
    ]);
    setJobsSummary(sum);
    setRecentJobs(list.ok ? list.data : []);
    setInteractions(inter);
    setCards(card);
    setMatches(match);
    setSchedulers(sched);
    setLiveCalls(live);
    setIdentity(ident);
  }, []);

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
