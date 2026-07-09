// ServiceOS — Edge Function: interactions-sync (Canonical Interactions v1)
//
// Projects existing source rows (phone_calls, email_messages) into the shared
// `interactions` timeline. It is a BACKFILL/refresh: idempotent upserts keyed on
// (tenant_id, source_table, source_id), never deleting or mutating source data.
//
// Auth: a real user session (owner/admin/ops), tenant-bound via _shared/authz —
// the client NEVER supplies a trusted tenant id. All reads/writes are explicitly
// scoped to the caller's tenant (service-role client bypasses RLS).
//
// Emits a platform_jobs row (connector_id 'openfolk-core') so the run is visible
// in the Operations Centre. No secrets are read or logged here.
//
// Runtime: Supabase Edge Functions (Deno). No new dependencies.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ success: false, error: { code, message } }, status);
}

function clampLimit(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 500;
  return Math.max(1, Math.min(2000, n));
}

/** Coerce a jsonb array into a clean string[] (drops non-string entries). */
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

type Admin = SupabaseClient;

interface InteractionRow {
  tenant_id: string;
  source_connector_id: string;
  source_type: string;
  source_table: string;
  source_id: string;
  source_external_id: string | null;
  interaction_type: string;
  direction: string;
  occurred_at: string;
  subject: string | null;
  summary: string | null;
  body_preview: string | null;
  from_address?: string | null;
  from_name?: string | null;
  to_addresses?: string[];
  cc_addresses?: string[];
  phone_from?: string | null;
  phone_to?: string | null;
  sentiment: string | null;
  related_thread_id: string | null;
  processing_status: string;
  metadata: Record<string, unknown>;
}

async function upsertInteractions(admin: Admin, rows: InteractionRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin
    .from("interactions")
    .upsert(rows, { onConflict: "tenant_id,source_table,source_id" });
  if (error) throw new Error(`interactions upsert failed: ${error.message}`);
}

