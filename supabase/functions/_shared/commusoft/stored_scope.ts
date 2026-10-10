import type { CommusoftReadRequest } from "./read_page.ts";

// Structural port keeps the source adapter independent of the full worker registry.
export interface CommusoftWorkerScope {
  tenantId: string;
  jobId: string | null;
  jobType?: string;
  claim?: { claimedBy: string; attemptCount: number };
  signal?: AbortSignal;
  supabaseAdmin: { from: (table: string) => any };
}
export interface StoredCommusoftScope {
  tenantId: string;
  jobId: string;
  accountId: string;
  connectorId: string;
  connectionId: string;
  connectionRevision: string;
  secretId: string;
  approval: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  request: CommusoftReadRequest;
  pages: number;
  complete: boolean;
  scopeKey: string;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const nonempty = (v: unknown): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= 2000;
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** Reads durable job/configuration only, never caller payload. No secret read or
 * provider call. Gate keys are tenant-specific opt-ins in the existing flag store.
 * The credential acquisition and page publication RPCs must repeat these checks
 * under locks; this read is not a transaction or sufficient publication authority.
 */
export async function readStoredCommusoftScope(
  ctx: CommusoftWorkerScope,
  clock: () => number = Date.now,
): Promise<StoredCommusoftScope | null> {
  try {
    const now = clock();
    if (
      !Number.isFinite(now) ||
      !uuid(ctx.tenantId) ||
      !uuid(ctx.jobId) ||
      ctx.signal?.aborted ||
      ctx.jobType !== "commusoft.source_sync" ||
      !nonempty(ctx.claim?.claimedBy) ||
      !id(ctx.claim?.attemptCount)
    )
      return null;
    const db = ctx.supabaseAdmin;
    const read = async (table: string, columns: string, filters: [string, unknown][]) => {
      let query = db.from(table).select(columns);
      for (const [field, value] of filters) query = query.eq(field, value);
      const result = await query.maybeSingle();
      if (result.error || !obj(result.data)) throw Error("scope_unavailable");
      return result.data;
    };
    const tenant = await read("tenants", "id,status", [["id", ctx.tenantId]]);
    if (tenant.id !== ctx.tenantId || tenant.status !== "active") return null;
    const flags = [];
    for (const key of ["learn.enabled", "learn.inputs.commusoft.enabled"]) {
      const flag = await read("feature_flags", "id,tenant_id,flag,value", [
        ["tenant_id", ctx.tenantId],
        ["flag", key],
      ]);
      if (
        !uuid(flag.id) ||
        flag.tenant_id !== ctx.tenantId ||
        flag.flag !== key ||
        flag.value !== true
      )
        return null;
      flags.push([flag.id, flag.flag, flag.value]);
    }
    const job = await read(
      "platform_jobs",
      "id,tenant_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at",
      [
        ["tenant_id", ctx.tenantId],
        ["id", ctx.jobId],
      ],
    );
    if (
      job.id !== ctx.jobId ||
      job.tenant_id !== ctx.tenantId ||
      job.job_type !== ctx.jobType ||
      job.status !== "running" ||
      job.claimed_by !== ctx.claim!.claimedBy ||
      job.attempt_count !== ctx.claim!.attemptCount ||
      !date(job.lease_expires_at) ||
      Date.parse(job.lease_expires_at) <= now ||
      !uuid(job.payload?.connector_account_id)
    )
      return null;
    const account = await read(
      "connector_accounts",
      "id,tenant_id,tenant_connector_id,account_key,status,settings,sync_cursor",
      [
        ["tenant_id", ctx.tenantId],
        ["id", job.payload.connector_account_id],
      ],
    );
    if (
      account.id !== job.payload.connector_account_id ||
      account.tenant_id !== ctx.tenantId ||
      account.status !== "active" ||
      !uuid(account.tenant_connector_id) ||
      !nonempty(account.account_key)
    )
      return null;
    const connector = await read(
      "tenant_connectors",
      "id,tenant_id,connector_id,provider,enabled,status",
      [
        ["tenant_id", ctx.tenantId],
        ["id", account.tenant_connector_id],
      ],
    );
    if (
      connector.id !== account.tenant_connector_id ||
      connector.tenant_id !== ctx.tenantId ||
      connector.provider !== "commusoft" ||
      connector.connector_id !== "commusoft" ||
      connector.enabled !== true ||
      connector.status !== "active"
    )
      return null;
    const cfg = account.settings?.commusoft_import;
    if (
      !obj(cfg) ||
      cfg.approved !== true ||
      !uuid(cfg.approvalId) ||
      !uuid(cfg.connectionId) ||
      !nonempty(cfg.consentReference) ||
      !date(cfg.expiresAt) ||
      Date.parse(cfg.expiresAt) <= now ||
      !id(cfg.maxPages) ||
      cfg.maxPages > 10000 ||
      !id(cfg.pageSize) ||
      cfg.pageSize > 100 ||
      !["properties", "propertyContacts", "jobs"].includes(cfg.resource) ||
      (cfg.resource === "propertyContacts" &&
        (!["customer", "workaddress"].includes(cfg.contactType) || !id(cfg.propertyId))) ||
      (cfg.resource !== "propertyContacts" &&
        (cfg.contactType !== undefined || cfg.propertyId !== undefined))
    )
      return null;
    if (job.job_key !== `commusoft.source:${account.id}:${cfg.approvalId}`) return null;
    const connection = await read(
      "provider_connections",
      "id,tenant_id,provider,status,auth_mode,revoked_at,verified_at,updated_at,non_secret_config,configured_fields,secret_refs",
      [
        ["tenant_id", ctx.tenantId],
        ["id", cfg.connectionId],
      ],
    );
    if (
      connection.id !== cfg.connectionId ||
      connection.tenant_id !== ctx.tenantId ||
      connection.provider !== "commusoft" ||
      connection.status !== "configured" ||
      connection.auth_mode !== "private_api_key" ||
      connection.revoked_at !== null ||
      !date(connection.verified_at) ||
      Date.parse(connection.verified_at) > now ||
      !date(connection.updated_at) ||
      !["uk", "us"].includes(connection.non_secret_config?.region) ||
      connection.non_secret_config?.account_key !== account.account_key ||
      !Array.isArray(connection.configured_fields) ||
      !connection.configured_fields.includes("api_key") ||
      !uuid(connection.secret_refs?.api_key)
    )
      return null;
    const saved = account.sync_cursor;
    if (!obj(saved)) return null;
    const checkpoint =
      Object.keys(saved).length === 0
        ? { approvalId: cfg.approvalId, after: null, pages: 0, complete: false }
        : saved;
    if (
      checkpoint.approvalId !== cfg.approvalId ||
      !Number.isSafeInteger(checkpoint.pages) ||
      checkpoint.pages < 0 ||
      checkpoint.pages > cfg.maxPages ||
      typeof checkpoint.complete !== "boolean" ||
      (checkpoint.after !== null && !id(checkpoint.after)) ||
      (checkpoint.pages === 0 && (checkpoint.after !== null || checkpoint.complete)) ||
      (checkpoint.pages > 0 && !checkpoint.complete && checkpoint.after === null) ||
      (checkpoint.complete && checkpoint.after !== null)
    )
      return null;
    if (
      ctx.signal?.aborted ||
      Date.parse(job.lease_expires_at) <= clock() ||
      Date.parse(cfg.expiresAt) <= clock()
    )
      return null;
    const request: CommusoftReadRequest = {
      region: connection.non_secret_config.region,
      resource: cfg.resource,
      after: checkpoint.after,
      limit: cfg.pageSize,
      ...(cfg.contactType ? { contactType: cfg.contactType } : {}),
      ...(cfg.propertyId !== undefined ? { propertyId: cfg.propertyId } : {}),
    };
    // Compare all selected authority and cursor fields; a lease extension alone is
    // allowed. Stored approval/config changes invalidate the acquired binding.
    const scopeKey = JSON.stringify([
      ctx.tenantId,
      ctx.jobId,
      ctx.claim,
      flags,
      account.id,
      account.account_key,
      connector.id,
      cfg,
      saved,
      connection.id,
      connection.updated_at,
      connection.verified_at,
      connection.non_secret_config,
      connection.secret_refs.api_key,
    ]);
    return {
      tenantId: ctx.tenantId,
      jobId: ctx.jobId,
      accountId: account.id,
      connectorId: connector.id,
      connectionId: connection.id,
      connectionRevision: connection.updated_at,
      secretId: connection.secret_refs.api_key,
      approval: structuredClone(cfg),
      checkpoint: structuredClone(saved),
      request,
      pages: checkpoint.pages,
      complete: checkpoint.complete,
      scopeKey,
    };
  } catch {
    return null;
  }
}
