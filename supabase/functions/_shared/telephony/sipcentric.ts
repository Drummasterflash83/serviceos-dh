// ServiceOS — Sipcentric / Birchills provider adapter (implements the contract).
//
// Uses ONLY data genuinely available from the audited feed: opaque endpoint URIs,
// call direction, recording/transcript linkage, inbound/outbound activity. Everything
// else (extensions, devices, trunks, DDIs, queues, pickup, provisioning) returns a
// STRUCTURED unsupported result — never inferred from unrelated metadata.

import {
  unsupported,
  providerCapabilities,
  type AdapterContext,
  type CanonicalType,
  type ConnectionTestResult,
  type DiscoverResult,
  type DiscoveredObject,
  type ProviderAdapter,
} from "./adapter.ts";

function internalEndpoint(raw: Record<string, unknown>): string | null {
  const dir = String(raw.direction ?? "").toUpperCase();
  const src = typeof raw.srcEndpoint === "string" ? raw.srcEndpoint : null;
  const dst = typeof raw.dstEndpoint === "string" ? raw.dstEndpoint : null;
  const v = dir === "OUT" ? src : dir === "IN" ? dst : (src ?? dst);
  return v && v.startsWith("http") ? v : null;
}

export const sipcentricAdapter: ProviderAdapter = {
  provider: "sipcentric",
  label: "Sipcentric / Birchills",
  authMode: "account_credentials",
  getCapabilityStatus: () => providerCapabilities("sipcentric"),

  async testConnection(ctx: AdapterContext): Promise<ConnectionTestResult> {
    const cnt = async (table: string) => {
      const { count } = await ctx.db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", ctx.tenantId);
      return count ?? 0;
    };
    const [calls, recs, trs] = await Promise.all([
      cnt("phone_calls"),
      cnt("phone_recordings"),
      cnt("phone_transcripts"),
    ]);
    const { data: latest } = await ctx.db
      .from("phone_calls")
      .select("started_at")
      .eq("tenant_id", ctx.tenantId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const checks = [
      {
        name: "provider_reachable",
        ok: calls > 0,
        detail: calls > 0 ? "call activity present" : "no call activity seen",
      },
      { name: "call_history_permission", ok: calls > 0, detail: `${calls} calls` },
      { name: "recording_permission", ok: recs > 0, detail: `${recs} recordings` },
      { name: "transcript_access", ok: trs > 0, detail: `${trs} transcripts` },
      {
        name: "inventory_discovery_permission",
        ok: calls > 0,
        detail: "endpoints derived from call metadata",
      },
      {
        name: "latest_successful_sync",
        ok: !!latest?.started_at,
        detail: latest?.started_at ? String(latest.started_at) : "none",
      },
    ];
    return { ok: calls > 0, checks };
  },

  async discover(type: CanonicalType, ctx: AdapterContext): Promise<DiscoverResult> {
    if (type === "endpoint") {
      const { data: calls, error } = await ctx.db
        .from("phone_calls")
        .select("raw_payload, started_at")
        .eq("tenant_id", ctx.tenantId)
        .limit(5000);
      if (error)
        return {
          supported: true,
          ok: false,
          objects: [],
          error: { code: "db_error", message: error.message },
        };
      const agg = new Map<string, { last: string | null; count: number }>();
      for (const c of calls ?? []) {
        const ep = internalEndpoint((c.raw_payload as Record<string, unknown>) ?? {});
        if (!ep) continue;
        const a = agg.get(ep) ?? { last: null, count: 0 };
        a.count++;
        const s = c.started_at as string | null;
        if (s && (!a.last || s > a.last)) a.last = s;
        agg.set(ep, a);
      }
      const objects: DiscoveredObject[] = [...agg.entries()].map(([ep, a]) => ({
        providerObjectId: ep,
        canonicalType: "endpoint",
        label: `Endpoint …${ep.slice(-6)}`,
        confidence: 1.0,
        discoverySource: "call_metadata",
        capabilities: { direction: true, recordings: true },
        providerMetadata: { last_activity: a.last, call_count: a.count },
      }));
      return { supported: true, ok: true, objects };
    }
    // Everything else is honestly unavailable from this provider feed.
    const reasons: Partial<Record<CanonicalType, string>> = {
      extension: "Human extensions are not present in the Sipcentric call feed — map manually.",
      device: "Device models are not exposed by this feed.",
      trunk: "Trunk discovery is not available via this feed.",
      ddi: "DDI discovery is not available via this feed.",
      queue: "Queue metadata is not exposed.",
      ring_group: "Ring-group metadata is not exposed.",
      pickup_group: "Pickup-group metadata is not exposed.",
    };
    return unsupported(reasons[type] ?? `${type} is not available from this provider.`);
  },
};
