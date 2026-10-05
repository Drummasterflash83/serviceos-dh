// ServiceOS — OpenFolk Control Plane: telephony endpoint DISCOVERY from call activity.
//
// Bridges the provider adapter (caller-ID label parsing) to the canonical, provider-neutral
// evidence model. It reads observed call activity, derives per-extension endpoint evidence,
// and idempotently mirrors each internal seat into communication_endpoints (kind='extension',
// source='discovery') via cp_upsert_endpoint. Like every discovery adapter it writes ENDPOINTS
// ONLY — never ownership, never an identity link. The operator confirms extension⇄person
// through the normal review path (endpoint_identity_reviews → member_integration_identities).
//
// The provider convention lives entirely in ../telephony/caller_id_labels.ts; the matching of a
// seat label to a team member lives in ./telephony_identity.ts. This module is the glue: DB in,
// governed endpoint upserts out.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseCallerIdLabel } from "../telephony/caller_id_labels.ts";
import {
  aggregateExtensionEvidence,
  suggestTelephonyIdentity,
  type CallLegEvidence,
  type TelephonyIdentitySuggestion,
} from "./telephony_identity.ts";

export interface TelephonyDiscoveryResult {
  scanned_calls: number;
  extensions: number;
  created: number;
  updated: number;
  unchanged: number;
  /** How far back the bounded scan reached (max rows), for honesty in the run summary. */
  bounded_to_calls: number;
}

type UpsertOutcome = "created" | "updated" | "unchanged";
function outcomeOf(data: unknown): UpsertOutcome {
  const o = (data as { outcome?: string } | null)?.outcome;
  return o === "created" || o === "updated" || o === "unchanged" ? o : "unchanged";
}

/**
 * Derive internal-seat (extension) endpoints from observed call activity and mirror them into
 * communication_endpoints. Idempotent: rerunning re-aggregates and upserts the same rows.
 * Bounded by `maxCalls` (default 5000, most-recent first) — never an unbounded history scan.
 */
export async function discoverTelephonyExtensionsFromActivity(
  admin: SupabaseClient,
  tenantId: string,
  actor: string,
  opts?: { maxCalls?: number },
): Promise<TelephonyDiscoveryResult> {
  const maxCalls = Math.max(1, Math.min(opts?.maxCalls ?? 5000, 20000));
  const { data: calls, error } = await admin
    .from("phone_calls")
    .select("provider, from_number, to_number, started_at")
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(maxCalls);
  if (error) throw new Error(`discoverTelephonyExtensionsFromActivity: ${error.message}`);

  const legs: CallLegEvidence[] = [];
  const providerByExt = new Map<string, string>();
  for (const c of calls ?? []) {
    const at = (c.started_at as string | null) ?? null;
    const provider = (c.provider as string | null) ?? "unknown";
    for (const field of [c.from_number, c.to_number]) {
      const p = parseCallerIdLabel(field as string | null);
      if (p.extension) {
        legs.push({ extension: p.extension, label: p.label, at });
        if (!providerByExt.has(p.extension)) providerByExt.set(p.extension, provider);
      }
    }
  }

  const endpoints = aggregateExtensionEvidence(legs);
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const correlation = crypto.randomUUID();
  for (const ep of endpoints) {
    const { data, error: upErr } = await admin.rpc("cp_upsert_endpoint", {
      p_tenant: tenantId,
      p_channel: "phone",
      p_endpoint_kind: "extension",
      p_normalized: ep.extension,
      p_display: ep.observed_labels[0] ?? ep.extension,
      p_provider: providerByExt.get(ep.extension) ?? "unknown",
      p_provider_ref: null,
      p_is_shared: false,
      p_source: "discovery",
      p_source_object_ref: null,
      p_metadata: {
        evidence_source: "call_activity",
        observed_labels: ep.observed_labels,
        call_count: ep.call_count ?? 0,
        last_activity: ep.last_activity,
      },
      p_actor: actor,
      p_reason: "telephony extension discovery from call activity",
      p_correlation: correlation,
      p_view_as: false,
    });
    if (upErr) throw new Error(`cp_upsert_endpoint(ext ${ep.extension}): ${upErr.message}`);
    const o = outcomeOf(data);
    if (o === "created") created++;
    else if (o === "updated") updated++;
    else unchanged++;
  }

  await admin.from("controlplane_change_log").insert({
    tenant_id: tenantId,
    actor,
    action: "controlplane.discovery.run",
    resource_type: "discovery_run",
    resource_id: "phone_activity",
    before: {},
    after: {
      scanned_calls: (calls ?? []).length,
      extensions: endpoints.length,
      created,
      updated,
      unchanged,
      bounded_to_calls: maxCalls,
      at: new Date().toISOString(),
    },
    reason: "telephony extension discovery from call activity",
    correlation_id: correlation,
    view_as_active: false,
    source: "discovery",
  });

  return {
    scanned_calls: (calls ?? []).length,
    extensions: endpoints.length,
    created,
    updated,
    unchanged,
    bounded_to_calls: maxCalls,
  };
}

