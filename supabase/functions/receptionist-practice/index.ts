import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { record, normalizeCall, secureUrl } from "../_shared/receptionist-data.ts";
import {
  webCallToken,
  definitiveWebCallRejection,
  practiceCallMatches,
  practiceReservationFailure,
  reconcilePracticeSessions,
} from "../_shared/receptionist-web-call.ts";
import {
  practiceAssistant,
  assistantOverview,
  allowedQueryTools,
  practiceRoom,
} from "../_shared/receptionist-practice.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
class ProviderReadError extends Error {}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return reply({ error: "Sign in to continue" }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return reply({ error: "Sign in to continue" }, 401);
    const body = record(await req.json());
    if (!uuid(body.tenantId)) return reply({ error: "Invalid workspace" }, 400);
    const { data: w, error: scopeError } = await db
      .from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name,practice_enabled")
      .eq("tenant_id", body.tenantId)
      .maybeSingle();
    if (scopeError || !w) return reply({ error: "Workspace unavailable" }, 403);
    const key = Deno.env.get(w.vapi_secret_name);
    if (!key) return reply({ error: "The voice connection needs OpenFolk attention" }, 503);
    const provider = async (path: string, payload?: unknown) => {
      const r = await fetch("https://api.vapi.ai/" + path, {
        method: payload ? "POST" : "GET",
        redirect: "error",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        if (!payload && (path.startsWith("assistant/") || path.startsWith("tool/")))
          throw new ProviderReadError(
            `Emma’s ${path.startsWith("assistant/") ? "assistant configuration" : "knowledge tool configuration"} could not be read from Vapi (HTTP ${r.status}). OpenFolk needs to check the connection.`,
          );
        throw Error("Provider unavailable");
      }
      return record(await r.json());
    };
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    if (body.action === "result" || body.action === "end" || body.action === "recording") {
      if (!uuid(body.sessionId)) return reply({ error: "Invalid practice reference" }, 400);
      const { data: s, error } = await db
        .from("receptionist_practice_sessions")
        .select("*")
        .eq("id", body.sessionId)
        .eq("tenant_id", body.tenantId)
        .maybeSingle();
      if (error || !s) return reply({ error: "Practice conversation unavailable" }, 403);
      if (body.action === "end") {
        if (s.author_id !== auth.user.id)
          return reply({ error: "Only the participant can end this practice" }, 403);
        // Client SDK disconnects the media; retain reservation until expiry to avoid overlapping provider legs.
        return reply({ ok: true });
      }
      if (!s.call_id) return reply({ session: s, call: null });
      const call = await provider("call/" + s.call_id);
      if (!practiceCallMatches(call, s.id, body.tenantId))
        return reply({ error: "Practice evidence mismatch" }, 409);
      if (body.action === "recording") {
        const r = await fetch(`https://api.vapi.ai/call/${s.call_id}/mono-recording`, {
          headers: { Authorization: `Bearer ${key}` },
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
        });
        const url = secureUrl(r.headers.get("location"));
        if (r.status !== 302 || !url || new URL(url).hostname === "api.vapi.ai")
          return reply({ error: "Practice recording unavailable" }, 404);
        return reply({ url });
      }
      if (call.status === "ended")
        await service
          .from("receptionist_practice_sessions")
          .update({ state: "ended" })
          .eq("id", s.id)
          .eq("tenant_id", body.tenantId);
      return reply({ session: s, call: normalizeCall(call) });
    }
    if (!["info", "start"].includes(String(body.action)))
      return reply({ error: "Unsupported action" }, 400);
    const assistant = await provider("assistant/" + w.assistant_id);
    if (assistant.id !== w.assistant_id) throw Error("Assistant scope mismatch");
    const ids = record(assistant.model).toolIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 30 || ids.some((x) => !uuid(x))))
      throw Error("Tool configuration needs review");
    const tools = await Promise.all(
      (Array.isArray(ids) ? ids : []).map((id) => provider("tool/" + id)),
    );
    const queryIds = allowedQueryTools(tools);
    const overview = assistantOverview(assistant, queryIds.length, tools.length - queryIds.length);
    let candidate;
    let unavailableReason = w.practice_enabled
      ? null
      : "Browser practice is not enabled for this workspace.";
    try {
      candidate = practiceAssistant(assistant, queryIds);
    } catch (e) {
      candidate = null;
      // Only expose our own fixed validation messages, never provider response bodies.
      const message = e instanceof Error ? e.message : "";
      unavailableReason =
        message === "Custom knowledge requires review"
          ? "Emma uses a custom knowledge connection, which needs a separate safety review before browser practice. Her live phone setup is unchanged."
          : message === "Invalid inline knowledge configuration"
            ? "Emma’s file-based knowledge configuration is incomplete or unsupported. OpenFolk needs to check its file references."
            : message === "Published instructions unavailable"
              ? "Emma’s published conversation instructions are unavailable. OpenFolk needs to check the assistant configuration."
              : "Emma’s voice or model configuration is not supported by this practice connection yet. OpenFolk needs to check it.";
    }
    if (body.action === "info")
      return reply({
        overview: {
          ...overview,
          queryToolCount: queryIds.length + (candidate?.model.tools?.length ?? 0),
        },
        enabled: w.practice_enabled && !!candidate,
        unavailableReason,
        checkedAt: new Date().toISOString(),
        maxSeconds: 180,
      });
    if (!w.practice_enabled || !candidate)
      return reply({ error: "OpenFolk needs to finish preparing the practice connection" }, 409);
    if (!uuid(body.sessionId)) return reply({ error: "Invalid practice reference" }, 400);
    // Reconcile only positively ended, correctly bound provider calls. The locked
    // reservation RPC remains authoritative for overlap and all usage limits.
    const pending = await service
      .from("receptionist_practice_sessions")
      .select("id,call_id")
      .eq("tenant_id", body.tenantId)
      .in("state", ["starting", "active"])
      .gt("expires_at", new Date().toISOString());
    if (pending.error)
      return reply(
        { error: "Practice availability could not be checked. No new call was requested." },
        503,
      );
    await reconcilePracticeSessions(
      pending.data ?? [],
      body.tenantId,
      (id) => provider("call/" + id),
      async (id) => {
        const updated = await service
          .from("receptionist_practice_sessions")
          .update({ state: "ended" })
          .eq("id", id)
          .eq("tenant_id", body.tenantId)
          .in("state", ["starting", "active"]);
        if (updated.error) throw Error("Practice reconciliation unavailable");
      },
    );
    const { data: reserved, error: reserveError } = await service.rpc(
      "reserve_receptionist_practice",
      { p_tenant: body.tenantId, p_actor: auth.user.id, p_id: body.sessionId },
    );
    if (reserveError || !reserved) {
      const failure = practiceReservationFailure(reserveError?.message, reserved);
      return reply({ error: failure.error, code: failure.code }, failure.status);
    }
    try {
      const duration = body.mode === "listen" ? 25 : 180;
      const token = await webCallToken(key, String(assistant.orgId ?? ""));
      const response = await fetch("https://api.vapi.ai/call/web", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          assistant: {
            ...candidate,
            maxDurationSeconds: duration,
            metadata: { openfolkPracticeSession: body.sessionId, openfolkTenant: body.tenantId },
          },
          roomDeleteOnUserLeaveEnabled: true,
        }),
      });
      if (!response.ok && definitiveWebCallRejection(response.status)) {
        const released = await service
          .from("receptionist_practice_sessions")
          .update({ state: "failed" })
          .eq("id", body.sessionId)
          .eq("tenant_id", body.tenantId);
        return reply(
          {
            error: released.error
              ? "Vapi rejected this attempt, but its reservation could not be released. Wait five minutes before another attempt."
              : `Vapi rejected the browser-call request (HTTP ${response.status}). No call started. OpenFolk needs to check the connection; no five-minute wait is required.`,
          },
          502,
        );
      }
      if (!response.ok) throw Error("Unconfirmed web call response");
      const call = record(await response.json());
      if (!uuid(call.id)) throw Error("Missing call reference");
      const webCallUrl = practiceRoom(call.webCallUrl ?? record(call.transport).callUrl);
      const saved = await service
        .from("receptionist_practice_sessions")
        .update({
          call_id: call.id,
          state: "active",
          source_version: String(assistant.updatedAt ?? "unavailable"),
        })
        .eq("id", body.sessionId)
        .eq("tenant_id", body.tenantId);
      if (saved.error) throw Error("Practice receipt unavailable");
      return reply({
        sessionId: body.sessionId,
        callId: call.id,
        webCallUrl,
        maxSeconds: duration,
        sourceVersion: assistant.updatedAt ?? null,
      });
    } catch {
      // Keep the reserved slot: a network timeout may have created a bounded provider call.
      return reply(
        {
          error:
            "The practice connection could not be confirmed. No retry was sent. Your notes are safe; wait five minutes before a new attempt.",
        },
        502,
      );
    }
  } catch (e) {
    return reply(
      {
        error:
          e instanceof ProviderReadError
            ? e.message
            : "Receptionist connection unavailable. Please retry or ask OpenFolk to check.",
      },
      502,
    );
  }
});
