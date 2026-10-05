// ServiceOS — Edge Function: telephony-mapping.
//
// Powers Settings → Phone / VoIP calibration. Tenant-bound, owner/admin only.
// Actions:
//   inventory   — discover endpoints from real calls, aggregate spoken-name evidence,
//                 produce REVIEWABLE suggestions + existing confirmed mappings + caps.
//   confirm     — persist an admin-confirmed endpoint→person mapping (telephony_directory).
//   reject      — record a rejected suggestion (inactive row).
//   deactivate  — deactivate a mapping.
// Never auto-confirms. Never mutates raw transcripts/payloads. Numbers are not returned.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { requireTenantUser, assertSameTenant } from "../_shared/authz.ts";
import { detectSpokenNames, type KnownPerson } from "../_shared/phone_intelligence/spoken_name.ts";
import { suggestEndpointMapping, type NameTally } from "../_shared/telephony/discovery.ts";
import { providerCapabilities } from "../_shared/telephony/capabilities.ts";

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

/** Internal-side endpoint ref for a call (OUT→src, IN→dst). Opaque URI, never parsed. */
function internalEndpoint(raw: Record<string, unknown>): string | null {
  const dir = String(raw.direction ?? "").toUpperCase();
  const src = typeof raw.srcEndpoint === "string" ? raw.srcEndpoint : null;
  const dst = typeof raw.dstEndpoint === "string" ? raw.dstEndpoint : null;
  const v = dir === "OUT" ? src : dir === "IN" ? dst : (src ?? dst);
  return v && v.startsWith("http") ? v : v && /^\d{2,6}$/.test(v) ? v : null;
}
const maskEndpoint = (ref: string) => `…${ref.slice(-6)}`;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const supabase = createSupabaseAdmin();
  if (!supabase) return fail("config_error", "Service role not configured", 500);

  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return fail("invalid_json", "Body must be JSON", 400);
  }
  const action = String(body.action ?? "inventory");

  // Reads allow ops; writes require owner/admin.
  const roles = action === "inventory" ? ["owner", "admin", "ops"] : ["owner", "admin"];
  const auth = await requireTenantUser(req, supabase, roles as never);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  const nowIso = new Date().toISOString();
  // Deactivate the current active mapping for an endpoint (kept for history, stamped
  // with an effective_to). Returns nothing — best-effort.
  async function retireActive(endpointRef: string, status: string) {
    await supabase
      .from("telephony_directory")
      .update({ active: false, status, effective_to: nowIso })
      .eq("tenant_id", tenantId)
      .eq("endpoint_ref", endpointRef)
      .eq("active", true);
  }

  // ── writes ────────────────────────────────────────────────────────────────
  if (action === "confirm") {
    const endpointRef = String(body.endpoint_ref ?? "");
    const personId = body.person_node_id ? String(body.person_node_id) : null;
    if (!endpointRef) return fail("invalid_input", "endpoint_ref required", 400);
    const shared = body.is_shared_device === true;

    // Cross-tenant guard: a chosen person MUST be an active person in THIS tenant.
    if (!shared && personId) {
      const { data: person } = await supabase
        .from("graph_nodes")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", personId)
        .eq("node_type", "person")
        .maybeSingle();
      if (!person) return fail("invalid_person", "Person not found in this tenant", 400);
    }

    // Replace (history-preserving): retire the prior active mapping, insert the new one.
    await retireActive(endpointRef, "inactive");
    const { error } = await supabase.from("telephony_directory").insert({
      tenant_id: tenantId,
      endpoint_ref: endpointRef,
      extension: body.extension ? String(body.extension) : null,
      person_node_id: shared ? null : personId,
      role: body.role ? String(body.role) : null,
      is_shared_device: shared,
      active: true,
      confidence: 1.0,
      source: "configured",
      status: shared ? "shared" : "confirmed",
      effective_from: nowIso,
      metadata: { confirmed_by: auth.ctx.userId, endpoint_ref: endpointRef },
    });
    if (error) return fail("db_error", error.message, 500);
    return json({ success: true, action, endpoint: maskEndpoint(endpointRef) });
  }
  if (action === "reject" || action === "deactivate" || action === "unknown") {
    const endpointRef = String(body.endpoint_ref ?? "");
    if (!endpointRef) return fail("invalid_input", "endpoint_ref required", 400);
    const status = action === "reject" ? "rejected" : action === "unknown" ? "unknown" : "inactive";
    await retireActive(endpointRef, status);
    // Record the review outcome so the endpoint isn't re-suggested endlessly.
    await supabase.from("telephony_directory").insert({
      tenant_id: tenantId,
      endpoint_ref: endpointRef,
      extension: null,
      active: false,
      status,
      source: "configured",
      effective_from: nowIso,
      metadata: { endpoint_ref: endpointRef, by: auth.ctx.userId },
    });
    return json({ success: true, action, endpoint: maskEndpoint(endpointRef) });
  }

  // ── inventory (discovery + evidence + suggestions) ──────────────────────────
  const [
    { data: calls },
    { data: recs },
    { data: transcripts },
    { data: people },
    { data: mappings },
  ] = await Promise.all([
    supabase
      .from("phone_calls")
      .select("provider_call_id, raw_payload, started_at")
      .eq("tenant_id", tenantId)
      .limit(5000),
    supabase
      .from("phone_recordings")
      .select("id, provider_call_id")
      .eq("tenant_id", tenantId)
      .limit(5000),
    supabase
      .from("phone_transcripts")
      .select("recording_id, transcript_text")
      .eq("tenant_id", tenantId)
      .not("transcript_text", "is", null)
      .limit(2000),
    supabase
      .from("graph_nodes")
      .select("id, label")
      .eq("tenant_id", tenantId)
      .eq("node_type", "person")
      .limit(2000),
    supabase
      .from("telephony_directory")
      .select("endpoint_ref, person_node_id, role, is_shared_device, status, active, confidence")
      .eq("tenant_id", tenantId),
  ]);

  const knownPeople: KnownPerson[] = (people ?? [])
    .filter((p) => p.label)
    .map((p) => ({ id: p.id as string, name: p.label as string }));
  const nameById = new Map(knownPeople.map((p) => [p.id, p.name]));

  // provider_call_id → { endpointRef, direction, startedAt }
  const callByPcid = new Map<string, { ep: string | null; dir: string; started: string | null }>();
  let provider = "unknown";
  for (const c of calls ?? []) {
    const raw = (c.raw_payload as Record<string, unknown>) ?? {};
    if (provider === "unknown" && typeof raw.uri === "string" && raw.uri.includes("sipcentric"))
      provider = "sipcentric";
    const pcid = c.provider_call_id as string | null;
    if (pcid)
      callByPcid.set(pcid, {
        ep: internalEndpoint(raw),
        dir: String(raw.direction ?? "").toUpperCase(),
        started: (c.started_at as string | null) ?? null,
      });
  }
  const recToPcid = new Map(
    (recs ?? []).map((r) => [r.id as string, r.provider_call_id as string | null]),
  );

  // aggregate per endpoint
  interface Agg {
    inbound: number;
    outbound: number;
    lastSeen: string | null;
    names: Map<string, { personId: string | null; count: number }>;
  }
  const byEndpoint = new Map<string, Agg>();
  const ensure = (ep: string): Agg => {
    let a = byEndpoint.get(ep);
    if (!a) {
      a = { inbound: 0, outbound: 0, lastSeen: null, names: new Map() };
      byEndpoint.set(ep, a);
    }
    return a;
  };
  for (const c of callByPcid.values()) {
    if (!c.ep) continue;
    const a = ensure(c.ep);
    if (c.dir === "IN") a.inbound++;
    else if (c.dir === "OUT") a.outbound++;
    if (c.started && (!a.lastSeen || c.started > a.lastSeen)) a.lastSeen = c.started;
  }
  // spoken-name tallies per endpoint
  for (const t of transcripts ?? []) {
    const pcid = recToPcid.get(t.recording_id as string);
    const call = pcid ? callByPcid.get(pcid) : null;
    if (!call?.ep) continue;
    const a = ensure(call.ep);
    const spoken = detectSpokenNames({
      transcript: t.transcript_text as string,
      transcriptQuality: 0.75,
      knownPeople,
    });
    for (const s of spoken) {
      if (s.thirdParty || !s.matchedPersonId) continue;
      const cur = a.names.get(s.matchedPersonId) ?? { personId: s.matchedPersonId, count: 0 };
      cur.count++;
      a.names.set(s.matchedPersonId, cur);
    }
  }

  // Prefer the ACTIVE mapping per endpoint (there can be inactive history rows).
  const mappingByEp = new Map<string, (typeof mappings)[number]>();
  for (const m of mappings ?? []) {
    const ep = m.endpoint_ref as string;
    const cur = mappingByEp.get(ep);
    if (!cur || (m.active && !cur.active)) mappingByEp.set(ep, m);
  }
  const endpoints = [...byEndpoint.entries()].map(([ep, a]) => {
    const nameTally: NameTally[] = [...a.names.values()].map((n) => ({
      name: nameById.get(n.personId ?? "") ?? "?",
      personId: n.personId,
      count: n.count,
    }));
    const suggestion = suggestEndpointMapping({
      endpointRef: ep,
      inboundCount: a.inbound,
      outboundCount: a.outbound,
      lastSeen: a.lastSeen,
      nameTally,
    });
    const existing = mappingByEp.get(ep);
    return {
      endpoint_masked: maskEndpoint(ep),
      endpoint_ref: ep,
      inbound: a.inbound,
      outbound: a.outbound,
      last_seen: a.lastSeen,
      suggestion,
      mapping: existing
        ? {
            status: existing.status,
            active: existing.active,
            person_name: existing.person_node_id
              ? (nameById.get(existing.person_node_id as string) ?? null)
              : null,
            is_shared_device: existing.is_shared_device,
            role: existing.role,
          }
        : null,
    };
  });
  endpoints.sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound));

  // Deduplicated active tenant people for the mapping picker (tenant-scoped — never
  // another tenant's people). Deduped by display name (the graph has duplicate nodes).
  const peopleByName = new Map<string, { id: string; name: string }>();
  for (const p of knownPeople) if (!peopleByName.has(p.name)) peopleByName.set(p.name, p);
  const peopleList = [...peopleByName.values()].sort((a, b) => a.name.localeCompare(b.name));

  return json({
    success: true,
    provider,
    capabilities: providerCapabilities(provider),
    people: peopleList,
    endpoints,
    counts: {
      endpoints: endpoints.length,
      confirmed: endpoints.filter((e) => e.mapping?.status === "confirmed").length,
      suggested: endpoints.filter((e) => !e.mapping && e.suggestion.status === "suggested").length,
      conflicts: endpoints.filter((e) => e.suggestion.status === "conflicted").length,
    },
  });
});
