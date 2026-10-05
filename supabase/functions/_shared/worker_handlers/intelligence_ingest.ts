// ServiceOS — Worker handler: intelligence.ingest_interaction
//
// The impure shell of the interaction → intelligence bridge. It processes an EXPLICIT,
// bounded set of interaction ids (never a history sweep), verifies tenant ownership,
// requires the interaction to be enriched, loads the resolved customer-card + graph
// context tenant-scoped, and hands everything to the PURE mapper
// (../observation_ingest.ts) which produces a channel-neutral ObservationDraft. It then
// ENQUEUES the existing `intelligence.observe` job — it never evaluates a Decision
// itself and never creates an Automation Intent. Idempotency/concurrency are enforced by
// the append `intelligence_ingestions` ledger (atomic claim) plus the deterministic
// observe job key (queue active-key dedup). See docs/INTELLIGENCE_INGEST_BRIDGE.md.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { enqueueJob } from "../platform_queue.ts";
import {
  DEFAULT_INGEST_DOMAIN,
  MAPPER_VERSION,
  OBSERVE_JOB_TYPE,
  ingestInteractions,
  ingestKey,
  isEligibleForIngest,
  type CardContext,
  type IngestDeps,
  type IngestInteraction,
} from "../observation_ingest.ts";
import { shouldCreateIntelligence, type EligibilityDecision } from "../intelligence/eligibility.ts";

const INTERACTION_COLUMNS =
  "id, tenant_id, source_type, source_connector_id, source_table, source_id, source_external_id, " +
  "interaction_type, direction, processing_status, occurred_at, subject, summary, body_preview, " +
  "from_name, from_address, sentiment, priority, related_person_id, related_company_id";

function parseIds(payload: Record<string, unknown> | null | undefined): string[] {
  if (!payload) return [];
  const single = payload.interaction_id;
  const many = payload.interaction_ids;
  const out: string[] = [];
  if (typeof single === "string" && single) out.push(single);
  if (Array.isArray(many)) for (const v of many) if (typeof v === "string" && v) out.push(v);
  // Dedup while preserving order.
  return [...new Set(out)];
}

/** Record an INELIGIBLE interaction's decision in the ledger (audited + idempotent) so it
 *  is never re-evaluated for this mapper version and never becomes an intelligence object.
 *  Uses the same atomic (tenant, interaction, mapper_version) claim — a 23505 conflict means
 *  it was already decided (observed or skipped), so this is a no-op. */
async function recordSkip(
  db: WorkerHandlerContext["supabaseAdmin"],
  tenantId: string,
  interactionId: string,
  mapperVersion: string,
  domain: string,
  decision: EligibilityDecision,
): Promise<void> {
  const { error } = await db.from("intelligence_ingestions").insert({
    tenant_id: tenantId,
    interaction_id: interactionId,
    mapper_version: mapperVersion,
    ingest_key: ingestKey(tenantId, interactionId, mapperVersion),
    domain,
    status: "skipped",
    eligibility_reason: decision.reason,
    eligibility_confidence: decision.confidence,
  });
  if (error && (error as { code?: string }).code !== "23505") {
    // best-effort audit; a genuine write failure must not fail the whole batch.
  }
}

