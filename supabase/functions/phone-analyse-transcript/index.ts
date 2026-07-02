// ServiceOS — Edge Function: phone-analyse-transcript (Phase Phone-4B)
//
// Turns a completed transcript (phone_transcripts) into structured operational
// intelligence in phone_ai_insights via OpenAI. The OpenAI key stays
// server-side; the caller only passes tenant + transcript ids.
//
// Scope (Phase-4B): insight extraction ONLY. No task creation, no customer
// matching, no dashboards. Provider isolated in _shared/openai.ts. Runtime: Deno.
//
// Request body:
//   {
//     "tenant_id": "uuid",         // required
//     "transcript_id": "uuid",     // required — phone_transcripts.id
//     "force": boolean?            // optional — re-analyse even if an insight exists
//   }
//
// NOTE: phone_ai_insights has no transcript_id column — insights link via
// recording_id (derived from the transcript). transcript_id and all extra
// extracted fields are stored in raw_payload.

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  isUuid,
  jsonResponse,
} from "../_shared/simwood.ts";
import { analyseTranscript, getAnalysisModel, getOpenAiKey } from "../_shared/openai.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";

const PROVIDER = "openai";
const PREVIEW_CHARS = 240;

const URGENCY = ["low", "medium", "high", "emergency"];
const SENTIMENT = ["negative", "neutral", "positive", "mixed"];
const OWNER = ["office", "accounts", "engineer", "manager", "unknown"];

const URGENCY_ALIASES: Record<string, string> = {
  urgent: "high",
  critical: "emergency",
  severe: "high",
};
const SENTIMENT_ALIASES: Record<string, string> = {
  bad: "negative",
  good: "positive",
  angry: "negative",
  happy: "positive",
};
const OWNER_ALIASES: Record<string, string> = {
  billing: "accounts",
  admin: "office",
  ops: "office",
  technician: "engineer",
  director: "manager",
};

interface NormalizedInsight {
  intent: string;
  urgency: string;
  sentiment: string;
  summary: string;
  action_required: boolean;
  suggested_owner: string;
  confidence: number;
}

function lower(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** urgency: allowed set → alias map → default "medium". */
function normUrgency(v: unknown): string {
  const s = lower(v);
  if (URGENCY.includes(s)) return s;
  return URGENCY_ALIASES[s] ?? "medium";
}

/** sentiment: allowed set → alias map → default "neutral". */
function normSentiment(v: unknown): string {
  const s = lower(v);
  if (SENTIMENT.includes(s)) return s;
  return SENTIMENT_ALIASES[s] ?? "neutral";
}

/** suggested_owner: allowed set → alias map → default "unknown". */
function normOwner(v: unknown): string {
  const s = lower(v);
  if (OWNER.includes(s)) return s;
  return OWNER_ALIASES[s] ?? "unknown";
}

/** action_required: boolean / "true"/"false" / 1/0 / "yes"/"no" → default false. */
function normActionRequired(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
  }
  return false;
}

/** confidence: numeric/string-numeric, percentages (85 → 0.85), clamp 0..1, default 0.5. */
function normConfidence(v: unknown): number {
  let n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  if (n > 1) n = n / 100;
  return Math.max(0, Math.min(1, n));
}

/** intent: trim → lowercase → spaces to underscores → max 64 → fallback "unknown". */
function normIntent(v: unknown): string {
  if (typeof v !== "string") return "unknown";
  const s = v.trim().toLowerCase().replace(/\s+/g, "_");
  return s === "" ? "unknown" : s.slice(0, 64);
}

/** summary: string, trim, max 1000, fallback "AI analysis unavailable". */
function normSummary(v: unknown): string {
  if (typeof v !== "string") return "AI analysis unavailable";
  const s = v.trim();
  return s === "" ? "AI analysis unavailable" : s.slice(0, 1000);
}

/**
 * Strictly validate/normalise the raw AI object before any DB write. Returns
 * { ok: false } when the object lacks the expected structure — the caller then
 * emits `malformed_response`.
 */
