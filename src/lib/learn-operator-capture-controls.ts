import type { OperatorInputClient } from "./learn-operator-inputs.ts";
import {
  inputOutboxKey,
  connectionOutboxKey,
  captureOutboxKey,
  type InputScope,
  type InputLock,
  type RequestStore,
} from "./learn-operator-request-scope.ts";

export const captureFlags = [
  "learn.enabled",
  "learn.inputs.email.enabled",
  "learn.inputs.phone.enabled",
  "learn.inputs.slack.enabled",
] as const;
export type CaptureFlag = (typeof captureFlags)[number];
export type CaptureValues = Record<CaptureFlag, boolean>;
export type CaptureControls = {
  version: "learn-capture-controls/1";
  tenant_id: string;
  revision: string;
  flags: Record<CaptureFlag, boolean | null>;
  sources: Record<
    "email" | "phone" | "slack",
    { allowed: boolean; inherited: boolean; invalid: boolean }
  >;
};
export type CaptureRequest = {
  tenantId: string;
  actorId: string;
  requestId: string;
  definition: { reason: string; revision: string; values: CaptureValues };
};
export type SavedCapture = { version: 1; backend: string; request: CaptureRequest };
export type CaptureReceipt = {
  tenant_id: string;
  request_id: string;
  state: "pending" | "recorded" | "cancelled";
  controls?: CaptureControls;
};
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: any) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const revision = (v: any) => typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
function values(v: any, nullable = false) {
  return (
    object(v) &&
    Object.keys(v).length === 4 &&
    captureFlags.every((k) => typeof v[k] === "boolean" || (nullable && v[k] === null))
  );
}
function controls(v: any, tenant: string): v is CaptureControls {
  return (
    object(v) &&
    v.version === "learn-capture-controls/1" &&
    v.tenant_id === tenant &&
    revision(v.revision) &&
    values(v.flags, true) &&
    object(v.sources) &&
    Object.keys(v.sources).length === 3 &&
    ["email", "phone", "slack"].every(
      (s) =>
        object(v.sources[s]) &&
        ["allowed", "inherited", "invalid"].every((k) => typeof v.sources[s][k] === "boolean") &&
        !(v.sources[s].invalid && v.sources[s].allowed) &&
        !(v.flags["learn.enabled"] === false && v.sources[s].allowed) &&
        !(v.flags[`learn.inputs.${s}.enabled`] === false && v.sources[s].allowed),
    )
  );
}
export async function readCaptureControls(
  db: OperatorInputClient,
  tenant: string,
): Promise<CaptureControls> {
  if (!uuid(tenant)) throw Error("Choose a valid company.");
  try {
    const { data, error } = await db.rpc("learn_operator_capture_controls", { p_tenant: tenant });
    if (error || !controls(data, tenant)) throw Error();
    return data;
  } catch {
    throw Error(
      "Capture controls could not be verified. Check operator access and the service deployment, then refresh.",
    );
  }
}
export function validateCaptureRequest(r: any): asserts r is CaptureRequest {
  if (
    !object(r) ||
    ![r.tenantId, r.actorId, r.requestId].every(uuid) ||
    !object(r.definition) ||
    Object.keys(r.definition).sort().join() !== "reason,revision,values" ||
    typeof r.definition.reason !== "string" ||
    !r.definition.reason.trim() ||
    r.definition.reason.length > 1000 ||
    !revision(r.definition.revision) ||
    !values(r.definition.values)
  )
    throw Error("Review all four capture settings and provide a reason before saving.");
}
export async function resolveCaptureControl(
  db: OperatorInputClient,
  r: CaptureRequest,
  mode: "apply" | "check" | "cancel",
): Promise<CaptureReceipt> {
  validateCaptureRequest(r);
  if (!["apply", "check", "cancel"].includes(mode)) throw Error("Invalid capture request action.");
  try {
    const { data, error } = await db.rpc("learn_operator_capture_control_request", {
      p_tenant: r.tenantId,
      p_request: r.requestId,
      p_actor: r.actorId,
      p_definition: r.definition,
      p_mode: mode,
    });
    const d = data as CaptureReceipt;
    if (error) {
      if ((error as { message?: string }).message === "learn_capture_flags_changed")
        throw Error(
          "Settings changed since this review. Cancel the saved request, refresh, and review the current settings.",
        );
      throw Error();
    }
    if (
      !object(d) ||
      d.tenant_id !== r.tenantId ||
      d.request_id !== r.requestId ||
      !["pending", "recorded", "cancelled"].includes(d.state) ||
      (d.state === "recorded" &&
        (!controls(d.controls, r.tenantId) ||
          captureFlags.some((k) => d.controls!.flags[k] !== r.definition.values[k])))
    )
      throw Error();
    return d;
  } catch (e) {
    if (
      e instanceof Error &&
      e.message ===
        "Settings changed since this review. Cancel the saved request, refresh, and review the current settings."
    )
      throw e;
    throw Error(
      "The capture change could not be confirmed. Keep the saved request and check its result before retrying.",
    );
  }
}
function checked(scope: InputScope, v: any): SavedCapture {
  inputOutboxKey(scope);
  if (
    !object(v) ||
    v.version !== 1 ||
    v.backend !== scope.backend ||
    v.request?.tenantId !== scope.tenantId ||
    v.request?.actorId !== scope.actorId
  )
    throw Error("The saved capture request could not be verified. It has been retained.");
  validateCaptureRequest(v.request);
  const { tenantId, actorId, requestId, definition } = v.request;
  return {
    version: 1,
    backend: scope.backend,
    request: { tenantId, actorId, requestId, definition: structuredClone(definition) },
  };
}
export function readSavedCapture(store: RequestStore, scope: InputScope): SavedCapture | null {
  const raw = store.getItem(captureOutboxKey(scope));
  if (raw === null) return null;
  try {
    if (raw.length > 15000) throw Error();
    return checked(scope, JSON.parse(raw));
  } catch {
    throw Error("The saved capture request could not be read. It has been retained.");
  }
}
export async function resolveSavedCapture(
  db: OperatorInputClient,
  store: RequestStore,
  lock: InputLock,
  scope: InputScope,
  input: SavedCapture,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
) {
  const v = checked(scope, input),
    key = captureOutboxKey(scope),
    encoded = JSON.stringify(v);
  return lock(inputOutboxKey(scope), async () => {
    if (!allowed()) throw Error("Operator context changed. Reopen the company before continuing.");
    if (
      mode === "apply" &&
      [inputOutboxKey(scope), connectionOutboxKey(scope)].some((k) => store.getItem(k) !== null)
    )
      throw Error(
        "Resolve the saved module, import or connection request before changing capture.",
      );
    const saved = readSavedCapture(store, scope);
    if (saved && JSON.stringify(saved) !== encoded)
      throw Error("Resolve the existing capture request first.");
    if (!saved && mode !== "apply")
      throw Error("The saved capture request changed. Refresh before continuing.");
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded)
      throw Error("The request could not be saved. Nothing was sent.");
    if (!allowed()) throw Error("Operator context changed; request retained.");
    let receipt = await resolveCaptureControl(db, v.request, "check");
    if (receipt.state === "pending" && mode !== "check") {
      if (!allowed()) throw Error("Operator context changed; request retained.");
      receipt = await resolveCaptureControl(db, v.request, mode);
    }
    if (receipt.state !== "pending") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error(
          "The result was recorded, but the saved context changed. Check the receipt again.",
        );
      store.removeItem(key);
      if (store.getItem(key) !== null)
        throw Error("The result was recorded, but recovery storage could not be cleared.");
    }
    return receipt;
  });
}
