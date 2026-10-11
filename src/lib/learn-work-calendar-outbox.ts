import {
  normalizeWorkCalendar,
  publishWorkCalendar,
  saveWorkCalendar,
  type WorkCalendarClient,
  type WorkCalendarDefinition,
} from "./learn-work-calendars.ts";

export type CalendarScope = { backend: string; actorId: string; tenantId: string };
export type CalendarRequest =
  | {
      kind: "save";
      requestId: string;
      payload: { expectedRevision: number; definition: WorkCalendarDefinition; reason: string };
    }
  | {
      kind: "publish";
      requestId: string;
      payload: { versionId: string; expectedPublication: string | null; reason: string };
    };
export type CalendarDraft = CalendarScope & CalendarRequest & { version: 1 };
export type CalendarResolution = {
  contract: "work-calendar-resolution@1";
  tenantId: string;
  actorId: string;
  requestId: string;
  kind: "save" | "publish";
  payload: CalendarRequest["payload"];
  state: "pending" | "recorded" | "cancelled";
  recordedAt: string | null;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CalendarRecoveryLock = <T>(name: string, action: () => Promise<T>) => Promise<T>;
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
function exact(value: unknown, names: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== names.length ||
    Object.keys(value).some((k) => !names.includes(k))
  )
    throw Error("Calendar request is incomplete or unsupported.");
}
export function calendarOutboxKey(scope: CalendarScope) {
  if (
    typeof scope.backend !== "string" ||
    !scope.backend.trim() ||
    scope.backend.length > 1000 ||
    !uuid(scope.actorId) ||
    !uuid(scope.tenantId)
  )
    throw Error("Calendar recovery needs the signed-in company and backend.");
  // Shared across save and publication: one unresolved company change at a time.
  return `learn-calendar-outbox:v1:${encodeURIComponent(scope.backend)}:${scope.actorId}:${scope.tenantId}`;
}
function checked(scope: CalendarScope, value: CalendarDraft): CalendarDraft {
  calendarOutboxKey(scope);
  exact(value, ["version", "backend", "actorId", "tenantId", "kind", "requestId", "payload"]);
  if (
    value.version !== 1 ||
    value.backend !== scope.backend ||
    value.actorId !== scope.actorId ||
    value.tenantId !== scope.tenantId ||
    !uuid(value.requestId)
  )
    throw Error("Saved calendar request belongs to another session or company.");
  const p = value.payload;
  if (!p || typeof p.reason !== "string" || !p.reason.trim() || p.reason.length > 1000)
    throw Error("A reason is required for this calendar change.");
  if (value.kind === "save") {
    exact(p, ["expectedRevision", "definition", "reason"]);
    const save = value.payload;
    if (
      !Number.isInteger(save.expectedRevision) ||
      save.expectedRevision < 0 ||
      save.expectedRevision >= 2147483647
    )
      throw Error("Expected calendar revision is invalid.");
    return {
      version: 1,
      ...scope,
      kind: "save",
      requestId: value.requestId,
      payload: {
        expectedRevision: save.expectedRevision,
        definition: normalizeWorkCalendar(save.definition),
        reason: save.reason.trim(),
      },
    };
  }
  if (value.kind !== "publish") throw Error("Unsupported calendar request.");
  exact(p, ["versionId", "expectedPublication", "reason"]);
  const publication = value.payload;
  if (
    !uuid(publication.versionId) ||
    !(publication.expectedPublication === null || uuid(publication.expectedPublication))
  )
    throw Error("Saved calendar version and expected publication are required.");
  return {
    version: 1,
    ...scope,
    kind: "publish",
    requestId: value.requestId,
    payload: {
      versionId: publication.versionId,
      expectedPublication: publication.expectedPublication,
      reason: publication.reason.trim(),
    },
  };
}
export function prepareCalendarDraft(
  scope: CalendarScope,
  request: CalendarRequest,
): CalendarDraft {
  exact(request, ["kind", "requestId", "payload"]);
  return checked(scope, { version: 1, ...scope, ...request });
}
export function readCalendarDraft(
  storage: StoragePort,
  scope: CalendarScope,
): CalendarDraft | null {
  const raw = storage.getItem(calendarOutboxKey(scope));
  if (raw === null) return null;
  try {
    if (raw.length > 350000) throw Error("Oversize request");
    return checked(scope, JSON.parse(raw));
  } catch {
    throw Error(
      "The saved calendar request needs attention. Keep this browser data and ask support before making another calendar change.",
    );
  }
}
export function parseCalendarResolution(
  data: unknown,
  scope: CalendarScope,
  draft: CalendarDraft,
  cancel: boolean,
): CalendarResolution {
  const d = data as CalendarResolution;
  const original = checked(scope, draft);
  if (
    !d ||
    d.contract !== "work-calendar-resolution@1" ||
    d.tenantId !== scope.tenantId ||
    d.actorId !== scope.actorId ||
    d.requestId !== original.requestId ||
    d.kind !== original.kind ||
    !["pending", "recorded", "cancelled"].includes(d.state) ||
    (d.state === "pending"
      ? d.recordedAt !== null
      : typeof d.recordedAt !== "string" ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(d.recordedAt) ||
        !Number.isFinite(Date.parse(d.recordedAt))) ||
    (cancel && d.state === "pending")
  )
    throw Error("Calendar outcome could not be verified. The saved request has been kept.");
  const echoed = checked(scope, { ...original, payload: d.payload } as CalendarDraft);
  if (JSON.stringify(echoed) !== JSON.stringify(original))
    throw Error("Calendar outcome differs from the saved request. Keep it for recovery.");
  return { ...d, payload: echoed.payload };
}
async function resolve(
  db: WorkCalendarClient,
  scope: CalendarScope,
  draft: CalendarDraft,
  cancel: boolean,
) {
  const { data, error } = await db.rpc("learn_work_calendar_resolve", {
    p_tenant: scope.tenantId,
    p_kind: draft.kind,
    p_request: draft.requestId,
    p_payload: draft.payload,
    p_cancel: cancel,
  });
  if (error)
    throw Error(
      error.code === "42501"
        ? "Only a current company owner or admin outside preview can recover calendar changes."
        : "Calendar status could not be confirmed. Keep the saved request and check again.",
    );
  return parseCalendarResolution(data, scope, draft, cancel);
}
/** Persist before any RPC, serialize tabs, and retain uncertain outcomes. A
 * terminal server receipt is required before clearing the exact browser request. */
