/**
 * Small formatting helpers shared by connector `diagnostics()` builders, so the
 * Health panels read consistently (relative times, yes/no, latest error from the
 * recent sync runs). No vendor knowledge here — just presentation.
 */

import type { SyncRunRow } from "@/lib/ops-metrics";
import { runsForConnector } from "./ConnectorLogs";

/** Relative time ("3m ago", "never") for a nullable ISO timestamp. */
export function ago(iso: string | null): string {
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

export function yesNo(v: boolean): string {
  return v ? "yes" : "no";
}

/** The most recent failed-run error message for a connector, or null. */
export function latestError(connectorId: string, runs: SyncRunRow[]): string | null {
  const failed = runsForConnector(connectorId, runs)
    .filter((r) => r.status === "failed" && r.error_message)
    .sort((a, b) => ((a.started_at ?? "") < (b.started_at ?? "") ? 1 : -1));
  return failed[0]?.error_message ?? null;
}
