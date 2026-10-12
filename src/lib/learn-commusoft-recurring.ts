import { readOperatorInputWriteAccess, type OperatorInputClient } from "./learn-operator-inputs.ts";
import {
  inputOutboxKey,
  connectionOutboxKey,
  captureOutboxKey,
  commusoftRecurringOutboxKey,
  type InputScope,
  type InputLock,
  type RequestStore,
} from "./learn-operator-request-scope.ts";
export const commusoftRecurringStates: Record<string, string> = {
  approved: "Awaiting the next worker check",
  paused: "Paused",
  ready: "Ready for the next stage",
  approval_changed: "Operator authority needs review",
  account_unavailable: "Import account needs review",
  connection_changed: "Connection needs review",
  capture_paused: "Paused by LEARN controls",
  window_active: "Processing the current stage",
  window_changed: "Import changed — review before continuing",
  window_incomplete: "Stage incomplete — review import recovery",
  completion_unverified: "Completion needs verification",
  cycle_complete: "All four stages verified",
  caught_up: "Waiting for the next update window",
  window_queued: "Next stage queued",
  empty_parent_set_verified: "No contact parents in the verified inventory",
  setup_needs_review: "Next stage needs operator review",
};
export type CommusoftRecurringAccount = {
  account_id: string;
  tenant_id: string;
  connection_id: string;
  approved_by: string;
  enabled: boolean;
  revision: number;
  max_pages: number;
  page_size: number;
  watermark: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  phase: number;
  current_request: string | null;
  last_state: string;
  next_check_at: string;
  updated_at: string;
};
export type CommusoftRecurringRequest = {
  tenantId: string;
  actorId: string;
  requestId: string;
  definition: {
    account_id: string;
    expected_revision: number;
    enabled: boolean;
    max_pages: number;
    page_size: number;
    reason: string;
  };
};
export type SavedCommusoftRecurring = {
  version: 1;
  backend: string;
  request: CommusoftRecurringRequest;
};
export type CommusoftRecurringReceipt = {
  state: "pending" | "cancelled" | "recorded";
  request_id: string;
  account_id?: string;
  revision?: number;
  enabled?: boolean;
};
const obj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const integer = (v: unknown, min: number, max: number) =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
export { commusoftRecurringOutboxKey };
export async function readCommusoftRecurring(db: OperatorInputClient, tenantId: string) {
  if (!uuid(tenantId)) throw Error("Choose a company.");
  try {
    const { data, error } = await db.rpc("learn_commusoft_recurring_read", { p_tenant: tenantId });
    const d = data as any;
    if (
      error ||
      !obj(d) ||
      d.tenant_id !== tenantId ||
      !date(d.checked_at) ||
      !Array.isArray(d.accounts) ||
      d.accounts.length > 20
    )
      throw Error();
    let last = "";
    const accounts: CommusoftRecurringAccount[] = d.accounts.map((a: any) => {
      if (
        !obj(a) ||
        !uuid(a.account_id) ||
        a.account_id <= last ||
        a.tenant_id !== tenantId ||
        !uuid(a.connection_id) ||
        !uuid(a.approved_by) ||
        typeof a.enabled !== "boolean" ||
        !integer(a.revision, 1, Number.MAX_SAFE_INTEGER) ||
        !integer(a.max_pages, 1, 10000) ||
        !integer(a.page_size, 1, 100) ||
        !integer(a.phase, 0, 4) ||
        ![a.watermark, a.cycle_start, a.cycle_end].every((v) => v === null || date(v)) ||
        !(a.current_request === null || uuid(a.current_request)) ||
        !date(a.next_check_at) ||
        !date(a.updated_at) ||
        !Object.hasOwn(commusoftRecurringStates, a.last_state)
      )
        throw Error();
      last = a.account_id;
      return {
        account_id: a.account_id,
        tenant_id: tenantId,
        connection_id: a.connection_id,
        approved_by: a.approved_by,
        enabled: a.enabled,
        revision: a.revision,
        max_pages: a.max_pages,
        page_size: a.page_size,
        watermark: a.watermark,
        cycle_start: a.cycle_start,
        cycle_end: a.cycle_end,
        phase: a.phase,
        current_request: a.current_request,
        last_state: a.last_state,
        next_check_at: a.next_check_at,
        updated_at: a.updated_at,
      };
    });
    return { checkedAt: d.checked_at as string, accounts };
  } catch {
    throw Error(
      "Ongoing Commusoft capture could not be checked. OpenFolk needs to verify the matching backend before changing it.",
    );
  }
}
function validate(r: CommusoftRecurringRequest) {
  const d = r?.definition;
  if (
    !obj(r) ||
    Object.keys(r).sort().join() !== "actorId,definition,requestId,tenantId" ||
    ![r.tenantId, r.actorId, r.requestId].every(uuid) ||
    !obj(d) ||
    Object.keys(d).sort().join() !==
      "account_id,enabled,expected_revision,max_pages,page_size,reason" ||
    !uuid(d.account_id) ||
    !integer(d.expected_revision, 0, 999999999999999) ||
    typeof d.enabled !== "boolean" ||
    !integer(d.max_pages, 1, 10000) ||
    !integer(d.page_size, 1, 100) ||
    typeof d.reason !== "string" ||
    !d.reason.trim() ||
    d.reason.length > 1000
  )
    throw Error("Review the account, page limits and reason.");
}
export async function resolveCommusoftRecurring(
  db: OperatorInputClient,
  r: CommusoftRecurringRequest,
  mode: "apply" | "check" | "cancel",
): Promise<CommusoftRecurringReceipt> {
  validate(r);
  if (!["apply", "check", "cancel"].includes(mode)) throw Error("Invalid action.");
  try {
    const { data, error } = await db.rpc("learn_commusoft_recurring_control", {
      p_tenant: r.tenantId,
      p_actor: r.actorId,
      p_request: r.requestId,
      p_definition: r.definition,
      p_mode: mode,
    });
    const d = data as any;
    if (
      error ||
      !obj(d) ||
      d.request_id !== r.requestId ||
      !["pending", "cancelled", "recorded"].includes(d.state)
    )
      throw Error();
    if (
      d.state === "recorded" &&
      (d.account_id !== r.definition.account_id ||
        d.enabled !== r.definition.enabled ||
        d.revision !== r.definition.expected_revision + 1)
    )
      throw Error();
    return d.state === "recorded"
      ? {
          state: d.state,
          request_id: d.request_id,
          account_id: d.account_id,
          enabled: d.enabled,
          revision: d.revision,
        }
      : { state: d.state, request_id: d.request_id };
  } catch {
    throw Error(
      "The result could not be confirmed. Keep the saved request and check its result before retrying.",
    );
  }
}
function checked(s: InputScope, v: SavedCommusoftRecurring) {
  commusoftRecurringOutboxKey(s);
  if (
    !obj(v) ||
    Object.keys(v).sort().join() !== "backend,request,version" ||
    v.version !== 1 ||
    v.backend !== s.backend ||
    v.request?.tenantId !== s.tenantId ||
    v.request?.actorId !== s.actorId
  )
    throw Error("Saved request belongs to another context or needs review.");
  validate(v.request);
  return structuredClone(v);
}
export function readSavedCommusoftRecurring(
  store: RequestStore,
  s: InputScope,
): SavedCommusoftRecurring | null {
  const raw = store.getItem(commusoftRecurringOutboxKey(s));
  if (raw === null) return null;
  try {
    if (raw.length > 8000) throw Error();
    return checked(s, JSON.parse(raw));
  } catch {
    throw Error("Saved capture request needs review. Keep this browser data.");
  }
}
export async function resolveSavedCommusoftRecurring(
  db: OperatorInputClient,
  store: RequestStore,
  lock: InputLock,
  s: InputScope,
  draft: SavedCommusoftRecurring,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
) {
  const value = checked(s, draft),
    encoded = JSON.stringify(value),
    key = commusoftRecurringOutboxKey(s);
  return lock(inputOutboxKey(s), async () => {
    if (!allowed()) throw Error("Operator context changed. Request retained.");
    if (
      [inputOutboxKey(s), connectionOutboxKey(s), captureOutboxKey(s)].some(
        (k) => store.getItem(k) !== null,
      )
    )
      throw Error("Resolve the saved import, connection or capture request first.");
    const prior = readSavedCommusoftRecurring(store, s);
    if (prior && JSON.stringify(prior) !== encoded)
      throw Error("Resolve the existing ongoing-capture request first.");
    if (!prior && mode !== "apply") throw Error("Saved request changed. Refresh status.");
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded)
      throw Error("Could not save the request. Nothing was sent.");
    if ((await readOperatorInputWriteAccess(db)) !== true || !allowed())
      throw Error("Current operator authority could not be confirmed. Request retained.");
    let result = await resolveCommusoftRecurring(db, value.request, "check");
    if (result.state === "pending" && mode !== "check") {
      if (!allowed()) throw Error("Operator context changed. Request retained.");
      result = await resolveCommusoftRecurring(db, value.request, mode);
    }
    if (result.state !== "pending") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error("Context changed. Check the saved result again.");
      store.removeItem(key);
      if (store.getItem(key) !== null)
        throw Error("Recorded result needs a further local recovery check.");
    }
    return result;
  });
}
