// Versioned analysis of the exact current transcript. Existing results survive failed attempts.
import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  isUuid,
  jsonResponse,
} from "../_shared/simwood.ts";
import { analyseTranscript, getAnalysisModel, getOpenAiKey } from "../_shared/openai.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import {
  phoneInputDigest,
  reconcilePhoneDerivedVersion,
  runPhoneDerivedVersion,
} from "../_shared/phone-derived-version.ts";
import { normalizeInsight } from "../_shared/phone-insight-normalization.ts";
import { loadCallIntelligenceInput, type LoadedIds } from "../_shared/phone_intelligence/loader.ts";
import {
  computeCallIntelligence,
  buildIntelligencePublication,
  buildSummaryContext,
  type ComputedIntelligence,
  type ComputeInput,
} from "../_shared/phone_intelligence/persist.ts";
import { recordHealthCheck } from "../_shared/system_health.ts";
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return failResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  const transcriptId = body.transcript_id,
    resume = body.resume_run_id,
    force = body.force === true;
  if (!isUuid(transcriptId))
    return failResponse("invalid_transcript_id", "transcript_id must be a UUID", 400);
  if (body.force !== undefined && typeof body.force !== "boolean")
    return failResponse("invalid_force", "force must be a boolean", 400);
  if (resume !== undefined && (!isUuid(resume) || force))
    return failResponse(
      "invalid_resume",
      "resume_run_id must be a UUID and cannot be combined with force",
      400,
    );
  const db = createSupabaseAdmin();
  if (!db) return failResponse("config_error", "Supabase admin client is not configured", 500);
  const auth = await requireTenantUser(
    req,
    db,
    force || resume !== undefined ? ["owner", "admin"] : ["owner", "admin", "ops"],
  );
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId,
    model = getAnalysisModel();
  const transcript = await db
    .from("phone_transcripts")
    .select("id,recording_id")
    .eq("tenant_id", tenantId)
    .eq("id", transcriptId)
    .maybeSingle();
  if (transcript.error || !isUuid(transcript.data?.recording_id))
    return failResponse(
      "transcript_unavailable",
      "Transcript is unavailable for this company",
      404,
    );
  const recordingId = transcript.data!.recording_id as string;
  let runId = resume as string | undefined;
  if (!runId) {
    const run = await db
      .from("phone_sync_runs")
      .insert({
        tenant_id: tenantId,
        provider: "openai",
        sync_type: "ai_analysis",
        status: "running",
        metadata: { recording_id: recordingId, transcript_id: transcriptId, model, force },
      })
      .select("id")
      .single();
    if (run.error || !isUuid(run.data?.id))
      return failResponse("db_error", "Could not open a sync run", 500);
    runId = run.data.id;
  }
  const scope = {
    tenantId,
    recordingId,
    runId: runId!,
    stage: "analysis" as const,
    transcriptId: transcriptId as string,
  };
  let intelligence: { computed: ComputedIntelligence; ids: LoadedIds; input: ComputeInput } | null =
    null;
  const result =
    resume !== undefined
      ? await reconcilePhoneDerivedVersion(db, scope)
      : await runPhoneDerivedVersion({
          db,
          scope,
          request: { model, force, transcriptId },
          prepareInput: async (source) => {
            const apiKey = getOpenAiKey();
            if (!apiKey) return { ok: false, code: "config_error" };
            if (source.transcriptId !== transcriptId || typeof source.text !== "string")
              return { ok: false, code: "input_unavailable" };
            let text = source.text,
              context: string | undefined;
            try {
              const loaded = await loadCallIntelligenceInput(db, {
                tenantId,
                transcriptId: transcriptId as string,
              });
              // Context may enrich only the exact source claimed for this attempt.
              if (loaded && loaded.input.transcriptText === source.text) {
                const computed = computeCallIntelligence(loaded.input);
                intelligence = { computed, ids: loaded.ids, input: loaded.input };
                text = computed.normalisation?.normalised || text;
                context = buildSummaryContext(computed, loaded.input.companyName);
              }
            } catch {
              /* Plain transcript analysis still has complete source provenance. */
            }
            const bytes = new TextEncoder().encode(
              JSON.stringify({ model, text, context: context ?? null }),
            );
            return {
              ok: true,
              request: { sha256: await phoneInputDigest(bytes), bytes: bytes.byteLength },
              invoke: async () => {
                const response = await analyseTranscript({
                  apiKey,
                  model,
                  transcript: text,
                  context,
                });
                if (!response.ok) return { ok: false, code: response.code };
                const normalized = normalizeInsight(response.data);
                if (!normalized.ok) return { ok: false, code: "malformed_response" };
                return {
                  ok: true,
                  output: {
                    ...normalized.value,
                    raw_payload: {
                      ...response.data,
                      transcript_id: transcriptId,
                      model: response.model,
                      analysis_input: { text, context: context ?? null },
                      phone_intelligence: intelligence
                        ? buildIntelligencePublication(
                            intelligence.ids.callId,
                            intelligence.computed,
                            intelligence.input,
                          )
                        : null,
                    },
                  },
                };
              },
            };
          },
        });
  if (!result.ok)
    return failResponse(result.code, result.message, result.httpStatus, {
      sync_run_id: runId,
      transcript_id: transcriptId,
    });
  // Identity publication shares the analysis transaction and retained history.
  const piSaved = result.intelligencePublished;
  await recordHealthCheck(db, {
    tenantId,
    component: "phone_intelligence",
    status: piSaved ? "healthy" : "degraded",
    error: piSaved ? null : "Identity context is unavailable for this recording",
    metadata: { sync_run_id: runId, publication: piSaved ? "confirmed" : "not_computed" },
  });
  try {
    await db.from("audit_logs").insert({
      tenant_id: tenantId,
      actor: "edge:phone-analyse-transcript",
      action: "phone.analyse_transcript",
      resource_type: "phone_ai_insights",
      resource_id: result.resultId,
      status: "success",
      detail: { sync_run_id: runId, cached: result.cached, reconciled: resume !== undefined },
    });
  } catch {
    /* receipt remains authoritative */
  }
  const r = result.result;
  return jsonResponse({
    success: true,
    provider: "openai",
    transcript_id: transcriptId,
    insight_id: result.resultId,
    intent: r.intent,
    urgency: r.urgency,
    sentiment: r.sentiment,
    action_required: r.action_required,
    suggested_owner: r.suggested_owner,
    confidence: r.confidence,
    summary_preview: String(r.summary ?? "").slice(0, 240),
    sync_run_id: runId,
    reconciled: resume !== undefined,
    already_analysed: result.cached,
  });
});
