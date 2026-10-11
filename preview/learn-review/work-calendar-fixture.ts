import {
  normalizeWorkCalendar,
  type WorkCalendarDefinition,
  type WorkCalendarVersion,
} from "../../src/lib/learn-work-calendars";
const tenantId = "11111111-1111-4111-8111-111111111111",
  actorId = "22222222-2222-4222-8222-222222222222";
type Entry = { kind: string; payload: any; state: "recorded" | "cancelled"; recordedAt: string };
type Fixture = {
  versions: WorkCalendarVersion[];
  publications: any[];
  requests: Record<string, Entry>;
  faulted: boolean;
};
export function workCalendarFixture(name: string, args: any): any {
  if (!name.startsWith("learn_work_calendar_")) return null;
  const scenario = new URLSearchParams(location.search).get("calendar") ?? "normal";
  if (scenario === "viewer" || args.p_tenant !== tenantId)
    return { data: null, error: { code: "42501" } };
  const key = `serviceos:synthetic:calendar:${scenario}`;
  const state: Fixture = JSON.parse(
    sessionStorage.getItem(key) ??
      '{"versions":[],"publications":[],"requests":{},"faulted":false}',
  );
  const persist = () => sessionStorage.setItem(key, JSON.stringify(state));
  const ok = (data: any) => ({ data, error: null });
  const conflict = () => ({ data: null, error: { code: "PT409" } });
  const latest = state.versions.at(-1),
    publication = state.publications.at(-1);
  if (name === "learn_work_calendar_read")
    return ok({
      contract: "work-calendar-read@1",
      tenantId,
      draft: latest ?? null,
      publication: publication
        ? {
            id: publication.id,
            effectiveFrom: publication.effectiveFrom,
            recordedBy: actorId,
            reason: publication.reason,
            version: state.versions.find((v) => v.id === publication.versionId),
          }
        : null,
    });
  if (name === "learn_work_calendar_preview") {
    const version = state.versions.find((v) => v.id === args.p_version);
    if (!version) return conflict();
    return ok({
      contract: "work-calendar-preview@1",
      tenantId,
      version,
      simulation: true,
      period: { start: args.p_start, end: args.p_end },
      ...expand(version.definition, args.p_start, args.p_end),
    });
  }
  const request = state.requests[args.p_request];
  if (name === "learn_work_calendar_resolve") {
    if (scenario === "lost-status" && !state.faulted) {
      state.faulted = true;
      persist();
      return { data: null, error: { code: "synthetic_lost_reply" } };
    }
    if (
      request &&
      (request.kind !== args.p_kind ||
        JSON.stringify(request.payload) !== JSON.stringify(args.p_payload))
    )
      return conflict();
    if (!request && args.p_cancel) {
      state.requests[args.p_request] = {
        kind: args.p_kind,
        payload: args.p_payload,
        state: "cancelled",
        recordedAt: new Date().toISOString(),
      };
      persist();
    }
    const found = state.requests[args.p_request];
    return ok({
      contract: "work-calendar-resolution@1",
      tenantId,
      actorId,
      requestId: args.p_request,
      kind: args.p_kind,
      payload: args.p_payload,
      state: found?.state ?? "pending",
      recordedAt: found?.recordedAt ?? null,
    });
  }
  const kind = name === "learn_work_calendar_save" ? "save" : "publish";
  const payload =
    kind === "save"
      ? {
          expectedRevision: args.p_expected_revision,
          definition: normalizeWorkCalendar(args.p_definition),
          reason: args.p_reason,
        }
      : {
          versionId: args.p_version,
          expectedPublication: args.p_expected_publication,
          reason: args.p_reason,
        };
  if (
    request &&
    (request.state === "cancelled" ||
      request.kind !== kind ||
      JSON.stringify(request.payload) !== JSON.stringify(payload))
  )
    return conflict();
  if (!request) {
    if (scenario === "lost-before-save" && !state.faulted) {
      state.faulted = true;
      persist();
      return { data: null, error: { code: "synthetic_lost_reply" } };
    }
    if (kind === "save") {
      if ((latest?.revision ?? 0) !== args.p_expected_revision) return conflict();
      state.versions.push({
        id: args.p_request,
        tenantId,
        revision: args.p_expected_revision + 1,
        definition: payload.definition!,
        reason: args.p_reason,
        recordedBy: actorId,
        recordedAt: new Date().toISOString(),
      });
    } else {
      if (
        latest?.id !== args.p_version ||
        (publication?.id ?? null) !== args.p_expected_publication ||
        publication?.versionId === args.p_version
      )
        return conflict();
      state.publications.push({
        contract: "work-calendar-publication@1",
        id: args.p_request,
        tenantId,
        versionId: args.p_version,
        recordedBy: actorId,
        reason: args.p_reason,
        effectiveFrom: new Date().toISOString(),
      });
    }
    state.requests[args.p_request] = {
      kind,
      payload,
      state: "recorded",
      recordedAt: new Date().toISOString(),
    };
    persist();
    if (scenario === `lost-${kind}` && !state.faulted) {
      state.faulted = true;
      persist();
      return { data: null, error: { code: "synthetic_lost_reply" } };
    }
  }
  return ok(
    kind === "save"
      ? {
          contract: "work-calendar@1",
          version: state.versions.find((v) => v.id === args.p_request),
        }
      : state.publications.find((p) => p.id === args.p_request),
  );
}
// Synthetic preview only. Actual timezone/DST semantics are verified separately
// against PostgreSQL by scripts/verify/learn-work-calendars.py.
function expand(def: WorkCalendarDefinition, start: string, end: string) {
  const a = Date.parse(start),
    b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 366 * 86400000)
    throw Error("Invalid synthetic period");
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: def.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const windows: { start: string; end: string }[] = [];
  for (let t = Math.floor(a / 60000) * 60000; t < b; t += 60000) {
    const p = Object.fromEntries(formatter.formatToParts(t).map((part) => [part.type, part.value]));
    const date = `${p.year}-${p.month}-${p.day}`,
      day = new Date(date + "T00:00:00Z").getUTCDay() || 7,
      minute = +p.hour * 60 + +p.minute;
    const selected =
      def.exceptions.find((e) => e.date === date)?.windows ??
      def.weekly.filter((w) => w.day === day);
    if (!selected.some((w) => w.startMinute <= minute && w.endMinute > minute)) continue;
    const start = new Date(Math.max(a, t)).toISOString(),
      end = new Date(Math.min(b, t + 60000)).toISOString();
    if (windows.at(-1)?.end === start) windows.at(-1)!.end = end;
    else windows.push({ start, end });
  }
  return {
    windows,
    minutes: windows.reduce((sum, w) => sum + (Date.parse(w.end) - Date.parse(w.start)) / 60000, 0),
  };
}
