/** Operator control metadata only; no credentials or raw source records. */
export type InputFlags = {
  "learn.enabled": boolean | null;
  "learn.inputs.commusoft.enabled": boolean | null;
};
export type InputCheckpoint = {
  approvalId: string | null;
  pages: number | null;
  after: number | null;
  complete: boolean | null;
  propertyId?: number | null;
  propertiesCompleted?: number;
};
export type OperatorInputDefinition =
  | { kind: "set_modules"; reason: string; expected: InputFlags; values: InputFlags }
  | {
      kind: "start_commusoft";
      reason: string;
      connection_id: string;
      revision: string;
      resource: "properties" | "jobs" | "propertyContacts";
      contact_type?: "customer" | "workaddress";
      max_pages: number;
      page_size: number;
      expires_at: string;
    }
  | {
      kind: "resume_commusoft";
      reason: string;
      account_id: string;
      approval_id: string;
      job_id: string;
      connection_id: string;
      revision: string;
      checkpoint: InputCheckpoint;
      max_pages: number;
      expires_at: string;
    };
export type OperatorInputRequest = {
  tenantId: string;
  actorId: string;
  requestId: string;
  definition: OperatorInputDefinition;
};
export type InputReceipt = {
  tenant_id: string;
  request_id: string;
  state: "pending" | "cancelled" | "recorded";
  kind?: OperatorInputDefinition["kind"];
  flags?: InputFlags;
  account_id?: string;
  job_id?: string;
  approval_id?: string;
  checkpoint?: InputCheckpoint;
};
export type InputConnection = {
  id: string;
  status: string;
  revision: string;
  verified_at: string | null;
  revoked: boolean;
  account_key: string | null;
  region: string | null;
  credential_bound: boolean;
};
export type InputAccount = {
  id: string;
  status: string;
  connector_enabled: boolean;
  connection_id: string | null;
  resource: string | null;
  approval_id: string | null;
  expires_at: string | null;
  max_pages: number | null;
  contact_target_count?: number | null;
  checkpoint: InputCheckpoint;
  latest_job: null | {
    id: string;
    status: string;
    error_code: string | null;
    attempt_count: number;
    available_at: string | null;
    lease_expires_at: string | null;
    completed_at: string | null;
    stop_reason: string | null;
  };
};
export type InputOverview = {
  tenant_id: string;
  checked_at: string;
  flags: InputFlags;
  connections: InputConnection[];
  accounts: InputAccount[];
};
export interface OperatorInputClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
/** UI permission hint only. Every operation still requires current server authority. */
export async function readOperatorInputWriteAccess(
  db: OperatorInputClient,
): Promise<boolean | null> {
  try {
    const { data, error } = await db.rpc("current_user_is_openfolk_operator", {
      required_permission: "platform.controlplane.admin",
    });
    return !error && typeof data === "boolean" ? data : null;
  } catch {
    return null;
  }
}
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const nullable = (v: unknown, test: (v: unknown) => boolean) => v === null || test(v);
const string = (v: unknown): v is string => typeof v === "string" && v.length <= 2000;
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function checkpoint(v: unknown): v is InputCheckpoint {
  return (
    object(v) &&
    Object.keys(v).sort().join() ===
      (Object.hasOwn(v, "propertyId") || Object.hasOwn(v, "propertiesCompleted")
        ? ["approvalId", "pages", "after", "complete", "propertyId", "propertiesCompleted"]
        : ["approvalId", "pages", "after", "complete"]
      )
        .sort()
        .join() &&
    (!Object.hasOwn(v, "propertyId") ||
      (integer(v.propertiesCompleted) &&
        (v.complete === true
          ? v.propertyId === null
          : integer(v.propertyId) && v.propertyId > 0))) &&
    nullable(v.approvalId, uuid) &&
    nullable(v.pages, integer) &&
    nullable(v.after, integer) &&
    nullable(v.complete, (x) => typeof x === "boolean")
  );
}
function sameCheckpoint(a: unknown, b: InputCheckpoint) {
  return (
    checkpoint(a) &&
    ["approvalId", "pages", "after", "complete", "propertyId", "propertiesCompleted"].every(
      (k) => a[k as keyof InputCheckpoint] === b[k as keyof InputCheckpoint],
    )
  );
}
function flags(v: unknown): v is InputFlags {
  return (
    object(v) &&
    Object.keys(v).length === 2 &&
    ["learn.enabled", "learn.inputs.commusoft.enabled"].every(
      (k) => v[k] === null || typeof v[k] === "boolean",
    )
  );
}
export function validateInputRequest(r: unknown): asserts r is OperatorInputRequest {
  if (
    !object(r) ||
    !uuid(r.tenantId) ||
    !uuid(r.actorId) ||
    !uuid(r.requestId) ||
    !object(r.definition)
  )
    throw Error("Invalid saved operator request.");
  const d = r.definition;
  if (typeof d.reason !== "string" || !d.reason.trim() || d.reason.length > 1000)
    throw Error("Enter a reason for this change.");
  if (d.kind === "set_modules") {
    if (
      Object.keys(d).length !== 4 ||
      !flags(d.expected) ||
      !flags(d.values) ||
      Object.values(d.values).some((v) => v === null)
    )
      throw Error("Choose explicit module settings.");
  } else if (d.kind === "start_commusoft") {
    if (
      !uuid(d.connection_id) ||
      !date(d.revision) ||
      !date(d.expires_at) ||
      !["properties", "jobs", "propertyContacts"].includes(d.resource) ||
      !integer(d.max_pages) ||
      d.max_pages < 1 ||
      d.max_pages > 10000 ||
      !integer(d.page_size) ||
      d.page_size < 1 ||
      d.page_size > 100 ||
      (d.resource === "propertyContacts"
        ? !["customer", "workaddress"].includes(d.contact_type)
        : "contact_type" in d) ||
      Object.keys(d).some(
        (k) =>
          ![
            "kind",
            "reason",
            "connection_id",
            "revision",
            "expires_at",
            "resource",
            "contact_type",
            "max_pages",
            "page_size",
          ].includes(k),
      )
    )
      throw Error("Check the connection, collection and import limits.");
    // Expired saved requests still need receipt checks/cancellation. The server
    // validates time before a new apply, after checking its immutable receipt.
  } else if (d.kind === "resume_commusoft") {
    if (
      Object.keys(d).sort().join() !==
        [
          "kind",
          "reason",
          "account_id",
          "approval_id",
          "job_id",
          "connection_id",
          "revision",
          "checkpoint",
          "max_pages",
          "expires_at",
        ]
          .sort()
          .join() ||
      !uuid(d.account_id) ||
      !uuid(d.approval_id) ||
      !uuid(d.job_id) ||
      !uuid(d.connection_id) ||
      !date(d.revision) ||
      !date(d.expires_at) ||
      !checkpoint(d.checkpoint) ||
      !integer(d.max_pages) ||
      d.max_pages < 1 ||
      d.max_pages > 2147483647 ||
      d.max_pages - (d.checkpoint.pages ?? 0) > 10000 ||
      d.checkpoint.complete === true ||
      d.max_pages <= (d.checkpoint.pages ?? 0) ||
      (d.checkpoint.approvalId !== null && d.checkpoint.approvalId !== d.approval_id)
    )
      throw Error("Refresh retained progress and review the continuation limits.");
  } else throw Error("Unsupported operator action.");
}
export async function readOperatorInputs(
  db: OperatorInputClient,
  tenantId: string,
): Promise<InputOverview> {
  if (!uuid(tenantId)) throw Error("Invalid company.");
  const { data: d, error } = await db.rpc("learn_operator_inputs", { p_tenant: tenantId });
  if (
    error ||
    !object(d) ||
    d.tenant_id !== tenantId ||
    !date(d.checked_at) ||
    !flags(d.flags) ||
    !Array.isArray(d.connections) ||
    d.connections.length > 20 ||
    !Array.isArray(d.accounts) ||
    d.accounts.length > 20 ||
    d.connections.some(
      (c) =>
        !object(c) ||
        !uuid(c.id) ||
        !string(c.status) ||
        !date(c.revision) ||
        !nullable(c.verified_at, date) ||
        typeof c.revoked !== "boolean" ||
        !nullable(c.account_key, string) ||
        !nullable(c.region, string) ||
        typeof c.credential_bound !== "boolean",
    ) ||
    d.accounts.some(
      (a) =>
        !object(a) ||
        !uuid(a.id) ||
        !string(a.status) ||
        typeof a.connector_enabled !== "boolean" ||
        !nullable(a.connection_id, uuid) ||
        !nullable(a.approval_id, uuid) ||
        !nullable(a.resource, string) ||
        !nullable(a.expires_at, date) ||
        !nullable(a.max_pages, integer) ||
        !checkpoint(a.checkpoint) ||
        (a.contact_target_count !== undefined && !nullable(a.contact_target_count, integer)) ||
        (a.latest_job !== null &&
          (!object(a.latest_job) ||
            !uuid(a.latest_job.id) ||
            !string(a.latest_job.status) ||
            !nullable(a.latest_job.error_code, string) ||
            !integer(a.latest_job.attempt_count) ||
            !nullable(a.latest_job.available_at, date) ||
            !nullable(a.latest_job.lease_expires_at, date) ||
            !nullable(a.latest_job.completed_at, date) ||
            !nullable(a.latest_job.stop_reason, string))),
    )
  )
    throw Error(
      "Operator input status could not be verified. Refresh or check the service deployment.",
    );
  return d as InputOverview;
}
export async function resolveOperatorInput(
  db: OperatorInputClient,
  r: OperatorInputRequest,
  mode: "apply" | "check" | "cancel",
): Promise<InputReceipt> {
  validateInputRequest(r);
  const { data, error } = await db.rpc(
    r.definition.kind === "resume_commusoft"
      ? "learn_operator_resume_commusoft"
      : "learn_operator_input_request",
    {
      p_tenant: r.tenantId,
      p_request: r.requestId,
      p_actor: r.actorId,
      p_definition: r.definition,
      p_mode: mode,
    },
  );
  if (error) {
    const contactFailures: Record<string, { code: string; message: string }> = {
      learn_operator_property_traversal_required: {
        code: "55000",
        message:
          "Finish a property import before importing its contacts. Cancel this saved request, complete the property import, then approve contacts.",
      },
      learn_operator_contact_properties_missing: {
        code: "55000",
        message:
          "The completed property import contains no properties of this contact type. Cancel this request and review the selected type or refresh the property import.",
      },
      learn_operator_contact_plan_invalid: {
        code: "PT409",
        message:
          "The saved contact plan could not be verified. Keep its retained history and review the plan before continuing.",
      },
    };
    if (
      object(error) &&
      typeof error.message === "string" &&
      Object.hasOwn(contactFailures, error.message)
    ) {
      const known = contactFailures[error.message];
      if (error.code === known.code) throw Error(known.message);
    }
    throw Error(
      "The request was not confirmed. Keep it saved and check its receipt before making another change.",
    );
  }
  if (
    !object(data) ||
    data.tenant_id !== r.tenantId ||
    data.request_id !== r.requestId ||
    !["pending", "cancelled", "recorded"].includes(data.state) ||
    (data.state === "pending" && mode !== "check") ||
    (data.state === "recorded" &&
      (data.kind !== r.definition.kind ||
        (data.kind === "set_modules"
          ? !flags(data.flags) ||
            r.definition.kind !== "set_modules" ||
            ["learn.enabled", "learn.inputs.commusoft.enabled"].some(
              (k) =>
                data.flags[k] !==
                (r.definition as Extract<OperatorInputDefinition, { kind: "set_modules" }>).values[
                  k as keyof InputFlags
                ],
            )
          : !uuid(data.account_id) ||
            !uuid(data.job_id) ||
            (r.definition.kind === "resume_commusoft" &&
              (data.account_id !== r.definition.account_id ||
                data.approval_id !== r.definition.approval_id ||
                data.job_id === r.definition.job_id ||
                !sameCheckpoint(data.checkpoint, r.definition.checkpoint))))))
  )
    throw Error("The result could not be verified. Keep this request saved and check again.");
  return data as InputReceipt;
}
export function inputAccountStatus(a: InputAccount, f: InputFlags, now = Date.now()) {
  if (
    f["learn.enabled"] !== true ||
    f["learn.inputs.commusoft.enabled"] !== true ||
    !a.connector_enabled ||
    a.status !== "active"
  )
    return "Paused — retained history is available";
  const j = a.latest_job;
  if (!j) return "No import has been recorded";
  if (j.status === "succeeded")
    return a.checkpoint.complete === true && j.stop_reason === "collection_exhausted"
      ? "Collection traversal finished — review coverage"
      : "Page saved — more work or review may be needed";
  if (j.status === "dead_letter") return "Operator review needed — history retained";
  if (a.expires_at && Date.parse(a.expires_at) <= now)
    return "Import approval expired — review before continuing";
  if (j.status === "running")
    return !j.lease_expires_at || Date.parse(j.lease_expires_at) <= now
      ? "Interrupted import — worker recovery needed"
      : "Import is running";
  if (j.status === "retrying") return "Waiting for a retry";
  if (j.status === "queued") return "Queued — waiting for the worker";
  return "Import status needs review";
}
