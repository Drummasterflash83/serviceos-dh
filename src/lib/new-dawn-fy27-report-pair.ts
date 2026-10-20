import type { QuickBooksConnection } from "./learn-quickbooks";
import { buildReportCaptureBody, reportCaptureConnectionReady } from "./learn-quickbooks-report-capture.ts";

export const DRUMMONDS_FY27_PAIR = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  realmId: "1197397945",
  periodStart: "2026-04-01",
  cutoff: "2026-10-19",
  reason: "Verify Drummonds FY27 accrual accounts through 19 October 2026 for MD read-only source evidence",
} as const;

/** The single credential refresh Chris approved for this exact production company. */
export function approvedFy27RefreshBody(connection: QuickBooksConnection | undefined,
  requestId: string, now = Date.now()) {
  if (!connection || connection.environment !== "production" ||
    connection.realmId !== DRUMMONDS_FY27_PAIR.realmId || !connection.confirmedAt ||
    !["active", "paused"].includes(connection.status) || connection.refreshInProgress ||
    !connection.refreshExpiresAt || Date.parse(connection.refreshExpiresAt) <= now + 120_000)
    throw Error("fy27_refresh_unavailable");
  return { tenantId: DRUMMONDS_FY27_PAIR.tenantId, connectionId: connection.id,
    requestId, realmId: DRUMMONDS_FY27_PAIR.realmId,
    environment: "production" as const, reason: DRUMMONDS_FY27_PAIR.reason };
}

/** Fixed scope for Chris's approved, one-time FY27 source pair. */
export function approvedFy27PairBodies(connection: QuickBooksConnection | undefined,
  requestIds: { profit: string; receivables: string }, now = Date.now()) {
  if (!connection || connection.environment !== "production" ||
    connection.realmId !== DRUMMONDS_FY27_PAIR.realmId ||
    !reportCaptureConnectionReady(connection, now) ||
    requestIds.profit === requestIds.receivables) throw Error("fy27_pair_unavailable");
  const base = {
    tenantId: DRUMMONDS_FY27_PAIR.tenantId, connectionId: connection.id,
    realmId: DRUMMONDS_FY27_PAIR.realmId, environment: "production" as const,
    periodStart: DRUMMONDS_FY27_PAIR.periodStart,
    periodEnd: DRUMMONDS_FY27_PAIR.cutoff,
    accountingMethod: "Accrual" as const,
    reportDate: DRUMMONDS_FY27_PAIR.cutoff,
    reason: DRUMMONDS_FY27_PAIR.reason,
  };
  return [
    buildReportCaptureBody({ ...base, kind: "ProfitAndLoss", requestId: requestIds.profit }),
    buildReportCaptureBody({ ...base, kind: "AgedReceivables", requestId: requestIds.receivables }),
  ] as const;
}
