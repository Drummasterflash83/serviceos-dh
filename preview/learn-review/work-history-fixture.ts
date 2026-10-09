// Synthetic only: no database, providers, staff records or performance writes.
export function workHistoryFixture(args: any) {
  const mode = new URLSearchParams(location.search).get("history") ?? "partial";
  if (mode === "error") return { data: null, error: { message: "Synthetic unavailable history" } };
  const start = Date.parse(args.p_start),
    end = Date.parse(args.p_end);
  const at = (fraction: number) => new Date(start + (end - start) * fraction).toISOString();
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const a = { kind: "member", ref: id(6) },
    b = { kind: "member", ref: id(7) };
  const first = {
    status: "ready",
    version: 1,
    responsible_ref: a,
    accountable_ref: a,
    waiting_on_ref: null,
    attributes: {},
  };
  const second = { ...first, status: "in_progress", version: 2, responsible_ref: b };
  const third = {
    ...second,
    status: "waiting",
    version: 3,
    waiting_on_ref: { kind: "note", ref: "Synthetic parts confirmation" },
  };
  const coverageStart = mode === "empty" ? null : at(mode === "complete" ? 0 : 0.2);
  const events =
    coverageStart === null
      ? []
      : [
          {
            id: id(90),
            sequence: "90",
            kind: "baseline",
            occurredAt: coverageStart,
            before: first,
            after: first,
          },
          {
            id: id(91),
            sequence: "91",
            kind: "update",
            occurredAt: at(0.4),
            before: first,
            after: second,
          },
          {
            id: id(92),
            sequence: "92",
            kind: "update",
            occurredAt: at(0.7),
            before: second,
            after: third,
          },
        ].map((e) => ({ ...e, tenantId: args.p_tenant, objectId: args.p_object }));
  return {
    data: {
      contract: "work-capture@1",
      tenantId: args.p_tenant,
      objectId: args.p_object,
      period: { start: args.p_start, end: args.p_end },
      coverageStart,
      sourceThrough: coverageStart ? new Date().toISOString() : null,
      observedAt: new Date().toISOString(),
      count: events.length,
      events,
    },
    error: null,
  };
}
