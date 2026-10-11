// Manual requests enter the same durable queue as scheduled work. Acceptance is
// not completion; only the claimed worker can publish and settle each batch.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertSameTenant, requireTenantUser } from "./authz.ts";
import { createPlatformJob } from "./platform_jobs.ts";

type Kind = "interactions.sync" | "identity.resolve";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const states = ["queued", "running", "retrying", "succeeded", "failed", "dead_letter", "cancelled"];
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json",
};
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers });
const fail = (code: string, message: string, status: number) =>
  json({ success: false, error: { code, message } }, status);

export function processingRequestHandler(kind: Kind, createAdmin: () => SupabaseClient | null) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);
    try {
      const admin = createAdmin();
      if (!admin) return fail("config_error", "Processing is currently unavailable.", 503);
      const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
      if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
      const tenant = auth.ctx.tenantId;
      if (!UUID.test(tenant)) return fail("forbidden", "A valid company is required.", 403);
      let body: Record<string, unknown>;
      try {
        const parsed = await req.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("body");
        body = parsed;
      } catch {
        return fail("invalid_body", "Use a JSON object.", 400);
      }
      const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
      if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
      const allowed =
        kind === "interactions.sync" ? ["source", "limit", "tenant_id"] : ["limit", "tenant_id"];
      if (Object.keys(body).some((key) => !allowed.includes(key)))
        return fail("invalid_body", "This processing request contains unsupported options.", 400);
      if (
        body.limit !== undefined &&
        (typeof body.limit !== "number" ||
          !Number.isInteger(body.limit) ||
          body.limit < 1 ||
          body.limit > 50)
      )
        return fail("invalid_limit", "Choose a batch size between 1 and 50.", 400);
      if (
        body.source !== undefined &&
        (typeof body.source !== "string" || !["phone", "email", "all"].includes(body.source))
      )
        return fail(
          "projection_source_invalid",
          "Choose Phone, Email or all communication inputs.",
          400,
        );
      const source = kind === "identity.resolve" ? "identity" : String(body.source ?? "all");
      const key = kind === "identity.resolve" ? `${kind}:${tenant}` : `${kind}:${tenant}:${source}`;
      const moduleId = kind === "identity.resolve" ? "core.identity" : "core.interactions";
      const job = await createPlatformJob(admin, {
        tenantId: tenant,
        connectorId: "openfolk-core",
        moduleId,
        jobType: kind,
        jobKey: key,
        priority: 50,
        maxAttempts: 5,
        payload: { limit: body.limit ?? 20, ...(kind === "interactions.sync" ? { source } : {}) },
        createdBy: auth.ctx.userId === "service" ? null : auth.ctx.userId,
      });
      if (!job.id || !UUID.test(job.id))
        return fail(
          "job_unconfirmed",
          "We could not confirm that the request was saved. Please retry.",
          503,
        );
      // Confirm the actual row, including when an active request already exists.
      // A lost or inconsistent write acknowledgement never authorizes inline work.
      const { data: row, error } = await admin
        .from("platform_jobs")
        .select("id, tenant_id, job_type, job_key, connector_id, module_id, status, payload")
        .eq("id", job.id)
        .eq("tenant_id", tenant)
        .maybeSingle();
      if (
        error ||
        !row ||
        row.id !== job.id ||
        row.tenant_id !== tenant ||
        row.job_type !== kind ||
        row.job_key !== key ||
        row.connector_id !== "openfolk-core" ||
        row.module_id !== moduleId ||
        !states.includes(row.status) ||
        (kind === "interactions.sync" && (row.payload?.source ?? "all") !== source)
      )
        return fail(
          "job_unconfirmed",
          "We could not confirm the saved request. Please retry.",
          503,
        );
      return json(
        {
          version: "learn-processing-request/1",
          success: true,
          accepted: true,
          job_id: job.id,
          job_type: kind,
          source,
          status: row.status,
          already_running: job.duplicate,
          checked_at: new Date().toISOString(),
        },
        202,
      );
    } catch {
      return fail("request_unavailable", "Processing is currently unavailable. Please retry.", 503);
    }
  };
}
