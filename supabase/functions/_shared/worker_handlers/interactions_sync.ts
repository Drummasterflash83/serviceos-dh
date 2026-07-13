// ServiceOS — Worker handler: interactions.sync (canonical interactions v1).
// Pure business logic. Auth, CORS and the platform_jobs lifecycle live in the
// caller. Tenant is always caller-validated. Idempotent upserts keyed on
// (tenant, source_table, source_id); source rows are never mutated.
//
// INCREMENTAL (repair/backfill): phone selects via phone_select_projectable and
// email via email_select_unprojected, so unchanged rows are never re-selected and
// a steady-state run upserts zero. interaction.ready is published ONLY for
// genuinely-new interactions (never on a refresh) — the live phone finaliser
// (_shared/phone_enrich.ts) still owns real-time phone projection + events.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { publishEvent } from "../events.ts";

type Admin = SupabaseClient;

function clampLimit(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 500;
  return Math.max(1, Math.min(2000, n));
}

/** Coerce a jsonb array into a clean string[] (drops non-string entries). */
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

interface InteractionRow {
  tenant_id: string;
  source_connector_id: string;
  source_type: string;
  source_table: string;
  source_id: string;
  source_external_id: string | null;
  interaction_type: string;
  direction: string;
  occurred_at: string;
  subject: string | null;
  summary: string | null;
  body_preview: string | null;
  from_address?: string | null;
  from_name?: string | null;
  to_addresses?: string[];
  cc_addresses?: string[];
  phone_from?: string | null;
  phone_to?: string | null;
  sentiment: string | null;
  related_thread_id: string | null;
  processing_status: string;
  /** Max source timestamp at projection time — the incremental marker (phone). */
  source_updated_at?: string | null;
  metadata: Record<string, unknown>;
}

/** Later of two ISO timestamps (ignores nulls / unparseable). */
function maxIso(a: string | null, b: string | null): string | null {
  const ta = a && !Number.isNaN(Date.parse(a)) ? Date.parse(a) : null;
  const tb = b && !Number.isNaN(Date.parse(b)) ? Date.parse(b) : null;
  if (ta === null) return b ?? null;
  if (tb === null) return a ?? null;
  return ta >= tb ? a : b;
}

async function upsertInteractions(admin: Admin, rows: InteractionRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin
    .from("interactions")
    .upsert(rows, { onConflict: "tenant_id,source_table,source_id" });
  if (error) throw new Error(`interactions upsert failed: ${error.message}`);
}

interface ProjectionCounts {
  selected: number;
  created: number;
  updated: number;
}