export async function handleIntelligenceIngest(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: db, tenantId, payload } = ctx;
  const ids = parseIds(payload);
  if (ids.length === 0) {
    return {
      success: false,
      error: {
        code: "invalid_payload",
        message: "payload {interaction_id | interaction_ids[]} required",
        retryable: false,
      },
    };
  }
  const mapperVersion =
    typeof payload?.mapper_version === "string" && payload.mapper_version
      ? (payload.mapper_version as string)
      : MAPPER_VERSION;
  const domain =
    typeof payload?.domain === "string" && payload.domain
      ? (payload.domain as string)
      : DEFAULT_INGEST_DOMAIN;

  // ── ELIGIBILITY (Phase 2): decide per interaction whether it becomes intelligence.
  // Load the candidates once, apply the pure decision, record ineligible ones as `skipped`
  // (audited), and only pass the eligible ids into the (unchanged) idempotent bridge.
  const { data: loaded } = await db
    .from("interactions")
    .select(INTERACTION_COLUMNS)
    .in("id", ids)
    .eq("tenant_id", tenantId);
  const rows = (loaded ?? []) as IngestInteraction[];
  const eligibility = new Map<string, EligibilityDecision>();
  const eligibleIds: string[] = [];
  let skipped = 0;
  for (const it of rows) {
    if (!isEligibleForIngest(it)) continue; // lifecycle gate — not enriched yet, leave it
    const decision = shouldCreateIntelligence(it);
    if (decision.eligible) {
      eligibility.set(it.id, decision);
      eligibleIds.push(it.id);
    } else {
      await recordSkip(db, tenantId, it.id, mapperVersion, domain, decision);
      skipped += 1;
    }
  }

  const deps: IngestDeps = {
    // Tenant-scoped load — a cross-tenant id simply returns null (never leaks).
    loadInteraction: async (interactionId) => {
      const { data } = await db
        .from("interactions")
        .select(INTERACTION_COLUMNS)
        .eq("id", interactionId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return (data as IngestInteraction | null) ?? null;
    },
    loadCardContext: async (personId, companyId) => {
      if (!personId && !companyId) return null;
      const filters: string[] = [];
      if (personId) filters.push(`person_id.eq.${personId}`);
      if (companyId) filters.push(`company_id.eq.${companyId}`);
      const { data } = await db
        .from("customer_cards")
        .select(
          "tenant_id, title, summary, status, priority, priority_score, confidence, recommended_action",
        )
        .eq("tenant_id", tenantId)
        .or(filters.join(","))
        .order("latest_activity_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as CardContext | null) ?? null;
    },
    // Resolve the interaction + person + company graph node ids, tenant-scoped. Each
    // (source_table, source_id) pair is matched exactly so nothing is mis-associated.
    loadGraphNodeRefs: async (interaction) => {
      const pairs: Array<{ table: string; id: string }> = [
        { table: "interactions", id: interaction.id },
      ];
      if (interaction.related_person_id)
        pairs.push({ table: "people", id: interaction.related_person_id });
      if (interaction.related_company_id)
        pairs.push({ table: "companies", id: interaction.related_company_id });
      const { data } = await db
        .from("graph_nodes")
        .select("id, source_table, source_id")
        .eq("tenant_id", tenantId)
        .in(
          "source_id",
          pairs.map((p) => p.id),
        );
      const rows = (data ?? []) as Array<{ id: string; source_table: string; source_id: string }>;
      const wanted = new Set(pairs.map((p) => `${p.table}:${p.id}`));
      return rows.filter((r) => wanted.has(`${r.source_table}:${r.source_id}`)).map((r) => r.id);
    },
    // Atomic claim: the ledger's unique (tenant, interaction, mapper_version) makes the
    // first inserter the single owner; a conflict (23505) returns the existing row.
    claimIngestion: async (args) => {
      const { data, error } = await db
        .from("intelligence_ingestions")
        .insert({
          tenant_id: args.tenantId,
          interaction_id: args.interactionId,
          mapper_version: args.mapperVersion,
          ingest_key: args.ingestKey,
          domain: args.domain,
          status: "enqueued",
          // Provenance/explainability: why this interaction was deemed intelligence-worthy.
          eligibility_reason: eligibility.get(args.interactionId)?.reason ?? null,
          eligibility_confidence: eligibility.get(args.interactionId)?.confidence ?? null,
        })
        .select("id, observe_job_id")
        .single();
      if (!error && data) {
        return {
          claimed: true,
          row: { id: data.id as string, observe_job_id: (data.observe_job_id as string) ?? null },
        };
      }
      if (error && (error as { code?: string }).code === "23505") {
        const { data: existing } = await db
          .from("intelligence_ingestions")
          .select("id, observe_job_id")
          .eq("tenant_id", args.tenantId)
          .eq("interaction_id", args.interactionId)
          .eq("mapper_version", args.mapperVersion)
          .maybeSingle();
        return {
          claimed: false,
          row: existing
            ? {
                id: existing.id as string,
                observe_job_id: (existing.observe_job_id as string) ?? null,
              }
            : null,
        };
      }
      throw new Error(`ledger claim failed: ${error?.message ?? "unknown"}`);
    },
    // Durable recovery by the deterministic key (ANY status) — closes the claim→enqueue
    // crash window without ever creating a second observe job.
    findObserveJobByKey: async (jobKey) => {
      const { data } = await db
        .from("platform_jobs")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("job_key", jobKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
    enqueueObserve: async ({ observeJobKey, draft }) => {
      const res = await enqueueJob(db, {
        tenantId,
        jobType: OBSERVE_JOB_TYPE,
        jobKey: observeJobKey,
        connectorId: "openfolk-core",
        moduleId: "core.intelligence",
        payload: { observation: draft },
      });
      return { jobId: res.id, duplicate: res.duplicate };
    },
    recordObserveJob: async (ingestionId, observeJobId) => {
      await db
        .from("intelligence_ingestions")
        .update({ observe_job_id: observeJobId, updated_at: new Date().toISOString() })
        .eq("id", ingestionId)
        .eq("tenant_id", tenantId);
    },
  };

  try {
    const batch = await ingestInteractions(deps, {
      tenantId,
      interactionIds: eligibleIds,
      mapperVersion,
      domain,
    });
    return {
      success: true,
      recordsProcessed: batch.observed + batch.reused,
      result: { ...batch, skipped } as unknown as Record<string, unknown>,
    };
  } catch (e) {
    return {
      success: false,
      error: {
        code: "ingest_error",
        message: e instanceof Error ? e.message.slice(0, 500) : "ingest failed",
        retryable: true,
      },
    };
  }
}
