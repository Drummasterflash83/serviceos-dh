/** One operator-requested Commusoft source page. IDs are not staff identities. */
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) &&
  Number(value) <= Number.MAX_SAFE_INTEGER;
const unavailable = () => Error("Saved source user page could not be verified.");

export type UsersPageScope = { tenantId: string; actorId: string; connectionId: string };
export type SavedUsersPageRequest = UsersPageScope & {
  version: 1; backend: string; requestId: string; reason: string;
};
export type UsersPageSaved = {
  requestId: string;
  state: "prepared" | "claimed" | "complete" | "failed";
  checkedAt: string | null;
  recordCount: number | null;
  hasMore: boolean | null;
  auditId: string;
  sourceUsers: { sourceId: string; observedAt: string }[];
};
export type UsersPageResponse =
  | { state: "waiting"; retryAt: number }
  | { state: "saved"; page: UsersPageSaved };
export type UsersPageOutbox = { version: 1; savedAt: number; request: SavedUsersPageRequest };
type RequestStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface UsersPageClient {
  functions: { invoke: (name: string, options: { body: Record<string, unknown> }) =>
    PromiseLike<{ data: unknown; error: unknown }> };
  rpc: (name: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: unknown }>;
}
export function usersPageKey(scope: { backend: string; tenantId: string; actorId: string; connectionId: string }) {
  if (!/^https:\/\/[^/?#]+$/.test(scope.backend) || !uuid(scope.tenantId) ||
    !uuid(scope.actorId) || !uuid(scope.connectionId))
    throw Error("Operator context could not be verified.");
  return `serviceos:operator-users-page:1:${encodeURIComponent(scope.backend)}:${scope.actorId}:${scope.tenantId}:${scope.connectionId}`;
}
export function validateSavedUsersPageRequest(value: unknown, scope: {
  backend: string; tenantId: string; actorId: string;
}): SavedUsersPageRequest {
  if (!object(value) || Object.keys(value).sort().join(",") !==
    "actorId,backend,connectionId,reason,requestId,tenantId,version" ||
    value.version !== 1 || value.backend !== scope.backend || value.tenantId !== scope.tenantId ||
    value.actorId !== scope.actorId || !uuid(value.connectionId) || !uuid(value.requestId) ||
    typeof value.reason !== "string" || value.reason !== value.reason.trim() ||
    value.reason.length < 3 || value.reason.length > 500) throw unavailable();
  return value as SavedUsersPageRequest;
}
export function readUsersPageOutbox(store: RequestStore, scope: {
  backend: string; tenantId: string; actorId: string; connectionId: string;
}): UsersPageOutbox | null {
  const raw = store.getItem(usersPageKey(scope));
  if (raw === null) return null;
  if (raw.length > 2000) throw unavailable();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw unavailable(); }
  if (!object(value) || Object.keys(value).sort().join(",") !== "request,savedAt,version" ||
    value.version !== 1 || !Number.isSafeInteger(value.savedAt) ||
    Number(value.savedAt) < 0 || Number(value.savedAt) > Date.now() + 60000)
    throw unavailable();
  const request = validateSavedUsersPageRequest(value.request, scope);
  if (request.connectionId !== scope.connectionId) throw unavailable();
  return { version: 1, savedAt: value.savedAt as number, request };
}
export function saveUsersPageOutbox(store: RequestStore, entry: UsersPageOutbox) {
  const request = validateSavedUsersPageRequest(entry.request, entry.request);
  if (entry.version !== 1 || !Number.isSafeInteger(entry.savedAt) ||
    entry.savedAt < 0 || entry.savedAt > Date.now() + 60000) throw unavailable();
  const key = usersPageKey(request), prior = readUsersPageOutbox(store, request);
  if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) throw unavailable();
  const encoded = JSON.stringify(entry);
  store.setItem(key, encoded);
  if (store.getItem(key) !== encoded) throw unavailable();
}
export function clearUsersPageOutbox(store: RequestStore, scope: {
  backend: string; tenantId: string; actorId: string; connectionId: string;
}) {
  store.removeItem(usersPageKey(scope));
}
export function parseUsersPageSaved(value: unknown, scope: UsersPageScope & { requestId: string }): UsersPageSaved {
  if (!uuid(scope.tenantId) || !uuid(scope.actorId) || !uuid(scope.connectionId) ||
    !uuid(scope.requestId) || !object(value) ||
    value.version !== "commusoft-isolated-users-page-saved/1" ||
    value.scope !== "source_identity_only" || value.tenant_id !== scope.tenantId ||
    value.connection_id !== scope.connectionId || value.request_id !== scope.requestId ||
    !uuid(value.audit_id) || !["prepared", "claimed", "complete", "failed"].includes(String(value.state)) ||
    !Array.isArray(value.source_users) || value.source_users.length > 10) throw unavailable();
  const complete = value.state === "complete";
  if (complete ? !date(value.checked_at) || !Number.isSafeInteger(value.record_count) ||
    Number(value.record_count) < 0 || Number(value.record_count) > 10 ||
    typeof value.has_more !== "boolean" || value.source_users.length !== value.record_count
    : value.checked_at !== null || value.record_count !== null || value.has_more !== null ||
    value.source_users.length !== 0) throw unavailable();
  const seen = new Set<string>();
  const sourceUsers = value.source_users.map((row: unknown) => {
    if (!object(row) || Object.keys(row).sort().join(",") !== "observed_at,source_user_id" ||
      !sourceId(row.source_user_id) || seen.has(row.source_user_id) || !date(row.observed_at))
      throw unavailable();
    seen.add(row.source_user_id);
    return { sourceId: row.source_user_id, observedAt: row.observed_at };
  });
  return { requestId: scope.requestId, state: value.state as UsersPageSaved["state"],
    checkedAt: complete ? value.checked_at as string : null,
    recordCount: complete ? value.record_count as number : null,
    hasMore: complete ? value.has_more as boolean : null,
    sourceUsers, auditId: value.audit_id };
}
export async function readUsersPageSaved(client: Pick<UsersPageClient, "rpc">,
  scope: UsersPageScope & { requestId: string }): Promise<UsersPageSaved> {
  if (!uuid(scope.tenantId) || !uuid(scope.actorId) || !uuid(scope.connectionId) ||
    !uuid(scope.requestId)) throw unavailable();
  const { data, error } = await client.rpc("new_dawn_commusoft_users_page_saved", {
    p_tenant: scope.tenantId, p_connection: scope.connectionId, p_request: scope.requestId,
  });
  if (error) throw unavailable();
  return parseUsersPageSaved(data, scope);
}
export async function requestUsersPage(client: UsersPageClient, request: SavedUsersPageRequest): Promise<UsersPageResponse> {
  validateSavedUsersPageRequest(request, request);
  const { data, error } = await client.functions.invoke("learn-commusoft-users-page", {
    body: { tenantId: request.tenantId, connectionId: request.connectionId,
      requestId: request.requestId, after: null, reason: request.reason },
  });
  if (error) throw Error("Source page outcome unconfirmed. Check the saved request before another read.");
  if (object(data) && data.state === "waiting" && data.request_id === request.requestId &&
    Number.isSafeInteger(data.retry_at) && Number(data.retry_at) > Date.now() &&
    Number(data.retry_at) <= Date.now() + 90000)
    return { state: "waiting", retryAt: data.retry_at as number };
  if (!object(data) || data.version !== "commusoft-isolated-users-page/1" ||
    data.scope !== "source_identity_only" || data.request_id !== request.requestId ||
    data.tenant_id !== request.tenantId || data.connection_id !== request.connectionId ||
    !Number.isSafeInteger(data.record_count) || Number(data.record_count) < 0 ||
    Number(data.record_count) > 10 || typeof data.has_more !== "boolean") throw unavailable();
  const page = await readUsersPageSaved(client, {
    tenantId: request.tenantId, connectionId: request.connectionId,
    actorId: request.actorId, requestId: request.requestId,
  });
  if (page.state !== "complete" || page.recordCount !== data.record_count ||
    page.hasMore !== data.has_more) throw unavailable();
  return { state: "saved", page };
}
