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
