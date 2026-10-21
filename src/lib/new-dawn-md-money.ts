import type { AccountsPair } from "./new-dawn-founder-accounts-preview";
import { financeAmount } from "./learn-quickbooks-finance.ts";

export const DRUMMONDS_FY27_START = "2026-04-01";

/** Client-facing UK dates and exact sterling strings; no floating-point conversion. */
export const mdUkDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;

export function mdMoneyAmount(value: string | null, code: string | null): string {
  const exact = financeAmount(value, code);
  if (code !== "GBP" || !exact.startsWith("GBP ")) return exact;
  const amount = exact.slice(4);
  return amount.startsWith("-") ? `-£${amount.slice(1)}` : `£${amount}`;
}

/** The latest completed UK calendar day within Drummonds' evidenced FY27. */
export function fy27LastCompletedUkDate(now: Date): string | null {
  if (!Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  const year = Number(part("year")), month = Number(part("month")), day = Number(part("day"));
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  return yesterday >= DRUMMONDS_FY27_START && yesterday <= "2027-03-31" ? yesterday : null;
}

export type MoneyReportFreshness = {
  state: "current" | "older" | "partial" | "unverified";
  message: string;
};

/** Date coverage is a source fact; it never claims that the scheduled reader ran. */
export function moneyReportFreshness(
  periodEnd: string, receivablesAsOf: string, now: Date,
): MoneyReportFreshness {
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const lastComplete = fy27LastCompletedUkDate(now);
  if (!validDay(periodEnd) || !validDay(receivablesAsOf) ||
    periodEnd !== receivablesAsOf || !lastComplete)
    return { state: "unverified", message: "Report date coverage needs review before these figures are treated as current." };
  if (periodEnd < lastComplete)
    return { state: "older", message: `Figures end ${mdUkDay(periodEnd)}. More recent company accounts have not been verified.` };
  if (periodEnd === lastComplete)
    return { state: "current", message: `Figures cover the last completed UK day (${mdUkDay(periodEnd)}).` };
  return { state: "partial", message: `Figures include ${mdUkDay(periodEnd)}, which is not yet a completed UK day. Treat them as a partial period.` };
}

/** Prefer the latest accounting period, not the most recently re-read old report. */
export function newestAccountsPair(pairs: AccountsPair[]): AccountsPair | null {
  return [...pairs].sort((a, b) =>
    b.periodEnd.localeCompare(a.periodEnd) ||
    b.periodStart.localeCompare(a.periodStart) ||
    b.profitReceivedAt.localeCompare(a.profitReceivedAt))[0] ?? null;
}

/** FY27 start is evidenced; a current, approved target and full-period source are separate gates. */
export function netProfitYtdComparison(periodStart: string, periodEnd: string) {
  return {
    status: "held" as const,
    target: "FY27 target",
    reason: periodStart !== DRUMMONDS_FY27_START
      ? `The saved P&L covers ${periodStart} to ${periodEnd}, not the full period from 1 April 2026. The current target also needs Finance confirmation.`
      : "The report starts at the verified 1 April 2026 FY27 boundary, but the current target and its phasing still need Finance confirmation.",
  };
}

/** A negative net A/R age bucket is a credit, never overdue debt. */
export function agedReceivablesBucketKind(amount: string): "positive" | "credit" | "zero" | "unknown" {
  if (!/^-?\d{1,40}(?:\.\d{1,10})?$/.test(amount)) return "unknown";
  if (!/[1-9]/.test(amount)) return "zero";
  return amount.startsWith("-") ? "credit" : "positive";
}

/** Ratio from one verified P&L numerator and denominator, rounded to 0.01%. */
export function accountsNetMargin(netProfit: string, totalIncome: string): string | null {
  if (!/^-?\d{1,40}(?:\.\d{1,10})?$/.test(netProfit) ||
      !/^\d{1,40}(?:\.\d{1,10})?$/.test(totalIncome)) return null;
  const scale = Math.max(netProfit.split(".")[1]?.length ?? 0, totalIncome.split(".")[1]?.length ?? 0);
  const units = (value: string) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
    return negative ? -result : result;
  };
  const denominator = units(totalIncome);
  if (denominator <= 0n) return null;
  const numerator = units(netProfit) * 10000n;
  const hundredths = (numerator < 0n ? -1n : 1n) *
    ((numerator < 0n ? -numerator : numerator) + denominator / 2n) / denominator;
  const abs = hundredths < 0n ? -hundredths : hundredths;
  return `${hundredths < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