function normalizeInsight(raw: unknown): { ok: true; value: NormalizedInsight } | { ok: false } {
  if (!raw || typeof raw !== "object") return { ok: false };
  const obj = raw as Record<string, unknown>;
  const expected = [
    "intent",
    "urgency",
    "sentiment",
    "summary",
    "action_required",
    "suggested_owner",
    "confidence",
  ];
  if (!expected.some((k) => k in obj)) return { ok: false };
  return {
    ok: true,
    value: {
      intent: normIntent(obj.intent),
      urgency: normUrgency(obj.urgency),
      sentiment: normSentiment(obj.sentiment),
      summary: normSummary(obj.summary),
      action_required: normActionRequired(obj.action_required),
      suggested_owner: normOwner(obj.suggested_owner),
      confidence: normConfidence(obj.confidence),
    },
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  // --- input validation ----------------------------------------------------
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return failResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  const body = (parsed ?? {}) as Record<string, unknown>;

  const transcriptId = body.transcript_id;
  if (!isUuid(transcriptId)) {
    return failResponse(
      "invalid_transcript_id",
      "transcript_id is required and must be a UUID",
      400,
    );
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return failResponse("invalid_force", "force must be a boolean", 400);
  }
  const force = body.force === true;

  // --- DB client -----------------------------------------------------------
  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }

  // --- authz: bind tenant server-side (force ⇒ owner/admin only) -----------
  const auth = await requireTenantUser(
    req,
    supabase,
    force ? ["owner", "admin"] : ["owner", "admin", "ops"],
  );
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  const model = getAnalysisModel();
  const baseMetadata: Record<string, unknown> = { transcript_id: transcriptId, force, model };

  const { data: runRow, error: runErr } = await supabase
    .from("phone_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "ai_analysis",
      status: "running",
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (runErr || !runRow) {
    return failResponse("db_error", "Could not open a sync run", 500);
  }
  const syncRunId = runRow.id as string;

  // Finalisers -------------------------------------------------------------
  async function writeAudit(
    status: "success" | "failed",
    detail: Record<string, unknown>,
  ): Promise<void> {
    try {
      await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: "edge:phone-analyse-transcript",
        action: "phone.analyse_transcript",
        resource_type: "phone_ai_insights",
        resource_id: transcriptId as string,
        status,
        detail,
      });
    } catch (_e) {
      // never mask the real result
    }
  }

  async function finish(
    status: "success" | "failed",
    recordsProcessed: number,
    metaExtra: Record<string, unknown>,
    errorMessage: string | null,
  ): Promise<void> {
    const metadata = { ...baseMetadata, ...metaExtra };
    try {
      await supabase
        .from("phone_sync_runs")
        .update({
          status,
          completed_at: new Date().toISOString(),
          records_processed: recordsProcessed,
          error_message: errorMessage,
          metadata,
        })
        .eq("id", syncRunId);
    } catch (_e) {
      // ignore
    }
    await writeAudit(status, { ...metadata, ...(errorMessage ? { message: errorMessage } : {}) });
  }

  async function finishFailed(
    code: string,
    message: string,
    httpStatus: number,
    metaExtra: Record<string, unknown> = {},
  ): Promise<Response> {
    await finish("failed", 0, { ...metaExtra, error_code: code }, message);
    return failResponse(code, message, httpStatus, {
      sync_run_id: syncRunId,
      transcript_id: transcriptId,
    });
  }

  // --- OpenAI key ----------------------------------------------------------
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    return await finishFailed("config_error", "OPENAI_API_KEY is not configured", 500);
  }

  // --- load the transcript -------------------------------------------------
  const { data: transcript, error: tErr } = await supabase
    .from("phone_transcripts")
    .select("id, recording_id, transcript_text, status")
    .eq("id", transcriptId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (tErr) {
    return await finishFailed("db_error", "Failed to load transcript", 500);
  }
  if (!transcript) {
    return await finishFailed("not_found", "Transcript not found for this tenant", 404);
  }
  const text = transcript.transcript_text as string | null;
  if (!text || text.trim() === "") {
    return await finishFailed("empty_transcript", "Transcript has no text to analyse", 422);
  }
  const recordingId = (transcript.recording_id as string | null) ?? null;

  // --- idempotency: existing insight for this recording --------------------
  let existing: {
    id: string;
    intent: string | null;
    urgency: string | null;
    sentiment: string | null;
    summary: string | null;
    action_required: boolean | null;
    suggested_owner: string | null;
    confidence: number | null;
  } | null = null;
  if (recordingId) {
    const { data } = await supabase
      .from("phone_ai_insights")
      .select(
        "id, intent, urgency, sentiment, summary, action_required, suggested_owner, confidence",
      )
      .eq("tenant_id", tenantId)
      .eq("recording_id", recordingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existing = data ?? null;
  }

  if (existing && !force) {
    await finish("success", 0, { insight_id: existing.id, already_analysed: true }, null);
    return jsonResponse({
      success: true,
      provider: PROVIDER,
      transcript_id: transcriptId,
      insight_id: existing.id,
      intent: existing.intent,
      urgency: existing.urgency,
      sentiment: existing.sentiment,
      action_required: existing.action_required ?? false,
      suggested_owner: existing.suggested_owner,
      confidence: existing.confidence,
      summary_preview: (existing.summary ?? "").slice(0, PREVIEW_CHARS),
      sync_run_id: syncRunId,
    });
  }

  // --- analyse (server-side, provider-isolated) ----------------------------
  const result = await analyseTranscript({ apiKey, model, transcript: text });
  if (!result.ok) {
    return await finishFailed(result.code, result.message, result.httpStatus);
  }

  const ai = result.data;
  // Strictly validate/normalise before any DB write.
  const normalized = normalizeInsight(ai);
  if (!normalized.ok) {
    return await finishFailed(
      "malformed_response",
      "AI analysis did not match the expected schema",
      502,
    );
  }
  const n = normalized.value;
  const insight = {
    tenant_id: tenantId,
    recording_id: recordingId,
    call_id: null,
    intent: n.intent,
    urgency: n.urgency,
    sentiment: n.sentiment,
    summary: n.summary,
    action_required: n.action_required,
    suggested_owner: n.suggested_owner,
    confidence: n.confidence,
    // Store the full (raw) model output (incl. customer_name, phone_number,
    // address, appliance, fault, promised_action, risk_flags) plus provenance.
    raw_payload: { ...ai, transcript_id: transcriptId, model: result.model },
  };

  // --- upsert the insight row (one per recording) --------------------------
  let insightId: string;
  if (existing) {
    insightId = existing.id;
    const { error: updErr } = await supabase
      .from("phone_ai_insights")
      .update({
        intent: insight.intent,
        urgency: insight.urgency,
        sentiment: insight.sentiment,
        summary: insight.summary,
        action_required: insight.action_required,
        suggested_owner: insight.suggested_owner,
        confidence: insight.confidence,
        raw_payload: insight.raw_payload,
      })
      .eq("id", insightId);
    if (updErr) {
      return await finishFailed("db_error", `Failed to update insight: ${updErr.message}`, 500);
    }
  } else {
    const { data: created, error: insErr } = await supabase
      .from("phone_ai_insights")
      .insert(insight)
      .select("id")
      .single();
    if (insErr || !created) {
      return await finishFailed("db_error", "Failed to store insight", 500);
    }
    insightId = created.id as string;
  }

  await finish(
    "success",
    1,
    {
      insight_id: insightId,
      intent: insight.intent,
      urgency: insight.urgency,
      action_required: insight.action_required,
    },
    null,
  );

  return jsonResponse({
    success: true,
    provider: PROVIDER,
    transcript_id: transcriptId,
    insight_id: insightId,
    intent: insight.intent,
    urgency: insight.urgency,
    sentiment: insight.sentiment,
    action_required: insight.action_required,
    suggested_owner: insight.suggested_owner,
    confidence: insight.confidence,
    summary_preview: (insight.summary ?? "").slice(0, PREVIEW_CHARS),
    sync_run_id: syncRunId,
  });
});
