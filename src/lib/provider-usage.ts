import type { ReceptionistCall } from "./receptionist-data.ts";

export type UsagePeriod = "day" | "week" | "month";
export function usageRows(calls: ReceptionistCall[], period: UsagePeriod) {
  const rows = new Map<
    string,
    { date: string; calls: number; seconds: number; cost: number; priced: number; timed: number }
  >();
  const seen = new Set<string>();
  let undated = 0;
  for (const call of calls) {
    if (!call.id || seen.has(call.id)) continue;
    seen.add(call.id);
    const date = new Date(call.startedAt ?? call.createdAt);
    if (!Number.isFinite(date.getTime())) {
      undated++;
      continue;
    }
    if (period === "week") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    if (period === "month") date.setUTCDate(1);
    const key = date.toISOString().slice(0, 10);
    const row = rows.get(key) ?? { date: key, calls: 0, seconds: 0, cost: 0, priced: 0, timed: 0 };
    row.calls++;
    if (typeof call.cost === "number" && Number.isFinite(call.cost) && call.cost >= 0) {
      row.cost += call.cost;
      row.priced++;
    }
    if (typeof call.duration === "number" && Number.isFinite(call.duration) && call.duration >= 0) {
      row.seconds += call.duration;
      row.timed++;
    }
    rows.set(key, row);
  }
  return { rows: [...rows.values()].sort((a, b) => b.date.localeCompare(a.date)), undated };
}
