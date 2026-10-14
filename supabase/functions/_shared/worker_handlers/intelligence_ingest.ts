import { retainedSourceContext } from "../observation_source_context.ts";
// ServiceOS — Worker handler: intelligence.ingest_interaction
//
// The impure shell of the interaction → intelligence bridge. It processes an EXPLICIT,
// bounded set of interaction ids (never a history sweep), verifies tenant ownership,
// requires enrichment or independently proven retained-source context, loads the customer-card + graph
// context tenant-scoped, and hands everything to the PURE mapper
// (../observation_ingest.ts) which produces a channel-neutral ObservationDraft. It then
// ENQUEUES the existing `intelligence.observe` job — it never evaluates a Decision
// itself and never creates an Automation Intent. Idempotency/concurrency are enforced by
// the append `intelligence_ingestions` ledger (atomic claim) plus the deterministic
// observe job key (queue active-key dedup). See docs/INTELLIGENCE_INGEST_BRIDGE.md.

import type { WorkerHandlerContext, WorkerHandlerResult } from "../worker_contract.ts";
import { enqueueJob } from "../platform_queue.ts";
import {
  DEFAULT_INGEST_DOMAIN,
  DEFAULT_MAX_BATCH,
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
  "id, tenant_id, source_type, source_connector_id, source_table, source_id, source_external_id, interaction_type, direction, processing_status, occurred_at, subject, summary, body_preview, from_name, from_address, sentiment, priority, related_person_id, related_company_id, related_job_id, updated_at, metadata";

function parseIds(payload: Record<string, unknown> | null | undefined): string[] {
  if (!payload) return [];
  const single = payload.interaction_id;
  const many = payload.interaction_ids;
  const out: string[] = [];
  if (single !== undefined) {
    if (typeof single !== "string" || !single) return [];
    out.push(single.toLowerCase());
  }
  if (many !== undefined) {
    if (!Array.isArray(many) || many.some((v) => typeof v !== "string" || !v)) return [];
    out.push(...many.map((v) => v.toLowerCase()));
  }
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
  if (error && error.code !== "23505") throw new Error("eligibility_audit_unconfirmed");
  if (error) {
    const existing = await db
      .from("intelligence_ingestions")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("interaction_id", interactionId)
      .eq("mapper_version", mapperVersion)
      .maybeSingle();
    if (existing.error || !existing.data?.id) throw new Error("eligibility_audit_unconfirmed");
  }
}

export async function handleIntelligenceIngest(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: db, tenantId, payload } = ctx;
  const ids = parseIds(payload);
  if (
    ids.length === 0 ||
    ids.length > DEFAULT_MAX_BATCH ||
    ids.some((id) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
  ) {
    return {
      success: false,
      error: {
        code: "invalid_payload",
        message: "Provide between 1 and 25 distinct interaction UUIDs",
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

  try {
    // ── ELIGIBILITY (Phase 2): decide per interaction whether it becomes intelligence.
    // Load the candidates once, apply the pure decision, record ineligible ones as `skipped`
    // (audited), and only pass the eligible ids into the (unchanged) idempotent bridge.
    const { data: loaded, error: loadError } = await db
      .from("interactions")
      .select(INTERACTION_COLUMNS)
      .in("id", ids)
      .eq("tenant_id", tenantId);
    if (loadError || !Array.isArray(loaded)) throw new Error("interaction_inventory_unconfirmed");
    // Qualification is read from an authenticated database function, never payload
    // or source metadata. Recheck it on the second read before ledger/queue work.
    async function qualify(row: IngestInteraction): Promise<IngestInteraction> {
      const clean = { ...row, retainedSourceContext: undefined };
      if (
        clean.processing_status !== "identity_review" ||
        clean.source_connector_id !== "slack" ||
        clean.source_table !== "slack_messages" ||
        clean.interaction_type !== "slack_message"
      )
        return clean;
      const proof = await db.rpc("learn_public_slack_observation_context", {
        p_tenant: tenantId,
        p_interaction: clean.id,
      });
      if (proof.error) throw new Error("retained_source_context_unconfirmed");
      if (proof.data == null) return clean;
      const qualified = { ...clean, retainedSourceContext: proof.data };
      if (!retainedSourceContext(qualified)) throw new Error("retained_source_context_changed");
      return qualified;
    }
    const rows = loaded as IngestInteraction[];
    if (
      rows.some((row) => row.tenant_id !== tenantId || !ids.includes(row.id)) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    )
      throw new Error("interaction_inventory_unconfirmed");
    for (let index = 0; index < rows.length; index++) rows[index] = await qualify(rows[index]);
    async function loadConfirmed(interactionId: string): Promise<IngestInteraction | null> {
      const { data, error } = await db
        .from("interactions")
        .select(INTERACTION_COLUMNS)
        .eq("id", interactionId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw new Error("interaction_read_unconfirmed");
      const fresh = data ? await qualify(data as IngestInteraction) : null;
      const prior = rows.find((row) => row.id === interactionId)?.retainedSourceContext;
      if (
        prior &&
        (!fresh ||
          !retainedSourceContext(fresh) ||
          !retainedSourceContext({ ...fresh, retainedSourceContext: prior }))
      )
        throw new Error("retained_source_context_changed");
      return fresh;
    }
    const unavailable = ids.filter((id) => !rows.some((row) => row.id === id));
    const waiting = rows.filter((row) => !isEligibleForIngest(row)).map((row) => row.id);
    const eligibility = new Map<string, EligibilityDecision>();
    const eligibleIds: string[] = [];
    let skipped = 0;
    for (const it of rows) {
      if (!isEligibleForIngest(it)) continue; // Leave unresolved, unproven sources untouched.
      const decision = shouldCreateIntelligence(it);
      if (decision.eligible) {
        eligibility.set(it.id, decision);
        eligibleIds.push(it.id);
      } else {
        // Even a skip is durable: do not acknowledge it after proof withdrawal
        // or a newer source revision appeared between reads.
        if (it.retainedSourceContext) await loadConfirmed(it.id);
        await recordSkip(db, tenantId, it.id, mapperVersion, domain, decision);
        skipped += 1;
      }
    }

    const deps: IngestDeps = {
      // Tenant-scoped load — a cross-tenant id simply returns null (never leaks).
      loadInteraction: loadConfirmed,
      loadCardContext: async (personId, companyId) => {
        if (!personId && !companyId) return null;
        const filters: string[] = [];
        if (personId) filters.push(`person_id.eq.${personId}`);
        if (companyId) filters.push(`company_id.eq.${companyId}`);
        const { data, error } = await db
          .from("customer_cards")
          .select(
            "tenant_id, title, summary, status, priority, priority_score, confidence, recommended_action",
          )
          .eq("tenant_id", tenantId)
          .or(filters.join(","))
          .order("latest_activity_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error("card_context_read_unconfirmed");
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
        const { data, error } = await db
          .from("graph_nodes")
          .select("id, source_table, source_id")
          .eq("tenant_id", tenantId)
          .in(
            "source_id",
            pairs.map((p) => p.id),
          );
        if (error || !Array.isArray(data)) throw new Error("graph_context_read_unconfirmed");
        const rows = data as Array<{ id: string; source_table: string; source_id: string }>;
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
          .select("id, observe_job_id, status")
          .single();
        if (!error && data) {
          return {
            claimed: true,
            row: {
              id: data.id as string,
              observe_job_id: (data.observe_job_id as string) ?? null,
              status: data.status,
            },
          };
        }
        if (error && (error as { code?: string }).code === "23505") {
          const { data: existing, error: existingError } = await db
            .from("intelligence_ingestions")
            .select("id, observe_job_id, status")
            .eq("tenant_id", args.tenantId)
            .eq("interaction_id", args.interactionId)
            .eq("mapper_version", args.mapperVersion)
            .maybeSingle();
          if (existingError || !existing) throw new Error("ingestion_claim_unconfirmed");
          return {
            claimed: false,
            row: existing
              ? {
                  id: existing.id as string,
                  status: existing.status,
                  observe_job_id: (existing.observe_job_id as string) ?? null,
                }
              : null,
          };
        }
        throw new Error("ingestion_claim_unconfirmed");
      },
      // Durable recovery by the deterministic key (ANY status) — closes the claim→enqueue
      // crash window on a serial retry without creating another observe job.
      findObserveJobByKey: async (jobKey) => {
        const { data, error } = await db
          .from("platform_jobs")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("job_key", jobKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error("observe_job_lookup_unconfirmed");
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
        const saved = await db
          .from("intelligence_ingestions")
          .update({ observe_job_id: observeJobId, updated_at: new Date().toISOString() })
          .eq("id", ingestionId)
          .eq("tenant_id", tenantId)
          .select("id, observe_job_id")
          .single();
        if (
          saved.error ||
          saved.data?.id !== ingestionId ||
          saved.data?.observe_job_id !== observeJobId
        )
          throw new Error("observe_lineage_unconfirmed");
      },
    };

    const batch = await ingestInteractions(deps, {
      tenantId,
      interactionIds: eligibleIds,
      mapperVersion,
      domain,
    });
    const incomplete = batch.rejected > 0 || unavailable.length > 0 || waiting.length > 0;
    return {
      success: !incomplete,
      recordsProcessed: batch.observed + batch.reused,
      result: {
        ...batch,
        skipped: skipped + batch.skipped,
        unavailable,
        waiting,
        stage: "observe_job_linked",
        requested: ids.length,
      } as unknown as Record<string, unknown>,
      ...(incomplete
        ? {
            error: {
              code: "ingest_incomplete",
              message:
                "Some retained interactions could not reach the analysis queue. Inspect the recorded outcomes.",
              retryable: batch.results.some((result) => result.retryable) || waiting.length > 0,
            },
          }
        : {}),
    };
  } catch {
    return {
      success: false,
      error: {
        code: "ingest_error",
        message:
          "Analysis hand-off could not be confirmed. Retained source data remains available.",
        retryable: true,
      },
    };
  }
}
