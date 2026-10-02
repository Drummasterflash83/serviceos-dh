// Operator-only, read-only evidence of PBX ingestion. No caller/audio/text data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { includeLocalCalls } from "../_shared/phone-sync-completeness.ts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 2000) return reply({ error: "Request too large" }, 400);
    const body = JSON.parse(raw);
    if (!UUID.test(body?.tenantId ?? "")) return reply({ error: "Choose a client" }, 400);
    const requestDb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
        auth: { persistSession: false },
      },
    );
    // Maintenance also requires the existing explicit, server-verified Chris actor.
    const serviceGate = UUID.test(body.actorId ?? "")
      ? await requestDb.rpc("notification_require_actor", { p_actor: body.actorId })
      : null;
    if (!serviceGate || serviceGate.error) {
      const auth = await requestDb.auth.getUser();
      if (auth.error || !auth.data.user) return reply({ error: "Sign in to OpenFolk" }, 401);
      const gate = await requestDb.rpc("care_desk_operator");
      if (
        gate.error ||
        gate.data !== true ||
        auth.data.user.email?.toLowerCase() !== "chris@openfolk.ai"
      )
        return reply({ error: "OpenFolk administrator required" }, 403);
    }
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const workspace = await db
      .from("receptionist_workspaces")
      .select("tenant_id")
      .eq("tenant_id", body.tenantId)
      .maybeSingle();
    if (workspace.error || !workspace.data) return reply({ error: "Client unavailable" }, 404);
    const asOf = new Date().toISOString(),
      since = new Date(Date.now() - 86400000).toISOString();
    const calls = (direction?: string, recent = false) => {
      let q = db
        .from("phone_calls")
        .select("id", { head: true, count: "exact" })
        .eq("tenant_id", body.tenantId)
        .eq("provider", "simwood");
      if (direction) q = q.eq("direction", direction);
      if (recent) q = q.gte("started_at", since).lte("started_at", asOf);
      return q;
    };
    const sync = (type: string) =>
      db
        .from("phone_sync_runs")
        .select("status,completed_at,metadata")
        .eq("tenant_id", body.tenantId)
        .eq("provider", "simwood")
        .eq("sync_type", type)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    const result = await Promise.all([
      calls(),
      calls("IN"),
      calls("OUT"),
      calls(undefined, true),
      db.rpc("phone_pipeline_health", { p_tenant_id: body.tenantId }),
      sync("calls"),
      sync("recordings"),
      db
        .from("tenant_connectors")
        .select("id,enabled")
        .eq("tenant_id", body.tenantId)
        .eq("connector_id", "simwood")
        .maybeSingle(),
      db
        .from("receptionist_review_settings")
        .select("enabled,last_scan_at,scan_state")
        .eq("tenant_id", body.tenantId)
        .maybeSingle(),
      db
        .from("receptionist_call_reviews")
        .select("call_id", { head: true, count: "exact" })
        .eq("tenant_id", body.tenantId)
        .eq("state", "reviewed"),
    ]);
    if (result.some((r) => r.error))
      return reply({ error: "Capture evidence could not be refreshed" }, 502);
    const [
      total,
      inbound,
      outbound,
      recent,
      pipeline,
      callSync,
      recordingSync,
      connector,
      reviewSettings,
      reviews,
    ] = result;
    const accounts = connector.data
      ? await db
          .from("connector_accounts")
          .select("settings,sync_cursor")
          .eq("tenant_id", body.tenantId)
          .eq("tenant_connector_id", connector.data.id)
          .eq("status", "active")
      : { data: [], error: null };
    if (accounts.error) return reply({ error: "Capture configuration unavailable" }, 502);
    const h = pipeline.data ?? {};
    const metric = (key: string) => (typeof h[key] === "number" ? h[key] : null);
    const recentSync = (row: any) => ({
      status: row?.status ?? "not_verified",
      completedAt: row?.completed_at ?? null,
      windowComplete:
        row?.metadata?.window_complete === true
          ? true
          : row?.metadata?.window_complete === false
            ? false
            : null,
    });
    return reply({
      asOf,
      since,
      source: "Birchills / Sipcentric",
      connectionEnabled: connector.data?.enabled === true,
      calls: {
        total: total.count,
        inbound: inbound.count,
        outbound: outbound.count,
        last24Hours: recent.count,
      },
      recordings: {
        total: metric("recordings_total"),
        complete: metric("completed"),
        awaitingDownload: metric("need_download"),
        awaitingTranscript: metric("need_transcription"),
        awaitingAnalysis: metric("need_analysis"),
        unresolvedFailures: metric("current_unresolved_failures"),
        lastProcessedAt: h.last_useful_at ?? null,
      },
      sync: { calls: recentSync(callSync.data), recordings: recentSync(recordingSync.data) },
      emmaReview: {
        enabled: reviewSettings.data?.enabled === true,
        state: reviewSettings.data?.scan_state ?? "not_configured",
        lastScanAt: reviewSettings.data?.last_scan_at ?? null,
        savedReviews: reviews.count,
      },
      localLegsIncluded:
        (accounts.data?.length ?? 0) > 0 &&
        accounts.data!.every((a) => includeLocalCalls(a.settings)),
      completeness: "not_reconciled",
      note: "Counts describe imported PBX records, not proof that every conversation was recorded. Unanswered calls may have no recording; transferred legs require provider reconciliation. Vapi and voicemail coverage are separate.",
    });
  } catch {
    return reply({ error: "Capture evidence unavailable" }, 502);
  }
});