async function syncPhone(admin: Admin, tenantId: string, limit: number): Promise<ProjectionCounts> {
  // INCREMENTAL selection (§2/§3): only calls that genuinely need (re)projection —
  // no interaction yet, no marker (legacy/pipeline-created), or the source call /
  // AI insight changed after projection. An unchanged call is never returned, so a
  // steady-state run selects zero. The live pipeline finaliser (phone_enrich.ts)
  // still owns real-time projection; this is the repair/backfill path.
  const { data: calls, error } = await admin.rpc("phone_select_projectable", {
    p_tenant_id: tenantId,
    p_limit: limit,
  });
  if (error) throw new Error(`phone_select_projectable failed: ${error.message}`);
  const rows = (calls ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { selected: 0, created: 0, updated: 0 };

  const ids = rows.map((c) => c.id as string);

  // Latest AI insight per call (summary/sentiment + updated_at for the marker).
  const insights = new Map<
    string,
    { summary: string | null; sentiment: string | null; updatedAt: string | null }
  >();
  const { data: ins } = await admin
    .from("phone_ai_insights")
    .select("call_id, summary, sentiment, updated_at, created_at")
    .eq("tenant_id", tenantId)
    .in("call_id", ids)
    .order("created_at", { ascending: false });
  for (const i of (ins ?? []) as Record<string, unknown>[]) {
    const cid = i.call_id as string | null;
    if (cid && !insights.has(cid)) {
      insights.set(cid, {
        summary: (i.summary as string | null) ?? null,
        sentiment: (i.sentiment as string | null) ?? null,
        updatedAt: (i.updated_at as string | null) ?? null,
      });
    }
  }

  // Which of the selected calls ALREADY have an interaction? New ones (no prior
  // interaction) will publish interaction.ready; refreshes must NOT (no event
  // storm, §7). The pipeline finaliser already published for recording-based calls.
  const existing = new Set<string>();
  const { data: existingRows } = await admin
    .from("interactions")
    .select("source_id")
    .eq("tenant_id", tenantId)
    .eq("source_table", "phone_calls")
    .in("source_id", ids);
  for (const r of (existingRows ?? []) as Record<string, unknown>[]) {
    const sid = r.source_id as string | null;
    if (sid) existing.add(sid);
  }

  const interactions: InteractionRow[] = rows.map((c) => {
    const rawDir = c.direction as string | null;
    const direction = rawDir === "IN" ? "inbound" : rawDir === "OUT" ? "outbound" : "unknown";
    const insight = insights.get(c.id as string) ?? null;
    const duration = (c.duration_seconds as number | null) ?? null;
    const outcome = (c.outcome as string | null) ?? null;
    const fallback = `${direction} call${duration != null ? ` · ${duration}s` : ""}${
      outcome ? ` · ${outcome}` : ""
    }`;
    return {
      tenant_id: tenantId,
      source_connector_id: "simwood",
      source_type: "phone",
      source_table: "phone_calls",
      source_id: c.id as string,
      source_external_id: (c.provider_call_id as string | null) ?? null,
      interaction_type: "phone_call",
      direction,
      occurred_at: (c.started_at as string | null) ?? (c.created_at as string),
      subject: null,
      summary: insight?.summary ?? null,
      body_preview: insight?.summary ?? fallback,
      phone_from: (c.from_number as string | null) ?? null,
      phone_to: (c.to_number as string | null) ?? null,
      sentiment: insight?.sentiment ?? null,
      related_thread_id: (c.linked_id as string | null) ?? null,
      // A call WITH an AI insight is fully processed at source → READY for
      // enrichment subscribers; without one it is still 'pending'. (Matches the
      // pipeline's finaliser so the backfill and live paths are interchangeable.)
      processing_status: insight ? "ready" : "pending",
      // Incremental marker: the later of the call's and the insight's updated_at.
      // Stored so an unchanged call is never re-selected next cycle.
      source_updated_at: maxIso(
        (c.updated_at as string | null) ?? null,
        insight?.updatedAt ?? null,
      ),
      metadata: {
        duration_seconds: duration,
        outcome,
        has_ai_insight: Boolean(insight),
      },
    };
  });

  await upsertInteractions(admin, interactions);

  // Publish interaction.ready ONLY for genuinely-new interactions (idempotent,
  // best-effort). Refreshes/repairs never emit a duplicate event.
  const created = interactions.filter((r) => !existing.has(r.source_id));
  if (created.length > 0) {
    const { data: createdRows } = await admin
      .from("interactions")
      .select("id, source_id")
      .eq("tenant_id", tenantId)
      .eq("source_table", "phone_calls")
      .in(
        "source_id",
        created.map((r) => r.source_id),
      );
    for (const row of (createdRows ?? []) as { id: string }[]) {
      await publishEvent(admin, {
        tenantId,
        eventType: "interaction.ready",
        subjectType: "interaction",
        subjectId: row.id,
        source: "interactions-sync:phone",
      });
    }
  }

  return {
    selected: rows.length,
    created: created.length,
    updated: rows.length - created.length,
  };
}

async function syncEmail(admin: Admin, tenantId: string, limit: number): Promise<number> {
  // Detect the owning connector by matching message addresses to the tenant's DWD
  // mailboxes / OAuth accounts (loaded once). Falls back to a generic 'email'.
  const dwd = new Set<string>();
  const oauth = new Set<string>();
  const { data: mbx } = await admin
    .from("google_workspace_mailboxes")
    .select("email_address")
    .eq("tenant_id", tenantId);
  for (const m of (mbx ?? []) as Record<string, unknown>[]) {
    const a = (m.email_address as string | null)?.toLowerCase();
    if (a) dwd.add(a);
  }
  const { data: accts } = await admin
    .from("email_accounts")
    .select("email_address, status")
    .eq("tenant_id", tenantId)
    .eq("provider", "gmail");
  for (const a of (accts ?? []) as Record<string, unknown>[]) {
    const addr = (a.email_address as string | null)?.toLowerCase();
    if (addr && a.status === "active") oauth.add(addr);
  }

  // Starvation-free selection (§16): the OLDEST email_messages that do NOT yet
  // have a canonical interaction, oldest first, bounded. This replaces the former
  // newest-500 window, under which older unprojected mail could never be picked
  // up (email interactions are created ONLY here — there is no inline finaliser
  // like phone). Idempotent upsert stays below.
  const { data: msgs, error } = await admin.rpc("email_select_unprojected", {
    p_tenant_id: tenantId,
    p_limit: limit,
  });
  if (error) throw new Error(`email_messages read failed: ${error.message}`);
  const rows = (msgs ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return 0;

  const interactions: InteractionRow[] = rows.map((m) => {
    const to = toStringArray(m.to_emails);
    const cc = toStringArray(m.cc_emails);
    const addrs = [m.from_email as string | null, ...to, ...cc]
      .filter((x): x is string => Boolean(x))
      .map((x) => x.toLowerCase());
    let connector = "email";
    if (addrs.some((a) => dwd.has(a))) connector = "google-workspace";
    else if (addrs.some((a) => oauth.has(a))) connector = "gmail";
    const rawDir = m.direction as string | null;
    const direction = rawDir === "inbound" || rawDir === "outbound" ? rawDir : "unknown";
    return {
      tenant_id: tenantId,
      source_connector_id: connector,
      source_type: "email",
      source_table: "email_messages",
      source_id: m.id as string,
      source_external_id: (m.provider_message_id as string | null) ?? null,
      interaction_type: "email_message",
      direction,
      occurred_at:
        (m.received_at as string | null) ??
        (m.sent_at as string | null) ??
        (m.created_at as string),
      subject: (m.subject as string | null) ?? null,
      summary: null,
      body_preview: (m.snippet as string | null) ?? null,
      from_address: (m.from_email as string | null) ?? null,
      from_name: (m.from_name as string | null) ?? null,
      to_addresses: to,
      cc_addresses: cc,
      sentiment: null,
      related_thread_id: (m.provider_thread_id as string | null) ?? null,
      processing_status: "pending",
      metadata: { provider_thread_id: (m.provider_thread_id as string | null) ?? null, connector },
    };
  });

  // Upsert and capture ids — the selection returned only messages WITHOUT an
  // interaction, so every row is new. Publish interaction.ready for each so the
  // downstream identity → graph → card → recommendation enrichment fires promptly
  // (§9/§10); publishEvent is idempotent and best-effort.
  const { data: upserted, error: upErr } = await admin
    .from("interactions")
    .upsert(interactions, { onConflict: "tenant_id,source_table,source_id" })
    .select("id");
  if (upErr) throw new Error(`interactions upsert failed: ${upErr.message}`);
  for (const row of (upserted ?? []) as { id: string }[]) {
    await publishEvent(admin, {
      tenantId,
      eventType: "interaction.ready",
      subjectType: "interaction",
      subjectId: row.id,
      source: "interactions-sync:email",
    });
  }
  return interactions.length;
}

export async function handleInteractionsSync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: admin, tenantId, payload } = ctx;
  const source = payload.source === "phone" || payload.source === "email" ? payload.source : "all";
  const limit = clampLimit(payload.limit);

  try {
    let phone: ProjectionCounts = { selected: 0, created: 0, updated: 0 };
    let emailCreated = 0;
    if (source === "phone" || source === "all") {
      phone = await syncPhone(admin, tenantId, limit);
    }
    if (source === "email" || source === "all") {
      emailCreated = await syncEmail(admin, tenantId, limit);
    }
    // interactions_upserted = actual writes (selected phone + created email). In
    // steady state everything is 0 — unchanged rows are never selected/upserted.
    const phoneUpserted = phone.selected;
    const upserted = phoneUpserted + emailCreated;

    return {
      success: true,
      recordsProcessed: upserted,
      result: {
        // rich, incremental-aware counts (§8)
        phone_selected: phone.selected,
        phone_created: phone.created,
        phone_updated: phone.updated,
        phone_skipped: 0,
        email_selected: emailCreated,
        email_created: emailCreated,
        email_updated: 0,
        interactions_upserted: upserted,
        failed: 0,
        // back-compat totals (existing consumers keep working)
        phone_processed: phoneUpserted,
        email_processed: emailCreated,
        skipped: 0,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "interactions sync failed";
    return {
      success: false,
      error: { code: "sync_error", message: message.slice(0, 500), retryable: true },
    };
  }
}
