/**
 * Canonical Interactions — tenant-scoped reads (RLS browser client) + a sync
 * trigger (Edge Function). The `interactions` table is the shared business
 * timeline; reads are filtered to the caller's tenant by the SELECT policy. The
 * backfill/refresh runs server-side (interactions-sync) — no service role, no
 * client-supplied tenant. Mirrors `./phone-feed` / `./platform-jobs`.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type InteractionType =
  "phone_call" | "email_message" | "form_submission" | "chat_message" | "note" | "document_event";

export type InteractionDirection = "inbound" | "outbound" | "internal" | "unknown";

export interface Interaction {
  id: string;
  tenant_id: string;
  source_connector_id: string;
  source_type: string;
  source_table: string;
  source_id: string;
  source_external_id: string | null;
  interaction_type: InteractionType | string;
  direction: InteractionDirection | string | null;
  occurred_at: string;
  subject: string | null;
  summary: string | null;
  body_preview: string | null;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  phone_from: string | null;
  phone_to: string | null;
  status: string;
  processing_status: string;
  sentiment: string | null;
  priority: string | null;
  related_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InteractionFilter {
  interactionType?: string;
  connectorId?: string;
  direction?: string;
  since?: string;
  limit?: number;
}

export interface InteractionSummary {
  total_today: number;
  phone_today: number;
  email_today: number;
  pending_processing: number;
  latest_interaction_at: string | null;
}

export interface InteractionsSyncResult {
  success: boolean;
  phone_processed: number;
  email_processed: number;
  interactions_upserted: number;
}

const INTERACTION_COLUMNS =
  "id, tenant_id, source_connector_id, source_type, source_table, source_id, source_external_id, interaction_type, direction, occurred_at, subject, summary, body_preview, from_address, from_name, to_addresses, cc_addresses, phone_from, phone_to, status, processing_status, sentiment, priority, related_thread_id, created_at, updated_at";

function clampLimit(v: number | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 100;
  return Math.max(1, Math.min(500, n));
}

/** List the tenant's interactions (RLS-scoped), newest first. */
export async function listInteractions(
  filter: InteractionFilter = {},
): Promise<ApiResult<Interaction[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  let query = supabase
    .from("interactions")
    .select(INTERACTION_COLUMNS)
    .order("occurred_at", { ascending: false })
    .limit(clampLimit(filter.limit));
  if (filter.interactionType) query = query.eq("interaction_type", filter.interactionType);
  if (filter.connectorId) query = query.eq("source_connector_id", filter.connectorId);
  if (filter.direction) query = query.eq("direction", filter.direction);
  if (filter.since) query = query.gte("occurred_at", filter.since);

  const { data, error } = await query;
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data ?? []) as Interaction[] };
}

/**
 * Operational summary of the timeline. Returns ok:false ("interactions_unavailable")
 * when the table can't be read (so the UI never shows a fake zero). An empty but
 * readable table returns zeros + a null latest (⇒ "timeline not built yet").
 */
export async function getInteractionSummary(): Promise<ApiResult<InteractionSummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const head = { count: "exact" as const, head: true as const };

  const count = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  // Probe: distinguish "unavailable" from "empty".
  const probe = await supabase
    .from("interactions")
    .select("*", head)
    .gte("occurred_at", startToday);
  if (probe.error) {
    return { ok: false, error: { code: "interactions_unavailable", message: probe.error.message } };
  }

  const [phoneToday, emailToday, pending, latest] = await Promise.all([
    count(() =>
      supabase
        .from("interactions")
        .select("*", head)
        .eq("interaction_type", "phone_call")
        .gte("occurred_at", startToday),
    ),
    count(() =>
      supabase
        .from("interactions")
        .select("*", head)
        .eq("interaction_type", "email_message")
        .gte("occurred_at", startToday),
    ),
    count(() => supabase.from("interactions").select("*", head).eq("processing_status", "pending")),
    supabase
      .from("interactions")
      .select("occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    ok: true,
    data: {
      total_today: probe.count ?? 0,
      phone_today: phoneToday ?? 0,
      email_today: emailToday ?? 0,
      pending_processing: pending ?? 0,
      latest_interaction_at: ((latest.data as { occurred_at: string } | null)?.occurred_at ??
        null) as string | null,
    },
  };
}

/**
 * Trigger the server-side backfill/refresh (Edge Function, service role). The
 * browser client forwards the signed-in user's session, so the function's authz
 * binds the tenant — no tenant is trusted from the client.
 */
export async function syncInteractions(
  source: "phone" | "email" | "all" = "all",
): Promise<ApiResult<InteractionsSyncResult>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("interactions-sync", {
    body: { source },
  });
  if (error) {
    return { ok: false, error: { code: "sync_failed", message: error.message } };
  }
  return { ok: true, data: data as InteractionsSyncResult };
}