export interface TelephonyEndpointCandidate extends TelephonyIdentitySuggestion {
  endpoint_id: string;
  display_value: string | null;
  observed_labels: string[];
  call_count: number;
  last_activity: string | null;
}

/**
 * Compute review-only telephony identity candidates for the tenant's phone extension endpoints.
 * Mirrors computeIdentityResolution (email) — suggestions never auto-confirm; existing reviews
 * are surfaced so the operator sees what is already decided. Identity is NOT ownership.
 */
export async function computeTelephonyIdentityResolution(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ candidates: TelephonyEndpointCandidate[] }> {
  const [{ data: endpoints }, { data: members }, { data: identities }] = await Promise.all([
    admin
      .from("communication_endpoints")
      .select("id, normalized_value, display_value, metadata")
      .eq("tenant_id", tenantId)
      .eq("channel", "phone")
      .eq("endpoint_kind", "extension")
      .eq("status", "active"),
    admin
      .from("team_members")
      .select("id, display_name")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
    admin
      .from("member_integration_identities")
      .select("team_member_id, primary_login, external_ref, verification_state, provider")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
  ]);

  const memberList = (members ?? []).map((m) => ({
    id: m.id as string,
    display_name: m.display_name as string,
  }));
  // A confirmed telephony link is stored by cp_review_identity with the endpoint's provider
  // (e.g. 'sipcentric') and external_ref = the extension digits — NOT a fixed 'voip' label. So
  // match on an extension-shaped external_ref, provider-neutrally.
  const confirmed = (identities ?? [])
    .filter((i) => i.verification_state === "verified")
    .filter((i) => /^\d{2,6}$/.test(String(i.external_ref ?? "")))
    .map((i) => ({
      team_member_id: i.team_member_id as string,
      primary_login: (i.primary_login as string | null) ?? null,
      external_ref: (i.external_ref as string | null) ?? null,
    }));

  const candidates: TelephonyEndpointCandidate[] = [];
  for (const e of endpoints ?? []) {
    const meta = (e.metadata ?? {}) as {
      observed_labels?: string[];
      call_count?: number;
      last_activity?: string | null;
    };
    const observed_labels = Array.isArray(meta.observed_labels) ? meta.observed_labels : [];
    const suggestion = suggestTelephonyIdentity(
      {
        extension: String(e.normalized_value),
        observed_labels,
        call_count: meta.call_count ?? 0,
        last_activity: meta.last_activity ?? null,
      },
      memberList,
      confirmed,
    );
    candidates.push({
      ...suggestion,
      endpoint_id: e.id as string,
      display_value: (e.display_value as string | null) ?? null,
      observed_labels,
      call_count: meta.call_count ?? 0,
      last_activity: meta.last_activity ?? null,
    });
  }
  return { candidates };
}
