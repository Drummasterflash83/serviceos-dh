import type { AccountsPair } from "./new-dawn-founder-accounts-preview";

export const DRUMMONDS_FY27_START = "2026-04-01";

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
