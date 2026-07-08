/**
 * Operational Truth — the shared freshness + evidence-based health model.
 *
 * The golden rule: the system never silently lies. A connector is "healthy" ONLY
 * with evidence — a recent successful sync, within its expected interval, with no
 * newer failure, configured, and authenticated. Everything derives from these
 * facts, not from row counts. Every connector provider maps its snapshot into a
 * `ConnectorFreshness` via `calculateFreshness`, then `deriveHealth` turns that
 * (plus config/auth flags) into the status, a documented 0–100 score, and the
 * human reasons the UI shows.
 */

import type { RuntimeHealth } from "./types";

export type FreshnessStatus = "healthy" | "stale" | "offline" | "never_run" | "unknown";

export interface ConnectorFreshness {
  last_success: string | null;
  last_failure: string | null;
  last_attempt: string | null;
  /** Expected time between successful runs, in seconds (the schedule cadence). */
  expected_interval: number;
  /** Seconds since the last success, or null if never. */
  age_seconds: number | null;
  status: FreshnessStatus;
}

export interface FreshnessInput {
  lastSuccess: string | null;
  lastFailure?: string | null;
  lastAttempt?: string | null;
  /** Schedule cadence in seconds (e.g. 300 for a 5-minute cron). */
  expectedIntervalSec: number;
  /** Is the connector actually set up (account/connection saved)? */
  configured: boolean;
  /** Is authentication currently valid? undefined = don't know (treated as ok). */
  authOk?: boolean;
  /** Grace before "stale" — defaults to 3× the interval (tolerates one miss). */
  staleAfterSec?: number;
  /** Injected clock for tests; defaults to Date.now(). */
  now?: number;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Compute a connector's freshness purely from operational evidence. */
export function calculateFreshness(input: FreshnessInput): ConnectorFreshness {
  const now = input.now ?? Date.now();
  const successMs = parseMs(input.lastSuccess);
  const ageSeconds = successMs === null ? null : Math.max(0, (now - successMs) / 1000);
  const staleAfter = input.staleAfterSec ?? input.expectedIntervalSec * 3;

  let status: FreshnessStatus;
  if (!input.configured) status = "unknown";
  else if (input.authOk === false) status = "offline";
  else if (successMs === null) status = "never_run";
  else if (ageSeconds !== null && ageSeconds > staleAfter) status = "stale";
  else status = "healthy";

  return {
    last_success: input.lastSuccess,
    last_failure: input.lastFailure ?? null,
    last_attempt: input.lastAttempt ?? input.lastFailure ?? input.lastSuccess ?? null,
    expected_interval: input.expectedIntervalSec,
    age_seconds: ageSeconds,
    status,
  };
}

/** Compact human age ("3m", "31m", "2h", "never"). */
export function fmtAge(seconds: number | null): string {
  if (seconds === null) return "never";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Compact cadence ("5 min", "1 h"). */
export function fmtInterval(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

export interface DeriveHealthInput {
  freshness: ConnectorFreshness;
  configured: boolean;
  authOk: boolean;
  /** True when the most recent failure is newer than the most recent success. */
  hasNewerFailure?: boolean;
  /** In-flight failed jobs (running-but-erroring). */
  runningFailures?: number;
  /** A configuration gap that is not itself fatal, e.g. "No mailboxes discovered". */
  configIssue?: string | null;
  /** A hard, connector-defined critical/offline condition, e.g. "Delegation error". */
  criticalIssue?: string | null;
  /** True when work is actively in progress (sync/backfill). */
  syncing?: boolean;
  /** True when the in-progress work is a historical backfill (distinct badge). */
  backfilling?: boolean;
  /** Extra provider reasons appended verbatim. */
  extraReasons?: string[];
}

export interface DerivedHealth {
  status: RuntimeHealth;
  score: number;
  reasons: string[];
}

/**
 * Evidence-based health + score. WEIGHTING (documented, applied to a 100 base):
 *   • freshness offline .......... −60   (auth failed / connector down)
 *   • freshness never_run ........ −45   (configured but never synced)
 *   • freshness stale ............ −30   (no success within the window)
 *   • freshness unknown .......... −20   (can't prove state)
 *   • authentication invalid ..... −40
 *   • critical connector issue ... −60   (e.g. delegation error)
 *   • newer failure than success . −25
 *   • configuration gap .......... −20
 *   • each running failure ....... −10   (capped at −20)
 * Not configured ⇒ score 0. Score is clamped to 0–100. Status is the worst
 * evidence: critical/offline → critical, otherwise stale/never_run/gaps → warning,
 * else syncing/backfilling if in progress, else healthy.
 */
export function deriveHealth(input: DeriveHealthInput): DerivedHealth {
  if (!input.configured) {
    return { status: "disconnected", score: 0, reasons: ["Connector not configured"] };
  }

  const reasons: string[] = [];
  let score = 100;
  let status: RuntimeHealth = "healthy";
  const worsenTo = (next: RuntimeHealth) => {
    if (next === "critical") status = "critical";
    else if (status === "healthy") status = next;
  };

  if (input.criticalIssue) {
    reasons.push(input.criticalIssue);
    score -= 60;
    worsenTo("critical");
  }
  if (!input.authOk) {
    reasons.push("Authentication invalid");
    score -= 40;
    worsenTo("critical");
  }

  const f = input.freshness;
  switch (f.status) {
    case "offline":
      reasons.push("Sync offline");
      score -= 60;
      worsenTo("critical");
      break;
    case "never_run":
      reasons.push("Configured but never synced");
      score -= 45;
      worsenTo("warning");
      break;
    case "stale":
      reasons.push(
        `Sync stale — last success ${fmtAge(f.age_seconds)} (expected every ${fmtInterval(
          f.expected_interval,
        )})`,
      );
      score -= 30;
      worsenTo("warning");
      break;
    case "unknown":
      reasons.push("Sync state unknown");
      score -= 20;
      worsenTo("warning");
      break;
    case "healthy":
      break;
  }

  if (input.hasNewerFailure) {
    reasons.push("Last run failed after the last success");
    score -= 25;
    worsenTo("warning");
  }
  if (input.configIssue) {
    reasons.push(input.configIssue);
    score -= 20;
    worsenTo("warning");
  }
  const rf = input.runningFailures ?? 0;
  if (rf > 0) {
    reasons.push(`${rf} running failure(s)`);
    score -= Math.min(20, rf * 10);
    worsenTo("warning");
  }
  if (input.extraReasons) reasons.push(...input.extraReasons);

  if (status === "healthy") {
    if (input.backfilling) status = "backfilling";
    else if (input.syncing) status = "syncing";
  }

  // A healthy connector leads with its proof-of-life.
  if (status === "healthy" || status === "syncing" || status === "backfilling") {
    reasons.unshift(`Last successful sync ${fmtAge(f.age_seconds)}`);
  }

  return { status, score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
