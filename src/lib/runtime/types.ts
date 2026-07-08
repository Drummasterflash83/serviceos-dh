/**
 * Connector Runtime — the generic types every connector plugs into. Slack,
 * Microsoft 365, QuickBooks, Commusoft … all become configuration that maps the
 * tenant snapshot into these shapes. The UI renders these types and NEVER checks
 * a vendor, so adding a connector is a provider file — not a UI change.
 */

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import type { ConnectorDescriptor, ConnectorMetric } from "@/lib/connectors/types";
import type { OperationsSnapshot } from "@/lib/ops-metrics";

/** Generic health model (deliverable 5). Every connector maps into these. */
export type RuntimeHealth =
  "healthy" | "warning" | "critical" | "disconnected" | "syncing" | "backfilling" | "disabled";

/** Generic metrics every connector returns (deliverable 6). */
export interface ConnectorMetrics {
  connections: number;
  activeAccounts: number;
  lastSync: string | null;
  records: number;
  errors24h: number;
  runningJobs: number;
  queuedJobs: number;
  /** Human label, e.g. "5m" or "—" (no bespoke metric shapes). */
  averageSyncTime: string;
  /** 0–100 roll-up. */
  healthScore: number;
}

export type LogSeverity = "debug" | "info" | "warning" | "error";

/** Generic log line (deliverable 7). Every connector writes these. */
export interface ConnectorLog {
  id: string;
  timestamp: string;
  connector: string;
  severity: LogSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

export type JobStatus = "running" | "queued" | "success" | "failed" | "cancelled";

/** Generic runtime job (deliverable 4). Connectors register jobs; no bespoke UI. */
export interface ConnectorJob {
  id: string;
  connector: string;
  type: string;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  recordsProcessed: number;
  errors: number;
  metadata?: Record<string, unknown>;
  retry: () => Promise<void>;
  cancel: () => Promise<void>;
}

/** Standard action kinds (deliverable 8). */
export type ConnectorActionKind =
  | "connect"
  | "disconnect"
  | "sync"
  | "backfill"
  | "reconnect"
  | "retry"
  | "health"
  | "logs"
  | "settings"
  | "disable";

export interface ConnectorActionSpec {
  id: string;
  kind: ConnectorActionKind;
  label: string;
  description?: string;
  destructive?: boolean;
}

export interface ConnectorHealthReport {
  status: RuntimeHealth;
  score: number;
  reasons: string[];
}

export type DiagnosticTone = "default" | "success" | "warning" | "critical" | "muted";

/** One label/value diagnostic line in a connector's Health panel. */
export interface DiagnosticRow {
  label: string;
  value: string;
  tone?: DiagnosticTone;
}

/** A titled group of diagnostics (deliverable: real Health panels per connector). */
export interface DiagnosticGroup {
  title: string;
  rows: DiagnosticRow[];
}

/**
 * Optional props passed to a settings surface Component when it is opened from
 * the Operations Overview (deep-link handoff). `focus` names a sub-section to
 * open/scroll to; `focusNonce` changes on every navigation so the same target
 * re-applies even when clicked twice.
 */
export interface ConnectorSurfaceProps {
  focus?: string;
  focusNonce?: number;
}

/** Where a connector's management UI renders (Communications tab). */
export interface ConnectorSettingsSurface {
  /** Surface key — connectors sharing a surface share a tab (e.g. gmail + workspace → "email"). */
  surface: string;
  title: string;
  icon?: LucideIcon;
  Component: ComponentType<ConnectorSurfaceProps>;
}

/**
 * The standard connector interface (deliverable 2). Google Workspace, Gmail and
 * Simwood implement this by wrapping existing functionality — no behaviour change.
 * connect/disconnect/sync are advertised as action specs; the executable controls
 * live in each connector's `settings()` surface (unchanged existing UIs).
 */
export interface ConnectorProvider {
  readonly descriptor: ConnectorDescriptor;
  connect(): ConnectorActionSpec | null;
  disconnect(): ConnectorActionSpec | null;
  sync(): ConnectorActionSpec | null;
  status(snapshot: OperationsSnapshot): RuntimeHealth;
  health(snapshot: OperationsSnapshot): ConnectorHealthReport;
  metrics(snapshot: OperationsSnapshot): ConnectorMetrics;
  /** Connector-specific labelled tiles for the card (Mailboxes, Calls, …). */
  cardMetrics?(snapshot: OperationsSnapshot): ConnectorMetric[];
  /** Connector-specific Health-panel diagnostics, all from real snapshot data. */
  diagnostics(snapshot: OperationsSnapshot): DiagnosticGroup[];
  logs(snapshot: OperationsSnapshot): ConnectorLog[];
  jobs(snapshot: OperationsSnapshot): ConnectorJob[];
  settings(): ConnectorSettingsSurface;
  actions(): ConnectorActionSpec[];
}

/** A connector resolved against the live snapshot — what dashboards render. */
export interface RuntimeConnector {
  descriptor: ConnectorDescriptor;
  present: boolean;
  status: RuntimeHealth;
  health: ConnectorHealthReport;
  metrics: ConnectorMetrics;
  cardMetrics: ConnectorMetric[];
  diagnostics: DiagnosticGroup[];
  jobs: ConnectorJob[];
  logs: ConnectorLog[];
  actions: ConnectorActionSpec[];
  settings: ConnectorSettingsSurface;
}

export type { OperationsSnapshot };
