// ServiceOS — Edge Function: email-connector-status (Email Reliability v2)
//
// THE single source of truth for email connector health. The Operations Centre
// renders the business SUMMARY; Admin › Email renders the full DIAGNOSTICS — both
// read THIS one endpoint, so there is no duplicated/ conflicting health logic in
// the frontend (§11/§12). Read-only, service-role (reads RLS-protected email_*
// tables). Runtime: Deno.
//
// Evidence is gathered DB-side by email_connector_health(); the explicit state
// enum is derived by the pure, unit-tested _shared/email_health.ts. "Failure"
// always means CURRENT (a later success resolves it), never all-time history.
//
// Request body: { tenant_id: uuid, detail?: boolean }
//   detail=true also returns `diagnostics` (per account/mailbox rows).

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import { deriveEmailHealth, type EmailHealthEvidence } from "../_shared/email_health.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return failResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  const body = (parsed ?? {}) as Record<string, unknown>;
  const wantDetail = body.detail === true;

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }

  // authz: bind tenant server-side (diagnostics ⇒ owner/admin/ops).
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  const { data: evidence, error } = await supabase.rpc("email_connector_health", {
    p_tenant_id: tenantId,
  });
  if (error) {
    return failResponse("db_error", `Could not read email health: ${error.message}`, 500);
  }

  const health = deriveEmailHealth(evidence as EmailHealthEvidence, Date.now());

  // CURRENT vs historical dead-letters (§12): a dead-letter is only CURRENT if no
  // later succeeded job exists for the same job_key (i.e. that mailbox unit hasn't
  // recovered). Dead-letters created before the email worker handler was deployed
  // are superseded by later successes → historical, not a current warning.
  const [{ data: dls }, { data: succ }] = await Promise.all([
    supabase
      .from("platform_jobs")
      .select("job_key, dead_lettered_at, failed_at, updated_at")
      .eq("tenant_id", tenantId)
      .like("job_type", "email.%")
      .eq("status", "dead_letter"),
    supabase
      .from("platform_jobs")
      .select("job_key, completed_at")
      .eq("tenant_id", tenantId)
      .like("job_type", "email.%")
      .eq("status", "succeeded"),
  ]);
  const latestSuccessByKey = new Map<string, number>();
  for (const s of (succ ?? []) as Record<string, unknown>[]) {
    const k = s.job_key as string | null;
    const t = Date.parse((s.completed_at as string | null) ?? "");
    if (k && !Number.isNaN(t))
      latestSuccessByKey.set(k, Math.max(latestSuccessByKey.get(k) ?? 0, t));
  }
  let currentDeadLetter = 0;
  let historicalDeadLetter = 0;
  for (const d of (dls ?? []) as Record<string, unknown>[]) {
    const k = d.job_key as string | null;
    const atStr =
      (d.dead_lettered_at as string | null) ??
      (d.failed_at as string | null) ??
      (d.updated_at as string | null) ??
      "";
    const at = Date.parse(atStr);
    const resolved = k !== null && (latestSuccessByKey.get(k) ?? 0) > (Number.isNaN(at) ? 0 : at);
    if (resolved) historicalDeadLetter += 1;
    else currentDeadLetter += 1;
  }
  const pipeline = {
    ...health.pipeline,
    dead_letter_count: currentDeadLetter, // now CURRENT only (was all-time)
    historical_dead_letter_count: historicalDeadLetter,
    expected_cadence_seconds: 300,
  };

  let diagnostics: unknown[] | undefined;
  if (wantDetail) {
    const { data: diag } = await supabase.rpc("email_connector_diagnostics", {
      p_tenant_id: tenantId,
      p_limit: 200,
    });
    diagnostics = (diag ?? []) as unknown[];
  }

  return jsonResponse({
    success: true,
    gmail: { ...health.gmail, evidence: (evidence as EmailHealthEvidence).gmail },
    workspace: { ...health.workspace, evidence: (evidence as EmailHealthEvidence).workspace },
    pipeline,
    ...(diagnostics ? { diagnostics } : {}),
  });
});
