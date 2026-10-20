import type { AccountsPair } from "./new-dawn-founder-accounts-preview";

/** Prefer the latest accounting period, not the most recently re-read old report. */
export function newestAccountsPair(pairs: AccountsPair[]): AccountsPair | null {
  return [...pairs].sort((a, b) =>
    b.periodEnd.localeCompare(a.periodEnd) ||
    b.periodStart.localeCompare(a.periodStart) ||
    b.profitReceivedAt.localeCompare(a.profitReceivedAt))[0] ?? null;
}

/** An MTD report cannot be measured against an unspecified YTD financial year. */
export function netProfitYtdComparison(periodStart: string, _periodEnd: string) {
  return {
    status: "held" as const,
    target: "£144,000 year to date",
    reason: `The saved P&L starts ${periodStart}; the financial year start and a complete year-to-date report are not verified.`,
  };
}
