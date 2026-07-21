// ServiceOS — Edge Function: phone-call-detail.
//
// Assembles the full, honest call detail for one call: the LATEST canonical insight (summary +
// structured intent/urgency/action/owner/confidence), resolved participants with honest
// unknown/conflict states, the immutable RAW transcript, the NORMALISED transcript + the exact
// corrections applied (from→to, evidence, confidence, span) so the UI can highlight + explain
// them, source provenance, and the tenant's review state. Plus `mark_reviewed` — the persistent
// user action. Tenant-scoped (owner/admin/ops); service-role assembles it so RLS gaps on the
// transcript/normalisation tables can't hide the intelligence.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { requireTenantUser, assertSameTenant } from "../_shared/authz.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "content-type": "application/json" },
  });
const fail = (code: string, message: string, s: number) =>
  json({ success: false, error: { code, message } }, s);
const sumText = (s: unknown): string =>
  typeof s === "string"
    ? s
    : s && typeof s === "object"
      ? String((s as Record<string, unknown>).text ?? (s as Record<string, unknown>).summary ?? "")
      : "";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);
  const db = createSupabaseAdmin();
  if (!db) return fail("config_error", "Service role not configured", 500);

  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return fail("invalid_json", "Body must be JSON", 400);
  }
  const action = String(body.action ?? "detail");
  const auth = await requireTenantUser(req, db, ["owner", "admin", "ops"] as never);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;
  const actorId = auth.ctx.userId === "service" ? null : auth.ctx.userId;
  const callId = String(body.call_id ?? "");
  if (!callId) return fail("missing_call", "call_id is required", 400);

  // The review state lives in the existing append-only audit_logs (no new table needed):
  // the LATEST call.reviewed / call.review_cleared event for this call wins. Survives refresh.
  async function currentReview(): Promise<{
    reviewed_at: string;
    reviewed_by: string | null;
    note: string | null;
  } | null> {
    const { data } = await db
      .from("audit_logs")
      .select("actor,action,detail,created_at")
      .eq("tenant_id", tenantId)
      .eq("resource_type", "phone_call")
      .eq("resource_id", callId)
      .in("action", ["call.reviewed", "call.review_cleared"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data || data.action !== "call.reviewed") return null;
    return {
      reviewed_at: data.created_at as string,
      reviewed_by: (data.actor as string | null) ?? null,
      note: ((data.detail as Record<string, unknown> | null)?.note as string | null) ?? null,
    };
  }

  // ── mark_reviewed / clear_review (persistent action) ─────────────────────────
  if (action === "mark_reviewed") {
    const note = body.note ? String(body.note).slice(0, 500) : null;
    const { error } = await db.from("audit_logs").insert({
      tenant_id: tenantId,
      actor: actorId ?? "user",
      action: "call.reviewed",
      resource_type: "phone_call",
      resource_id: callId,
      status: "ok",
      detail: note ? { note } : {},
    });
    if (error) return fail("review_failed", "Could not save review", 500);
    return json({ success: true, review: await currentReview() });
  }
  if (action === "clear_review") {
    await db.from("audit_logs").insert({
      tenant_id: tenantId,
      actor: actorId ?? "user",
      action: "call.review_cleared",
      resource_type: "phone_call",
      resource_id: callId,
      status: "ok",
      detail: {},
    });
    return json({ success: true, review: null });
  }

  // ── detail ───────────────────────────────────────────────────────────────────
  // interaction (occurred_at / direction / connector / numbers)
  const { data: it } = await db
    .from("interactions")
    .select(
      "occurred_at,direction,source_connector_id,phone_from,phone_to,processing_status,summary",
    )
    .eq("tenant_id", tenantId)
    .eq("source_table", "phone_calls")
    .eq("source_id", callId)
    .maybeSingle();

  // latest canonical insight for this call
  const { data: insight } = await db
    .from("phone_ai_insights")
    .select(
      "id,recording_id,transcript_id,summary,identity_summary,intent,urgency,sentiment,action_required,suggested_owner,confidence,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("call_id", callId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // raw transcript (latest for the recording)
  let raw: { id: string; transcript_text: string } | null = null;
  if (insight?.recording_id) {
    const { data } = await db
      .from("phone_transcripts")
      .select("id,transcript_text")
      .eq("tenant_id", tenantId)
      .eq("recording_id", insight.recording_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    raw = data as never;
  }

  // normalisation + corrections (by transcript id)
  const transcriptId = insight?.transcript_id ?? raw?.id ?? null;
  let normalisation: { normalised_text: string; corrections: unknown } | null = null;
  if (transcriptId) {
    const { data } = await db
      .from("call_transcript_normalisations")
      .select("normalised_text,corrections")
      .eq("tenant_id", tenantId)
      .eq("transcript_id", transcriptId)
      .maybeSingle();
    normalisation = data as never;
  }

  const review = await currentReview();

  const identity = (insight?.identity_summary ?? {}) as Record<string, unknown>;
  const corrections = Array.isArray(normalisation?.corrections)
    ? (normalisation!.corrections as Array<Record<string, unknown>>)
    : [];

  return json({
    success: true,
    call: {
      call_id: callId,
      occurred_at: it?.occurred_at ?? null,
      direction: (identity.direction as string) ?? it?.direction ?? "unknown",
      connector: it?.source_connector_id ?? "simwood",
      phone_from: it?.phone_from ?? null,
      phone_to: it?.phone_to ?? null,
      processing_status: it?.processing_status ?? null,
    },
    insight: insight
      ? {
          summary: sumText(insight.summary) || sumText(it?.summary),
          intent: insight.intent,
          urgency: insight.urgency,
          sentiment: insight.sentiment,
          action_required: insight.action_required,
          suggested_owner: insight.suggested_owner,
          confidence: insight.confidence,
          updated_at: insight.updated_at,
        }
      : null,
    identity: {
      internal: identity.internal ?? null,
      external: identity.external ?? null,
      direction: identity.direction ?? null,
      direction_confidence: identity.direction_confidence ?? null,
      has_conflict: identity.has_conflict ?? false,
      unresolved: identity.unresolved ?? [],
      identity_confidence: identity.identity_confidence ?? null,
    },
    transcript: {
      raw: raw?.transcript_text ?? null,
      normalised: normalisation?.normalised_text ?? null,
      corrections: corrections.map((c) => ({
        from: c.from,
        to: c.to,
        applied: c.applied,
        confidence: c.confidence,
        category: c.category,
        evidence: c.evidence,
        span: c.span,
      })),
    },
    review: review ?? null,
  });
});
