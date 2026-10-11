import type { ScorePeriod, TimeWindow } from "./learn-scorecards.ts";
export type CalendarWindow = { startMinute: number; endMinute: number };
export type WorkCalendarDefinition = {
  name: string;
  timezone: string;
  weekly: (CalendarWindow & { day: number })[];
  exceptions: { date: string; windows: CalendarWindow[] }[];
};
export type WorkCalendarVersion = {
  id: string;
  tenantId: string;
  revision: number;
  definition: WorkCalendarDefinition;
  recordedAt: string;
  recordedBy: string;
  reason: string;
};
export type WorkCalendarRead = {
  contract: "work-calendar-read@1";
  tenantId: string;
  draft: WorkCalendarVersion | null;
  publication: {
    id: string;
    effectiveFrom: string;
    recordedBy: string;
    reason: string;
    version: WorkCalendarVersion;
  } | null;
};
export type WorkCalendarPreview = {
  contract: "work-calendar-preview@1";
  tenantId: string;
  version: WorkCalendarVersion;
  simulation: true;
  period: ScorePeriod;
  windows: TimeWindow[];
  minutes: number;
};
type Client = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const stamp = (v: unknown): v is string =>
  typeof v === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const reason = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 1000;
function keys(value: unknown, expected: string[]) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((k) => expected.includes(k))
  );
}
function windowsValid(windows: CalendarWindow[], weekly: boolean) {
  if (!Array.isArray(windows) || windows.length > (weekly ? 84 : 12)) return false;
  for (const w of windows) {
    if (!keys(w, weekly ? ["day", "startMinute", "endMinute"] : ["startMinute", "endMinute"]))
      return false;
    const d = (w as CalendarWindow & { day: number }).day;
    if (
      !keys(w, weekly ? ["day", "startMinute", "endMinute"] : ["startMinute", "endMinute"]) ||
      !Number.isInteger(w.startMinute) ||
      !Number.isInteger(w.endMinute) ||
      w.startMinute < 0 ||
      w.endMinute > 1440 ||
      w.startMinute >= w.endMinute ||
      (weekly && (!Number.isInteger(d) || d < 1 || d > 7))
    )
      return false;
  }
  return !windows.some((a, i) =>
    windows
      .slice(i + 1)
      .some(
        (b) =>
          (!weekly || (a as any).day === (b as any).day) &&
          a.startMinute < b.endMinute &&
          b.startMinute < a.endMinute,
      ),
  );
}
export function validateWorkCalendar(def: WorkCalendarDefinition): string[] {
  if (!keys(def, ["name", "timezone", "weekly", "exceptions"]))
    return ["Calendar definition is incomplete or unsupported"];
  const errors: string[] = [];
  if (typeof def.name !== "string" || !def.name.trim() || def.name.length > 200)
    errors.push("Enter a calendar name");
  let zone = false;
  if (
    typeof def.timezone === "string" &&
    (def.timezone === "UTC" || def.timezone.includes("/")) &&
    !/^(posix|right)\//.test(def.timezone)
  ) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: def.timezone }).format(0);
      zone = true;
    } catch {}
  }
  if (!zone) errors.push("Choose a named timezone, such as Europe/London");
  if (!windowsValid(def.weekly, true))
    errors.push("Weekly hours must be non-overlapping local-minute windows within each day");
  if (!Array.isArray(def.exceptions) || def.exceptions.length > 366)
    errors.push("Use at most 366 date overrides");
  else {
    const dates = new Set<string>();
    for (const e of def.exceptions) {
      const date = e?.date,
        parsed = typeof date === "string" ? new Date(date + "T00:00:00Z") : null;
      if (
        !keys(e, ["date", "windows"]) ||
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !parsed ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date ||
        date < "2000-01-01" ||
        date > "2200-12-31" ||
        dates.has(date) ||
        !windowsValid(e.windows, false)
      ) {
        errors.push("Date overrides need unique valid dates and non-overlapping windows");
        break;
      }
      dates.add(date);
    }
  }
  return errors;
}
export function normalizeWorkCalendar(def: WorkCalendarDefinition): WorkCalendarDefinition {
  const errors = validateWorkCalendar(def);
  if (errors.length) throw Error(errors[0]);
  return {
    name: def.name.trim(),
    timezone: def.timezone,
    weekly: def.weekly
      .map((w) => ({ day: w.day, startMinute: w.startMinute, endMinute: w.endMinute }))
      .sort((a, b) => a.day - b.day || a.startMinute - b.startMinute),
    exceptions: def.exceptions
      .map((e) => ({
        date: e.date,
        windows: e.windows.map((w) => ({ ...w })).sort((a, b) => a.startMinute - b.startMinute),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
export function parseWorkCalendarVersion(data: unknown, tenantId: string): WorkCalendarVersion {
  const v = data as WorkCalendarVersion;
  if (
    !uuid(tenantId) ||
    !v ||
    !uuid(v.id) ||
    v.tenantId !== tenantId ||
    !Number.isInteger(v.revision) ||
    v.revision < 1 ||
    v.revision > 2147483647 ||
    validateWorkCalendar(v.definition).length ||
    !stamp(v.recordedAt) ||
    !uuid(v.recordedBy) ||
    !reason(v.reason)
  )
    throw Error("Saved calendar could not be verified");
  return { ...v, definition: normalizeWorkCalendar(v.definition) };
}
export function parseWorkCalendarRead(data: unknown, tenantId: string): WorkCalendarRead {
  const d = data as WorkCalendarRead;
  if (
    !d ||
    d.contract !== "work-calendar-read@1" ||
    d.tenantId !== tenantId ||
    !uuid(tenantId) ||
    d.draft === undefined ||
    d.publication === undefined
  )
    throw Error("Calendar scope could not be verified");
  const draft = d.draft === null ? null : parseWorkCalendarVersion(d.draft, tenantId);
  let publication = d.publication;
  if (publication !== null) {
    const version = parseWorkCalendarVersion(publication.version, tenantId);
    if (
      !draft ||
      !uuid(publication.id) ||
      !uuid(publication.recordedBy) ||
      !reason(publication.reason) ||
      !stamp(publication.effectiveFrom) ||
      Date.parse(publication.effectiveFrom) < Date.parse(version.recordedAt) ||
      version.revision > draft.revision ||
      (version.revision === draft.revision &&
        (version.id !== draft.id || JSON.stringify(version) !== JSON.stringify(draft)))
    )
      throw Error("Published calendar could not be verified");
    publication = { ...publication, version };
  }
  return { ...d, draft, publication };
}
function validPeriod(p: ScorePeriod) {
  return (
    !!p &&
    stamp(p.start) &&
    stamp(p.end) &&
    Date.parse(p.start) >= Date.parse("2000-01-01T00:00:00Z") &&
    Date.parse(p.end) <= Date.parse("2201-01-01T00:00:00Z") &&
    Date.parse(p.end) > Date.parse(p.start) &&
    Date.parse(p.end) - Date.parse(p.start) <= 366 * 86400000
  );
}
export function parseWorkCalendarPreview(
  data: unknown,
  tenantId: string,
  versionId: string,
  period: ScorePeriod,
): WorkCalendarPreview {
  const d = data as WorkCalendarPreview;
  if (
    !validPeriod(period) ||
    !uuid(versionId) ||
    !d ||
    d.contract !== "work-calendar-preview@1" ||
    d.tenantId !== tenantId ||
    d.simulation !== true ||
    !validPeriod(d.period) ||
    Date.parse(d.period.start) !== Date.parse(period.start) ||
    Date.parse(d.period.end) !== Date.parse(period.end) ||
    !Array.isArray(d.windows) ||
    d.windows.length > 12000 ||
    !Number.isFinite(d.minutes) ||
    d.minutes < 0
  )
    throw Error("Calendar preview scope could not be verified");
  const version = parseWorkCalendarVersion(d.version, tenantId);
  if (version.id !== versionId) throw Error("Preview returned another calendar revision");
  let previous = Date.parse(period.start),
    minutes = 0;
  for (const w of d.windows) {
    if (
      !validPeriod(w) ||
      Date.parse(w.start) < previous ||
      Date.parse(w.end) > Date.parse(period.end)
    )
      throw Error("Calendar windows overlap or leave the requested period");
    previous = Date.parse(w.end);
    minutes += (Date.parse(w.end) - Date.parse(w.start)) / 60000;
  }
  if (Math.abs(minutes - d.minutes) > 0.000001)
    throw Error("Calendar preview total differs from its windows");
  return { ...d, version };
}
function failure(error: any) {
  return Error(
    error?.code === "PT409"
      ? "The calendar changed or this request was already used. Reload before continuing."
      : error?.code === "42501"
        ? "Only a current company owner or admin can manage calendars."
        : "Calendar outcome could not be confirmed. Keep the original request and check before changing it.",
  );
}
export async function readWorkCalendar(db: Client, tenantId: string) {
  if (!uuid(tenantId)) throw Error("Company required");
  const { data, error } = await db.rpc("learn_work_calendar_read", { p_tenant: tenantId });
  if (error) throw failure(error);
  return parseWorkCalendarRead(data, tenantId);
}
export async function saveWorkCalendar(
  db: Client,
  input: {
    tenantId: string;
    actorId: string;
    requestId: string;
    expectedRevision: number;
    definition: WorkCalendarDefinition;
    reason: string;
  },
) {
  const def = normalizeWorkCalendar(input.definition);
  if (
    ![input.tenantId, input.actorId, input.requestId].every(uuid) ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >= 2147483647 ||
    !reason(input.reason)
  )
    throw Error("Calendar revision, request and reason required");
  const { data, error } = await db.rpc("learn_work_calendar_save", {
    p_tenant: input.tenantId,
    p_expected_revision: input.expectedRevision,
    p_definition: def,
    p_request: input.requestId,
    p_reason: input.reason.trim(),
  });
  if (error) throw failure(error);
  const version = parseWorkCalendarVersion(data?.version, input.tenantId);
  if (
    data.contract !== "work-calendar@1" ||
    version.id !== input.requestId ||
    version.recordedBy !== input.actorId ||
    version.revision !== input.expectedRevision + 1 ||
    version.reason !== input.reason.trim() ||
    JSON.stringify(version.definition) !== JSON.stringify(def)
  )
    throw Error("Calendar save response differs from this request");
  return version;
}
export async function publishWorkCalendar(
  db: Client,
  input: {
    tenantId: string;
    actorId: string;
    versionId: string;
    expectedPublication: string | null;
    requestId: string;
    reason: string;
  },
) {
  if (
    ![input.tenantId, input.actorId, input.versionId, input.requestId].every(uuid) ||
    !(input.expectedPublication === null || uuid(input.expectedPublication)) ||
    !reason(input.reason)
  )
    throw Error("Calendar publication request and reason required");
  const { data: d, error } = await db.rpc("learn_work_calendar_publish", {
    p_tenant: input.tenantId,
    p_version: input.versionId,
    p_expected_publication: input.expectedPublication,
    p_request: input.requestId,
    p_reason: input.reason.trim(),
  });
  if (error) throw failure(error);
  if (
    !d ||
    d.contract !== "work-calendar-publication@1" ||
    d.id !== input.requestId ||
    d.tenantId !== input.tenantId ||
    d.versionId !== input.versionId ||
    d.recordedBy !== input.actorId ||
    d.reason !== input.reason.trim() ||
    !stamp(d.effectiveFrom)
  )
    throw Error("Calendar publication response differs from this request");
  return d as {
    contract: "work-calendar-publication@1";
    id: string;
    tenantId: string;
    versionId: string;
    effectiveFrom: string;
    recordedBy: string;
    reason: string;
  };
}
export async function previewWorkCalendar(
  db: Client,
  tenantId: string,
  versionId: string,
  period: ScorePeriod,
) {
  if (!uuid(tenantId) || !uuid(versionId) || !validPeriod(period))
    throw Error("Saved calendar and valid period required");
  const { data, error } = await db.rpc("learn_work_calendar_preview", {
    p_tenant: tenantId,
    p_version: versionId,
    p_start: period.start,
    p_end: period.end,
  });
  if (error) throw failure(error);
  return parseWorkCalendarPreview(data, tenantId, versionId, period);
}