export async function recoverCalendarDraft(
  db: WorkCalendarClient,
  storage: StoragePort,
  lock: CalendarRecoveryLock,
  scope: CalendarScope,
  draft: CalendarDraft,
  action: "submit" | "check" | "cancel",
  allowed: () => boolean,
) {
  const value = checked(scope, draft),
    key = calendarOutboxKey(scope),
    encoded = JSON.stringify(value);
  return lock(key, async () => {
    const access = () => {
      if (!allowed())
        throw Error(
          "Calendar settings closed or your access changed. Reopen them to recover this request.",
        );
    };
    const retained = () => {
      access();
      if (storage.getItem(key) !== encoded)
        throw Error("Saved browser details changed. Reload calendar settings before continuing.");
    };
    access();
    const old = readCalendarDraft(storage, scope);
    if (old && JSON.stringify(old) !== encoded)
      throw Error(
        "Another calendar change awaits confirmation. Recover it before making a new change.",
      );
    storage.setItem(key, encoded);
    retained();
    let result = await resolve(db, scope, value, action === "cancel");
    retained();
    if (result.state === "pending" && action === "submit") {
      if (value.kind === "save")
        await saveWorkCalendar(db, { ...scope, requestId: value.requestId, ...value.payload });
      else
        await publishWorkCalendar(db, { ...scope, requestId: value.requestId, ...value.payload });
      retained();
      result = await resolve(db, scope, value, false);
      retained();
      if (result.state !== "recorded")
        throw Error("Calendar change remains unconfirmed. Check the saved request again.");
    }
    if (result.state !== "pending") {
      storage.removeItem(key);
      if (storage.getItem(key) !== null)
        throw Error(
          "The outcome is confirmed, but browser recovery details remain. Check the same request again.",
        );
    }
    return result;
  });
}
