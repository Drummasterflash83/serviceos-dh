// Retained call details. Exact transcript linkage is not proof of current audio provenance.

import { createSupabaseAdmin, isUuid } from "../_shared/simwood.ts";
import { requireTenantUser, assertSameTenant } from "../_shared/authz.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "content-type": "application/json", "Cache-Control": "no-store" },
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
  try {
    const db = createSupabaseAdmin();
    if (!db) return fail("config_error", "Service role not configured", 500);

    // This endpoint records human review; infrastructure credentials cannot impersonate it.
    if (req.headers.has("x-internal-tenant-id") || req.headers.has("x-serviceos-internal-key"))
      return fail("forbidden", "A signed-in user is required", 403);
    const auth = await requireTenantUser(req, db, ["owner", "admin", "ops"]);
    if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
    if (auth.ctx.userId === "service")
      return fail("forbidden", "A signed-in user is required", 403);

    let body: Record<string, unknown>;
    try {
      // Enforce the actual byte count, including requests without Content-Length.
      const reader = req.body?.getReader();
      if (!reader) throw new Error("Missing body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 4096) throw new Error("Request too large");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((k) => !["action", "call_id", "tenant_id", "note"].includes(k))
      )
        throw new Error("Invalid body");
    } catch {
      return fail("invalid_request", "Invalid call request", 400);
    }
    const action = body.action ?? "detail";
    if (
      !["detail", "mark_reviewed", "clear_review"].includes(action as string) ||
      (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 500))
    )
      return fail("invalid_request", "Invalid call request", 400);
    const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
    if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
    const tenantId = auth.ctx.tenantId;
    const actorId = auth.ctx.userId;
    const callId = body.call_id;
    if (!isUuid(callId)) return fail("invalid_call", "A valid call_id is required", 400);
    const { data: call, error: callError } = await db
      .from("phone_calls")
      .select("id,provider,started_at,direction,from_number,to_number")
      .eq("tenant_id", tenantId)
      .eq("id", callId)
      .maybeSingle();
    if (callError) throw new Error("Call read failed");
    if (!call) return fail("call_unavailable", "Call unavailable with your current access", 404);

    // The review state lives in the existing append-only audit_logs (no new table needed):
    // the LATEST call.reviewed / call.review_cleared event for this call wins. Survives refresh.
    async function currentReview(): Promise<{
      reviewed_at: string;
      reviewed_by: string | null;
      note: string | null;
    } | null> {
      const { data, error } = await db
        .from("audit_logs")
        .select("actor,action,detail,created_at")
        .eq("tenant_id", tenantId)
        .eq("resource_type", "phone_call")
        .eq("resource_id", callId)
        .in("action", ["call.reviewed", "call.review_cleared"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("Review read failed");
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
      const { error } = await db.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: actorId ?? "user",
        action: "call.review_cleared",
        resource_type: "phone_call",
        resource_id: callId,
        status: "ok",
        detail: {},
      });
      if (error) return fail("review_failed", "Could not clear review", 500);
      return json({ success: true, review: null });
    }

    // ── detail ───────────────────────────────────────────────────────────────────
    // interaction (occurred_at / direction / connector / numbers)
    const { data: it, error: interactionError } = await db
      .from("interactions")
      .select("occurred_at,direction,source_connector_id,phone_from,phone_to,processing_status")
      .eq("tenant_id", tenantId)
      .eq("source_table", "phone_calls")
      .eq("source_id", callId)
      .maybeSingle();

    if (interactionError) throw new Error("Interaction read failed");

    // latest retained insight for this call
    const { data: insight, error: insightError } = await db
      .from("phone_ai_insights")
      .select(
        "id,recording_id,transcript_id,summary,identity_summary,intent,urgency,sentiment,action_required,suggested_owner,confidence,created_at,updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("call_id", callId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (insightError) throw new Error("Insight read failed");

    // Never substitute the recording's latest transcript for the insight's source.
    // A missing legacy source remains missing, even if a newer transcript exists.
    let raw: { id: string; transcript_text: string } | null = null;
    if (insight?.recording_id && insight?.transcript_id) {
      const { data, error } = await db
        .from("phone_transcripts")
        .select("id,transcript_text")
        .eq("tenant_id", tenantId)
        .eq("recording_id", insight.recording_id)
        .eq("id", insight.transcript_id)
        .maybeSingle();
      if (error) throw new Error("Transcript read failed");
      raw = data;
    }

    let normalisation: { normalised_text: string; corrections: unknown } | null = null;
    if (raw) {
      const { data, error } = await db
        .from("call_transcript_normalisations")
        .select("normalised_text,corrections")
        .eq("tenant_id", tenantId)
        .eq("transcript_id", raw.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("Normalisation read failed");
      normalisation = data;
    }

    const review = await currentReview();

    const identity = (insight?.identity_summary ?? {}) as Record<string, unknown>;
    const corrections = Array.isArray(normalisation?.corrections)
      ? (normalisation!.corrections as Array<Record<string, unknown>>)
      : [];

    return json({
      success: true,
      version: "phone-call-detail/2",
      tenant_id: tenantId,
      provenance: { freshness: "unverified", transcript_id: raw?.id ?? null },
      call: {
        call_id: callId,
        occurred_at: call.started_at ?? it?.occurred_at ?? null,
        direction: call.direction ?? it?.direction ?? "unknown",
        connector: call.provider ?? it?.source_connector_id ?? "unknown",
        phone_from: call.from_number ?? it?.phone_from ?? null,
        phone_to: call.to_number ?? it?.phone_to ?? null,
        processing_status: it?.processing_status ?? null,
      },
      insight: insight
        ? {
            summary: sumText(insight.summary),
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
  } catch {
    return fail("call_detail_unavailable", "Call details could not be checked. Try again.", 503);
  }
});
