/** Reviewed refreshes keep their request until a matching durable receipt returns. */
export type RefreshScope = { backend: string; tenant: string; actor: string };
export type RefreshClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export type RefreshStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RefreshFields = {
  title: string;
  description: string | null;
  status: string;
  created_date: string | null;
  completed_date: string | null;
};
export type RefreshPlan =
  | {
      state: "ready";
      tenant_id: string;
      link_id: string;
      job_id: string;
      source_version_id: string;
      previous_version_id: string;
      job_number: string;
      revision: string;
      before: RefreshFields;
      after: RefreshFields;
      changed_fields: string[];
      timing_limitations: string[];
    }
  | {
      state: "held" | "current";
      tenant_id: string;
      link_id: string;
      job_id: string;
      reason?: string;
    };
export type RefreshDraft = {
  version: 1;
  scope: RefreshScope;
  request: string;
  link: string;
  job: string;
  source: string;
  previous: string;
  revision: string;
  reason: string;
};
export type RefreshReceipt = {
  state: "committed";
  request_id: string;
  tenant_id: string;
  link_id: string;
  job_id: string;
  source_version_id: string;
  previous_version_id: string;
  revision: number;
  changed_fields: string[];
  timing_limitations: string[];
};
export type RefreshCancellation = {
  state: "cancelled";
  request_id: string;
  tenant_id: string;
  link_id: string;
  job_id: string;
  source_version_id: string;
  actor_id: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = ["title", "description", "status", "created_date", "completed_date"];
const failure = () =>
  Error(
    "Job update could not be verified. Keep the saved request and check its result before trying again.",
  );
function list(v: unknown, allowed: string[]): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= allowed.length &&
    new Set(v).size === v.length &&
    v.every((x) => typeof x === "string" && allowed.includes(x))
  );
}
function fields(v: unknown): v is RefreshFields {
  return (
    object(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => k in v) &&
    typeof v.title === "string" &&
    v.title.length <= 1000 &&
    (v.description === null ||
      (typeof v.description === "string" && v.description.length <= 1000)) &&
    ["open", "completed", "closed", "on_hold", "pending"].includes(v.status) &&
    ["created_date", "completed_date"].every(
      (k) =>
        v[k] === null ||
        (typeof v[k] === "string" && v[k].length <= 64 && Number.isFinite(Date.parse(v[k]))),
    )
  );
}
export function refreshKey(scope: RefreshScope, link: string) {
  if (
    !uuid(scope.tenant) ||
    !uuid(scope.actor) ||
    !uuid(link) ||
    typeof scope.backend !== "string" ||
    !/^https?:\/\/[^\s?#]+$/.test(scope.backend)
  )
    throw failure();
  return `serviceos:job-refresh:1:${encodeURIComponent(scope.backend)}:${scope.tenant}:${scope.actor}:${link}`;
}
export async function loadJobRefresh(
  client: RefreshClient,
  scope: RefreshScope,
  link: string,
): Promise<RefreshPlan> {
  refreshKey(scope, link);
  const { data: r, error } = await client.rpc("learn_commusoft_job_refresh_plan", {
    p_tenant: scope.tenant,
    p_link: link,
  });
  if (
    error ||
    !object(r) ||
    r.version !== "learn-business-refresh/1" ||
    r.tenant_id !== scope.tenant ||
    r.link_id !== link ||
    !uuid(r.job_id)
  )
    throw failure();
  if (r.state === "current")
    return {
      state: r.state,
      tenant_id: r.tenant_id,
      link_id: link,
      job_id: r.job_id,
    };
  if (r.state === "held" && typeof r.reason === "string" && /^[a-z_]{1,100}$/.test(r.reason))
    return {
      state: r.state,
      tenant_id: r.tenant_id,
      link_id: link,
      job_id: r.job_id,
      reason: r.reason,
    };
  if (
    r.state !== "ready" ||
    !uuid(r.source_version_id) ||
    !uuid(r.previous_version_id) ||
    r.source_version_id === r.previous_version_id ||
    typeof r.job_number !== "string" ||
    r.job_number.length > 100 ||
    typeof r.revision !== "string" ||
    !/^[a-f0-9]{32}$/.test(r.revision) ||
    !fields(r.before) ||
    !fields(r.after) ||
    !list(r.changed_fields, keys) ||
    !list(r.timing_limitations, ["created", "completed"])
  )
    throw failure();
  return {
    state: "ready",
    tenant_id: r.tenant_id,
    link_id: link,
    job_id: r.job_id,
    source_version_id: r.source_version_id,
    previous_version_id: r.previous_version_id,
    job_number: r.job_number,
    revision: r.revision,
    before: r.before,
    after: r.after,
    changed_fields: r.changed_fields,
    timing_limitations: r.timing_limitations,
  };
}
function checkedDraft(scope: RefreshScope, link: string, v: unknown): RefreshDraft {
  refreshKey(scope, link);
  if (
    !object(v) ||
    v.version !== 1 ||
    !object(v.scope) ||
    v.scope.backend !== scope.backend ||
    v.scope.tenant !== scope.tenant ||
    v.scope.actor !== scope.actor ||
    v.link !== link ||
    ![v.request, v.job, v.source, v.previous].every(uuid) ||
    v.source === v.previous ||
    typeof v.revision !== "string" ||
    !/^[a-f0-9]{32}$/.test(v.revision) ||
    typeof v.reason !== "string" ||
    v.reason.trim().length < 3 ||
    v.reason.length > 1000
  )
    throw failure();
  return {
    version: 1,
    scope: { ...scope },
    request: v.request,
    link,
    job: v.job,
    source: v.source,
    previous: v.previous,
    revision: v.revision,
    reason: v.reason.trim(),
  };
}
export function readJobRefreshDraft(
  store: RefreshStore,
  scope: RefreshScope,
  link: string,
): RefreshDraft | null {
  const raw = store.getItem(refreshKey(scope, link));
  if (raw === null) return null;
  if (raw.length > 10000) throw failure();
  try {
    return checkedDraft(scope, link, JSON.parse(raw));
  } catch {
    throw failure();
  }
}
export function prepareJobRefresh(
  scope: RefreshScope,
  plan: RefreshPlan,
  request: string,
  reason: string,
): RefreshDraft {
  if (plan.state !== "ready" || plan.tenant_id !== scope.tenant) throw failure();
  return checkedDraft(scope, plan.link_id, {
    version: 1,
    scope,
    request,
    link: plan.link_id,
    job: plan.job_id,
    source: plan.source_version_id,
    previous: plan.previous_version_id,
    revision: plan.revision,
    reason,
  });
}
function receipt(r: unknown, d: RefreshDraft): RefreshReceipt | RefreshCancellation {
  if (
    object(r) &&
    r.version === "learn-business-refresh/1" &&
    r.state === "cancelled" &&
    r.tenant_id === d.scope.tenant &&
    r.request_id === d.request &&
    r.link_id === d.link &&
    r.job_id === d.job &&
    r.source_version_id === d.source &&
    r.actor_id === d.scope.actor
  ) {
    return {
      state: "cancelled",
      tenant_id: r.tenant_id,
      request_id: r.request_id,
      link_id: r.link_id,
      job_id: r.job_id,
      source_version_id: r.source_version_id,
      actor_id: r.actor_id,
    };
  }
  if (
    !object(r) ||
    r.version !== "learn-business-refresh/1" ||
    r.state !== "committed" ||
    r.tenant_id !== d.scope.tenant ||
    r.request_id !== d.request ||
    r.link_id !== d.link ||
    r.job_id !== d.job ||
    r.source_version_id !== d.source ||
    r.previous_version_id !== d.previous ||
    !Number.isSafeInteger(r.revision) ||
    r.revision < 1 ||
    !list(r.changed_fields, keys) ||
    !list(r.timing_limitations, ["created", "completed"])
  )
    throw failure();
  return {
    state: "committed",
    tenant_id: r.tenant_id,
    request_id: r.request_id,
    link_id: r.link_id,
    job_id: r.job_id,
    source_version_id: r.source_version_id,
    previous_version_id: r.previous_version_id,
    revision: r.revision,
    changed_fields: r.changed_fields,
    timing_limitations: r.timing_limitations,
  };
}
export async function resolveJobRefresh(
  client: RefreshClient,
  store: RefreshStore,
  draft: RefreshDraft,
  mode: "check" | "apply" | "cancel",
  lock: <T>(name: string, work: () => Promise<T>) => Promise<T>,
  active: () => boolean,
): Promise<RefreshReceipt | RefreshCancellation | { state: "pending" }> {
  const d = checkedDraft(draft.scope, draft.link, draft),
    key = refreshKey(d.scope, d.link),
    encoded = JSON.stringify(d);
  return lock(key, async () => {
    if (!active()) throw failure();
    const saved = readJobRefreshDraft(store, d.scope, d.link);
    if (saved && JSON.stringify(saved) !== encoded) throw failure();
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded) throw failure();
    const args = {
      p_tenant: d.scope.tenant,
      p_request: d.request,
      p_link: d.link,
      p_source: d.source,
      p_revision: d.revision,
      p_reason: d.reason,
    };
    const call = async (action: "check" | "apply" | "cancel") => {
      if (!active()) throw failure();
      const { data, error } = await client.rpc("learn_commusoft_job_refresh", {
        ...args,
        p_action: action,
      });
      if (error || !active()) throw failure();
      return data;
    };
    let r = await call("check");
    if (object(r) && r.state === "pending" && r.request_id === d.request) {
      if (mode === "check") return { state: "pending" };
      r = await call(mode);
    }
    const result = receipt(r, d);
    if (!active() || store.getItem(key) !== encoded) throw failure();
    store.removeItem(key);
    return result;
  });
}