async function syncPhone(
  admin: Admin,
  tenantId: string,
  limit: number,
  since: string | null,
): Promise<number> {
  let q = admin
    .from("phone_calls")
    .select(
      "id, provider_call_id, direction, from_number, to_number, started_at, duration_seconds, outcome, linked_id, created_at",
    )
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (since) q = q.gte("started_at", since);
  const { data: calls, error } = await q;
  if (error) throw new Error(`phone_calls read failed: ${error.message}`);
  const rows = (calls ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return 0;

  // Best-effort AI summary/sentiment (already-computed insights only; no AI here).
  const ids = rows.map((c) => c.id as string);
  const insights = new Map<string, { summary: string | null; sentiment: string | null }>();
  const { data: ins } = await admin
    .from("phone_ai_insights")
    .select("call_id, summary, sentiment")
    .eq("tenant_id", tenantId)
    .in("call_id", ids);
  for (const i of (ins ?? []) as Record<string, unknown>[]) {
    const cid = i.call_id as string | null;
    if (cid && !insights.has(cid)) {
      insights.set(cid, {
        summary: (i.summary as string | null) ?? null,
        sentiment: (i.sentiment as string | null) ?? null,
      });
    }
  }

  const interactions: InteractionRow[] = rows.map((c) => {
    const rawDir = c.direction as string | null;
    const direction = rawDir === "IN" ? "inbound" : rawDir === "OUT" ? "outbound" : "unknown";
    const insight = insights.get(c.id as string) ?? null;
    const duration = (c.duration_seconds as number | null) ?? null;
    const outcome = (c.outcome as string | null) ?? null;
    const fallback = `${direction} call${duration != null ? ` · ${duration}s` : ""}${
      outcome ? ` · ${outcome}` : ""
    }`;
    return {
      tenant_id: tenantId,
      source_connector_id: "simwood",
      source_type: "phone",
      source_table: "phone_calls",
      source_id: c.id as string,
      source_external_id: (c.provider_call_id as string | null) ?? null,
      interaction_type: "phone_call",
      direction,
      occurred_at: (c.started_at as string | null) ?? (c.created_at as string),
      subject: null,
      summary: insight?.summary ?? null,
      body_preview: insight?.summary ?? fallback,
      phone_from: (c.from_number as string | null) ?? null,
      phone_to: (c.to_number as string | null) ?? null,
      sentiment: insight?.sentiment ?? null,
      related_thread_id: (c.linked_id as string | null) ?? null,
      // A call WITH an AI insight is fully processed at source → READY for
      // enrichment subscribers; without one it is still 'pending'. (Matches the
      // pipeline's finaliser so the backfill and live paths are interchangeable.)
      processing_status: insight ? "ready" : "pending",
      metadata: {
        duration_seconds: duration,
        outcome,
        has_ai_insight: Boolean(insight),
      },
    };
  });

  await upsertInteractions(admin, interactions);
  return interactions.length;
}

async function syncEmail(
  admin: Admin,
  tenantId: string,
  limit: number,
  since: string | null,
): Promise<number> {
  // Detect the owning connector by matching message addresses to the tenant's DWD
  // mailboxes / OAuth accounts (loaded once). Falls back to a generic 'email'.
  const dwd = new Set<string>();
  const oauth = new Set<string>();
  const { data: mbx } = await admin
    .from("google_workspace_mailboxes")
    .select("email_address")
    .eq("tenant_id", tenantId);
  for (const m of (mbx ?? []) as Record<string, unknown>[]) {
    const a = (m.email_address as string | null)?.toLowerCase();
    if (a) dwd.add(a);
  }
  const { data: accts } = await admin
    .from("email_accounts")
    .select("email_address, status")
    .eq("tenant_id", tenantId)
    .eq("provider", "gmail");
  for (const a of (accts ?? []) as Record<string, unknown>[]) {
    const addr = (a.email_address as string | null)?.toLowerCase();
    if (addr && a.status === "active") oauth.add(addr);
  }

  let q = admin
    .from("email_messages")
    .select(
      "id, provider_message_id, provider_thread_id, from_email, from_name, to_emails, cc_emails, subject, snippet, sent_at, received_at, direction, created_at",
    )
    .eq("tenant_id", tenantId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (since) q = q.gte("received_at", since);
  const { data: msgs, error } = await q;
  if (error) throw new Error(`email_messages read failed: ${error.message}`);
  const rows = (msgs ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return 0;

  const interactions: InteractionRow[] = rows.map((m) => {
    const to = toStringArray(m.to_emails);
    const cc = toStringArray(m.cc_emails);
    const addrs = [m.from_email as string | null, ...to, ...cc]
      .filter((x): x is string => Boolean(x))
      .map((x) => x.toLowerCase());
    let connector = "email";
    if (addrs.some((a) => dwd.has(a))) connector = "google-workspace";
    else if (addrs.some((a) => oauth.has(a))) connector = "gmail";
    const rawDir = m.direction as string | null;
    const direction = rawDir === "inbound" || rawDir === "outbound" ? rawDir : "unknown";
    return {
      tenant_id: tenantId,
      source_connector_id: connector,
      source_type: "email",
      source_table: "email_messages",
      source_id: m.id as string,
      source_external_id: (m.provider_message_id as string | null) ?? null,
      interaction_type: "email_message",
      direction,
      occurred_at:
        (m.received_at as string | null) ??
        (m.sent_at as string | null) ??
        (m.created_at as string),
      subject: (m.subject as string | null) ?? null,
      summary: null,
      body_preview: (m.snippet as string | null) ?? null,
      from_address: (m.from_email as string | null) ?? null,
      from_name: (m.from_name as string | null) ?? null,
      to_addresses: to,
      cc_addresses: cc,
      sentiment: null,
      related_thread_id: (m.provider_thread_id as string | null) ?? null,
      processing_status: "pending",
      metadata: { provider_thread_id: (m.provider_thread_id as string | null) ?? null, connector },
    };
  });

  await upsertInteractions(admin, interactions);
  return interactions.length;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  // Tenant-bound authz — owner/admin/ops only; tenant comes from the profile.
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  let body: { source?: string; limit?: number; since?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const source = body.source === "phone" || body.source === "email" ? body.source : "all";
  const limit = clampLimit(body.limit);
  const since = typeof body.since === "string" && body.since.trim() !== "" ? body.since : null;

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.interactions",
    jobType: "interactions.sync",
    jobKey: `interactions.sync:${tenantId}:${source}`,
    payload: { source, limit, since },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  try {
    let phoneProcessed = 0;
    let emailProcessed = 0;
    if (source === "phone" || source === "all") {
      phoneProcessed = await syncPhone(admin, tenantId, limit, since);
    }
    if (source === "email" || source === "all") {
      emailProcessed = await syncEmail(admin, tenantId, limit, since);
    }
    const upserted = phoneProcessed + emailProcessed;

    if (jobId) {
      await completePlatformJob(admin, jobId, {
        recordsProcessed: upserted,
        result: { phone_processed: phoneProcessed, email_processed: emailProcessed },
      });
    }

    return json({
      success: true,
      phone_processed: phoneProcessed,
      email_processed: emailProcessed,
      interactions_upserted: upserted,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "interactions sync failed";
    if (jobId) await failPlatformJob(admin, jobId, message);
    return fail("sync_error", message, 500);
  }
});
