import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertSameTenant, requireTenantUser } from "./authz.ts";

export type EmailCaptureJobType =
  "email.gmail_sync" | "email.workspace_sync" | "email.workspace_backfill";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const emailEnqueueCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...emailEnqueueCors, "Content-Type": "application/json" },
  });
export const emailEnqueueFailure = (code: string, message: string, status: number) =>
  json({ success: false, error: { code, message } }, status);
const unknown = () =>
  emailEnqueueFailure(
    "queue_unconfirmed",
    "The queue response could not be confirmed. Check email jobs before submitting again.",
    503,
  );

/** Authenticated queue submission only: never resolves credentials or mutates progress. */
export async function handleEmailEnqueue(
  req: Request,
  db: SupabaseClient,
  type: EmailCaptureJobType,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailEnqueueCors });
  if (req.method !== "POST") return emailEnqueueFailure("method_not_allowed", "Use POST", 405);
  const auth = await requireTenantUser(req, db, ["owner", "admin", "ops"]);
  if (!auth.ok)
    return emailEnqueueFailure(auth.error.code, auth.error.message, auth.error.httpStatus);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 4000) throw Error();
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    body = value;
  } catch {
    return emailEnqueueFailure("invalid_request", "Provide a valid mailbox sync request.", 400);
  }
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return emailEnqueueFailure(mismatch.code, mismatch.message, mismatch.httpStatus);
  const historical = type === "email.workspace_backfill";
  const allowed = [
    "tenant_id",
    "email_account_id",
    "max_results",
    historical ? "restart" : "force",
  ];
  if (
    !uuid.test(auth.ctx.tenantId) ||
    typeof body.email_account_id !== "string" ||
    !uuid.test(body.email_account_id.trim()) ||
    Object.keys(body).some((k) => !allowed.includes(k)) ||
    (body.max_results !== undefined &&
      (!Number.isInteger(body.max_results) ||
        Number(body.max_results) < 1 ||
        Number(body.max_results) > 500)) ||
    (body.force !== undefined && typeof body.force !== "boolean") ||
    (body.restart !== undefined && typeof body.restart !== "boolean")
  )
    return emailEnqueueFailure(
      "invalid_request",
      "Choose a mailbox and a page size between 1 and 500.",
      400,
    );
  const account = body.email_account_id.trim().toLowerCase();
  const options = Object.fromEntries(
    Object.entries(body).filter(([k]) => ["max_results", "force", "restart"].includes(k)),
  );
  try {
    const { data, error } = await db.rpc("learn_email_enqueue", {
      p_tenant: auth.ctx.tenantId,
      p_account: account,
      p_type: type,
      p_options: options,
    });
    if (error) {
      const errors: Record<string, [string, string, number]> = {
        learn_capture_paused: [
          "learn_capture_paused",
          "Email capture is paused in OpenFolk controls.",
          409,
        ],
        learn_email_explicit_recovery_required: [
          "explicit_recovery_required",
          "Restart requires an operator recovery review. Saved progress has been preserved.",
          409,
        ],
        learn_email_source_ineligible: [
          "source_ineligible",
          "This mailbox is not available for the selected sync method.",
          409,
        ],
        learn_email_active_request_conflict: [
          "active_request_conflict",
          "This mailbox already has queued or running work with different options. Check that job before submitting another request.",
          409,
        ],
        learn_email_enqueue_busy: [
          "queue_busy",
          "Mailbox work is changing. Check email jobs before submitting again.",
          409,
        ],
        learn_email_enqueue_invalid: [
          "invalid_request",
          "The mailbox sync options are invalid.",
          400,
        ],
      };
      const known = errors[error.message];
      return known ? emailEnqueueFailure(...known) : unknown();
    }
    if (
      !data ||
      data.version !== "learn-email-enqueue/1" ||
      data.success !== true ||
      data.state !== "queued" ||
      data.provider !== "gmail" ||
      data.email_account_id !== account ||
      typeof data.job_id !== "string" ||
      !uuid.test(data.job_id) ||
      typeof data.duplicate !== "boolean"
    )
      return unknown();
    return json(
      {
        version: data.version,
        success: true,
        state: "queued",
        provider: "gmail",
        email_account_id: account,
        job_id: data.job_id,
        duplicate: data.duplicate,
      },
      202,
    );
  } catch {
    return unknown();
  }
}
