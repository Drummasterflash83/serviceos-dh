import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { GREETING_TENANT, GREETING_MODEL, validateGreeting, greetingAudioEvidence, GREETING_ASSETS } from "../_shared/receptionist-greeting-verification.ts";
import { getSimwoodCredentials, basicAuthHeader } from "../_shared/simwood.ts";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  let auditId: string | null = null;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    // Validate the actual signed bearer with PostgREST, not decoded JWT claims.
    // care_release_actor is service-role-only and checks active Chris admin + no preview.
    const authorization = req.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return reply({ error: "Authorised maintenance session required" }, 401);
    const reader = req.body?.getReader();
    if (!reader) return reply({ error: "Body required" }, 400);
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.length;
      if (total > 330000) { await reader.cancel(); return reply({ error: "Request too large" }, 413); }
      chunks.push(value);
    }
    const raw = new Uint8Array(total); let offset = 0;
    for (const part of chunks) { raw.set(part, offset); offset += part.length; }
    const body = JSON.parse(new TextDecoder().decode(raw));
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.actorId ?? "")) return reply({ error: "Operator required" }, 403);
    const requestDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
    });
    const gate = await requestDb.rpc("care_release_actor", { p_actor: body.actorId });
    if (gate.error) return reply({ error: "Chris-authorised maintenance session required" }, 403);
    if (body.action === "verify_provider_alan") {
      if (body.tenantId !== GREETING_TENANT || Date.now() >= Date.parse("2026-10-03T00:00:00Z"))
        return reply({ error: "Verification scope/window closed" }, 403);
      const credentials = getSimwoodCredentials();
      if (!credentials) return reply({ error: "Existing provider credential unavailable" }, 503);
      const results = [];
      for (const kind of ["busy", "unavail"] as const) {
        // Exact resource URIs retained in the provider's downloaded metadata.
        // GET only, Alan104 only. No browser sessions, arbitrary URLs or 109 access.
        const response = await fetch(`https://pbx.birchills.net/api/v1/customers/3950/endpoints/9356/voicemail/greetings/${kind}`, {
          method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
          headers: { Authorization: basicAuthHeader(credentials), Accept: "audio/wav" },
        });
        if (!response.ok) return reply({ error: "Provider greeting unavailable", kind, providerStatus: response.status }, 502);
        const stream = response.body?.getReader(); if (!stream) throw new Error("Missing provider audio");
        const parts: Uint8Array[] = []; let size = 0;
        for (;;) {
          const { value, done } = await stream.read(); if (done) break;
          size += value.length;
          if (size > 350000) { await stream.cancel(); throw new Error("Provider audio too large"); }
          parts.push(value);
        }
        const audio = new Uint8Array(size); let pos = 0;
        for (const part of parts) { audio.set(part, pos); pos += part.length; }
        results.push({ kind, providerStatus: response.status, ...await greetingAudioEvidence(audio) });
      }
      const matched = results.every(result => result.pcmMatchesApproved);
      let verificationId: string | null = null;
      if (matched) {
        const verified = await db.from("phone_operations_audit").select("action,after_state").eq("id", GREETING_ASSETS.alan_neutral.auditId).single();
        if (verified.error || verified.data.action !== "greeting_verified" ||
            verified.data.after_state?.sha256 !== GREETING_ASSETS.alan_neutral.sha256 ||
            typeof verified.data.after_state?.transcript !== "string") return reply({ error: "Approved transcript evidence unavailable" }, 503);
        const transcriptSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verified.data.after_state.transcript))), b => b.toString(16).padStart(2,"0")).join("");
        const fixedAuditId = "03a1c104-7ba1-4869-a83d-16c9075a6432";
        const prior = await db.from("phone_operations_audit").select("id,action").eq("id", fixedAuditId).maybeSingle();
        if (prior.error) return reply({ error: "Remediation audit unavailable" }, 503);
        if (prior.data) {
          if (prior.data.action !== "alan_greetings_restored_verified") return reply({ error: "Remediation audit conflict" }, 409);
          return reply({ ok: true, results, verificationId: fixedAuditId, providerWrites: false, liveCallRetested: false, existingAudit: true });
        }
        const audit = await db.from("phone_operations_audit").insert({
          id: fixedAuditId,
          tenant_id: GREETING_TENANT, actor_user_id: body.actorId, actor_label: "OpenFolk launch maintenance",
          action: "alan_greetings_restored_verified", resource_type: "birchills_greeting", resource_ref: "9356",
          before_state: { issue: "Earlier physical call to Alan104 played Rob greeting; original busy backup was also mislabelled Tony" },
          after_state: { verifiedAt: new Date().toISOString(), approvedAudioSha256: GREETING_ASSETS.alan_neutral.sha256,
            busyMatchesApproved: true, unavailableMatchesApproved: true, transcriptSha256,
            results, neutralTranscriptAudit: GREETING_ASSETS.alan_neutral.auditId, liveCallRetested: false, rob109Changed: false },
          reason: "Read-only provider GET confirms both restored Alan104 greeting PCM streams exactly match independently transcribed approved neutral audio. Earlier physical failure retained; a fresh call test is separate.",
        }).select("id").single();
        if (audit.error) return reply({ error: "Provider matches but remediation audit unavailable", results }, 503);
        verificationId = audit.data.id;
      }
      return reply({ ok: matched, results, verificationId, providerWrites: false, liveCallRetested: false }, matched ? 200 : 409);
    }
    const { asset, bytes } = await validateGreeting(body);
    const timed = body.action === "word_timing";
    if (timed && body.asset !== "alan_unavailable") return reply({ error: "Timing source not authorised" }, 400);
    if (body.action && body.action !== "word_timing") return reply({ error: "Action not authorised" }, 400);
    const model = timed ? "whisper-1" : GREETING_MODEL;
    const reservationId = timed ? "483f4c46-0fca-4ea1-84bf-20b507ec38d3" : asset.auditId;
    const key = Deno.env.get("OPENAI_EMMA_REVIEW_KEY");
    if (!key) return reply({ error: "Existing approved review key unavailable" }, 503);
    const prior = await db.from("phone_operations_audit").select("action,after_state").eq("id", reservationId).maybeSingle();
    if (prior.error) return reply({ error: "Private audit unavailable" }, 503);
    if (prior.data) return prior.data.action === "greeting_verified"
      ? reply({ ok: true, cached: true, ...prior.data.after_state })
      : reply({ error: "Verification already attempted; inspect private audit. No retry sent." }, 409);
    const reserve = await db.from("phone_operations_audit").insert({
      id: reservationId, tenant_id: GREETING_TENANT, actor_user_id: body.actorId,
      actor_label: "OpenFolk launch maintenance", action: "greeting_verification_reserved",
      resource_type: "approved_greeting", resource_ref: asset.filename,
      after_state: { sha256: asset.sha256, bytes: asset.bytes, model },
      reason: "Verify preserved original Alan104 greetings or the exact locally spliced neutral derivative before restoration. Existing approved OpenAI processor; no provider writes or caller recordings.",
    });
    if (reserve.error) return reply({ error: "Verification not reserved; no provider request sent" }, 409);
    auditId = reservationId;
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: asset.filename.endsWith(".wav") ? "audio/wav" : "audio/mpeg" }), asset.filename);
    form.append("model", model); form.append("response_format", timed ? "verbose_json" : "json"); form.append("language", "en");
    if (timed) form.append("timestamp_granularities[]", "word");
    // No content/name prompt: the original greeting must identify itself.
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      const state = { sha256: asset.sha256, model, providerStatus: response.status, retrySent: false };
      await db.from("phone_operations_audit").update({ action: "greeting_verification_failed", after_state: state }).eq("id", auditId);
      return reply({ error: "Approved transcription failed; no retry or credential change made", ...state }, 502);
    }
    const data = await response.json();
    if (typeof data.text !== "string" || !data.text.trim() || data.text.length > 4000) throw new Error("Invalid transcription response");
    const words = timed ? (Array.isArray(data.words) ? data.words.slice(0, 200).map((w: Record<string, unknown>) => ({ word: w.word, start: w.start, end: w.end })) : []) : undefined;
    const state = { filename: asset.filename, sha256: asset.sha256, bytes: asset.bytes, model, transcript: data.text.trim(), ...(timed ? { words } : {}) };
    const saved = await db.from("phone_operations_audit").update({ action: "greeting_verified", after_state: state }).eq("id", auditId).eq("action", "greeting_verification_reserved").select("id").single();
    if (saved.error) return reply({ error: "Transcription received but private audit not saved; no retry sent" }, 503);
    return reply({ ok: true, ...state });
  } catch {
    if (auditId) await db.from("phone_operations_audit").update({ action: "greeting_verification_uncertain" }).eq("id", auditId).eq("action", "greeting_verification_reserved");
    return reply({ error: "Greeting verification did not complete. No automatic retry sent." }, 400);
  }
});
