import { record } from "./receptionist-data.ts";
// Resolve local midnight including British Summer Time without host timezone assumptions.
export function londonPeriodStart(now: Date, month = false) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const midnight = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    month ? 1 : Number(parts.day),
  );
  const offset = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(midnight))
    .find((p) => p.type === "timeZoneName")?.value;
  const hours = offset === "GMT+01:00" ? 1 : (offset === "GMT" || offset === "GMT+00:00") ? 0 : null;
  if (hours === null) throw Error("London date boundary unavailable");
  return new Date(midnight - hours * 3600000).toISOString();
}
export function costQueries(now: Date) {
  return {
    queries: ["today", "month"].map((name) => ({
      table: "call",
      name,
      groupBy: ["assistantId"],
      timeRange: {
        start: londonPeriodStart(now, name === "month"),
        end: now.toISOString(),
        timezone: "Europe/London",
      },
      operations: [
        { operation: "sum", column: "cost", alias: "usd" },
        { operation: "count", column: "id", alias: "calls" },
        { operation: "count", column: "cost", alias: "costedCalls" },
        { operation: "sum", column: "minutesUsed", alias: "minutes" },
      ],
    })),
  };
}
export function scopedCostSummary(raw: unknown, assistantId: string, now: Date) {
  if (!Array.isArray(raw)) throw Error("Cost data unavailable");
  const numeric = (v: unknown) => typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v) ? Number(v) : v;
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const periods = Object.fromEntries(
    ["today", "month"].map((name) => {
      const queries = raw.filter((q) => record(q).name === name);
      if (queries.length !== 1 || !Array.isArray(queries[0].result))
        throw Error("Cost period unavailable");
      const rows = queries[0].result.filter((r: unknown) => record(r).assistantId === assistantId);
      if (rows.length > 1) throw Error("Ambiguous cost period");
      if (!rows.length) return [name, { usd: 0, calls: 0, costedCalls: 0, minutes: 0, pending: 0 }];
      const row = record(rows[0]);
      const r = Object.fromEntries(["usd", "calls", "costedCalls", "minutes"].map(k => [k, numeric(row[k])]));
      if (
        !Number.isSafeInteger(r.calls) ||
        Number(r.calls) < 0 ||
        !Number.isSafeInteger(r.costedCalls) ||
        Number(r.costedCalls) < 0 ||
        Number(r.costedCalls) > Number(r.calls)
      )
        throw Error("Invalid cost counts");
      const usd = n(r.usd) ? r.usd : r.usd === null && r.costedCalls === 0 ? 0 : null;
      if (usd === null) throw Error("Cost total unavailable");
      return [
        name,
        {
          usd,
          calls: r.calls,
          costedCalls: r.costedCalls,
          minutes: n(r.minutes) ? r.minutes : null,
          pending: Number(r.calls) - Number(r.costedCalls),
        },
      ];
    }),
  );
  return {
    currency: "USD",
    checkedAt: now.toISOString(),
    timeZone: "Europe/London",
    periods,
    scope: "published_assistant",
    provisional: true,
  };
}
