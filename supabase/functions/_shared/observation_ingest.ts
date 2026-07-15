// ServiceOS — Observation Ingest (PURE core of the interaction → intelligence bridge).
//
// The channel-neutral seam between the canonical `interactions` projection and the
// existing `intelligence.observe` pipeline. `interactions` is the UNIVERSAL inbound
// boundary: phone, email, chat, form and every future connector project into the same
// row, so this module maps an already-enriched interaction into a channel-neutral
// ObservationDraft that `intelligence.observe` consumes unchanged.
//
// PURITY: this module performs NO database, event, queue or network I/O and imports
// nothing impure. `buildObservationDraft` is a deterministic function of its inputs;
// `ingestInteractions` is an orchestrator whose every side effect is INJECTED (a
// pure-by-injection seam, mirroring scripts/verify/lib.ts::processJobStage) so the
// whole bridge is unit-testable with no infrastructure.
//
// HARD RULE: the pure core NEVER branches on channel. `source_type` (phone|email|…)
// travels only in provenance; it must not change the evaluation algorithm (subject
// construction, scores, domain, structure). Two interactions that differ only by
// channel produce drafts that differ only in provenance.

// ── Versioning ───────────────────────────────────────────────────────────────
// The mapper version is part of every idempotency key: one interaction maps to at
// most one logical Observation PER mapper version. Bump this only when the mapping
// changes in a way that should legitimately produce a new logical Observation.
export const MAPPER_VERSION = "obs-ingest/1";

// The horizontal default domain. `interactions` carry no domain; the bridge stays
// channel- and customer-neutral by defaulting to the universal "core" domain pack
// (the decision engine always loads core policies). A caller may override per tenant.
export const DEFAULT_INGEST_DOMAIN = "core";

// Interactions the bridge will map. Deliberately narrow: only fully-enriched rows
// (identity + context resolved) are eligible, so historical/unenriched rows are never
// swept in implicitly — a backfill must pass explicit ids.
export const ELIGIBLE_PROCESSING_STATUSES: ReadonlySet<string> = new Set(["enriched"]);

export const OBSERVATION_CREATED_FROM = "intelligence.ingest_interaction";
export const OBSERVE_JOB_TYPE = "intelligence.observe";

// ── Normalised inputs (facts only; the caller resolves these tenant-scoped) ───

/** The connector-agnostic interaction facts the mapper needs. Channel lives in
 *  `source_type` and is provenance ONLY. */
export interface IngestInteraction {
  id: string;
  tenant_id: string;
  source_type: string | null; // phone | email | chat | form | … (provenance only)
  source_connector_id: string | null;
  source_table: string | null;
  source_id: string | null;
  source_external_id: string | null;
  interaction_type: string | null;
  direction: string | null; // inbound | outbound | internal | unknown
  processing_status: string | null;
  occurred_at: string | null;
  subject: string | null;
  summary: string | null;
  body_preview: string | null;
  from_name: string | null;
  from_address: string | null;
  sentiment: string | null;
  priority: string | null;
  related_person_id: string | null;
  related_company_id: string | null;
}

/** The resolved customer-card business context (from customer_cards.context.projection
 *  and the card row). Absent when the customer is not yet known — represented as null,
 *  never fabricated. */
export interface CardContext {
  tenant_id: string;
  title: string | null;
  summary: string | null;
  status: string | null;
  priority: string | null;
  priority_score: number | null;
  confidence: number | null;
  recommended_action: string | null;
}

export interface IngestBuildInput {
  tenantId: string;
  interaction: IngestInteraction;
  /** Business context; null when the customer is unresolved (honest absence). */
  customerCardContext: CardContext | null;
  /** graph_nodes.id for the interaction + resolved person/company (may be empty). */
  graphNodeRefs: string[];
  mapperVersion: string;
  domain: string;
}

// ── The ObservationDraft (exactly the shape intelligence.observe consumes) ─────
export interface ObservationDraft {
  domain: string;
  subject: string;
  severity: string | null;
  confidence: number;
  ambiguity: number;
  risk: number;
  reversibility: number;
  source_interactions: string[];
  source_entities: string[];
  evidence: Array<Record<string, unknown>>;
  attributes: Record<string, unknown>;
  created_from: string;
}

export class IngestTenantMismatchError extends Error {
  readonly expectedTenant: string;
  readonly actualTenant: string;
  readonly ref: string;
  constructor(expectedTenant: string, actualTenant: string, ref: string) {
    super(`cross-tenant ${ref}: expected ${expectedTenant}, got ${actualTenant}`);
    this.name = "IngestTenantMismatchError";
    this.expectedTenant = expectedTenant;
    this.actualTenant = actualTenant;
    this.ref = ref;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Deterministic per-interaction, per-mapper-version ingestion key (the ledger key). */
export function ingestKey(tenantId: string, interactionId: string, mapperVersion: string): string {
  return `ingest:${tenantId}:${interactionId}:${mapperVersion}`;
}

/** Deterministic queue key for the observe job — active-key dedup collapses retries
 *  to one active job; combined with the ledger it is exactly-once per mapper version. */
export function observeJobKey(
  tenantId: string,
  interactionId: string,
  mapperVersion: string,
): string {
  return `${OBSERVE_JOB_TYPE}:${tenantId}:${interactionId}:${mapperVersion}`;
}

/** Pure eligibility predicate — enriched interactions only (channel-independent). */
export function isEligibleForIngest(interaction: { processing_status: string | null }): boolean {
  return (
    interaction.processing_status != null &&
    ELIGIBLE_PROCESSING_STATUSES.has(interaction.processing_status)
  );
}

/**
 * Map an enriched interaction + its resolved context into a channel-neutral
 * ObservationDraft. Deterministic: same inputs → deep-equal output. Fabricates
 * nothing — missing context is represented as explicit nulls/empties. Rejects
 * cross-tenant references. Scores are derived transparently from PRESENCE of
 * resolution/context (never from channel), and any confidence carried by the card
 * is preserved in preference to a derived value.
 */
export function buildObservationDraft(input: IngestBuildInput): ObservationDraft {
  const i = input.interaction;
  if (i.tenant_id !== input.tenantId) {
    throw new IngestTenantMismatchError(input.tenantId, i.tenant_id, `interaction ${i.id}`);
  }
  if (input.customerCardContext && input.customerCardContext.tenant_id !== input.tenantId) {
    throw new IngestTenantMismatchError(
      input.tenantId,
      input.customerCardContext.tenant_id,
      "customer_card",
    );
  }

  const resolved = !!i.related_person_id || !!i.related_company_id;
  const channel = i.source_type ?? "unknown";
  const who = i.from_name || i.from_address || "an unknown contact";
  const line = i.subject || i.summary || i.body_preview || "(no content)";
  // Subject is channel-labelled provenance around channel-neutral content; the
  // *shape* is identical across channels.
  const subject = `Inbound ${channel} from ${who}: ${truncate(line, 140)}`;

  // Scores derived from PRESENCE only — no channel branch, no fabricated signal.
  // A card confidence, when present, is preserved over the derived value (req 10).
  const derivedConfidence = resolved ? 0.7 : 0.5;
  const confidence = clamp01(input.customerCardContext?.confidence ?? derivedConfidence);
  const ambiguity = clamp01(resolved ? 0.2 : 0.5);
  const risk = 0.2; // an inbound observation proposes nothing external yet
  const reversibility = 0.9; // any downstream response is a reversible internal note

  // Evidence = references to the facts, never fabricated content.
  const evidence: Array<Record<string, unknown>> = [
    {
      ref: "interaction",
      interaction_id: i.id,
      source_table: i.source_table,
      source_id: i.source_id,
      source_external_id: i.source_external_id,
      occurred_at: i.occurred_at,
    },
  ];
  if (i.sentiment) evidence.push({ ref: "sentiment", value: i.sentiment });
  if (input.customerCardContext?.recommended_action) {
    evidence.push({
      ref: "customer_card",
      recommended_action: input.customerCardContext.recommended_action,
    });
  }

  const attributes: Record<string, unknown> = {
    // Provenance — channel + source references retained here (never in the algorithm).
    channel,
    direction: i.direction ?? "unknown",
    source: {
      connector_id: i.source_connector_id,
      source_type: i.source_type,
      source_table: i.source_table,
      source_id: i.source_id,
      source_external_id: i.source_external_id,
      interaction_type: i.interaction_type,
    },
    // Resolution — honest about what is/ isn't known.
    resolution: {
      resolved,
      person_id: i.related_person_id,
      company_id: i.related_company_id,
    },
    // Business context — null (not {}) when unresolved, so absence is explicit.
    customer_context: input.customerCardContext
      ? {
          title: input.customerCardContext.title,
          summary: input.customerCardContext.summary,
          status: input.customerCardContext.status,
          priority: input.customerCardContext.priority,
          priority_score: input.customerCardContext.priority_score,
        }
      : null,
    graph_context: { entity_node_count: input.graphNodeRefs.length },
    // Domain-neutral authority block: an inbound observation requests no delegated
    // financial authority and needs no explicit customer approval to be evaluated.
    authority: { type: "none", delegated: true, explicit_customer_approval: false },
    // Ingestion lineage for provenance/audit.
    ingest: {
      mapper_version: input.mapperVersion,
      ingest_key: ingestKey(input.tenantId, i.id, input.mapperVersion),
      source_type: i.source_type,
    },
  };

  return {
    domain: input.domain,
    subject,
    severity: i.priority ?? input.customerCardContext?.priority ?? null,
    confidence,
    ambiguity,
    risk,
    reversibility,
    source_interactions: [i.id],
    source_entities: [...input.graphNodeRefs],
    evidence,
    attributes,
    created_from: OBSERVATION_CREATED_FROM,
  };
}

// ── Pure-by-injection orchestrator ────────────────────────────────────────────
// Every side effect is an injected dependency, so the concurrency/idempotency model
// is fully testable without a database or queue. The impure handler wires these to
// Supabase; tests wire fakes.

/** The durable ledger row that atomically records one ingestion. */
export interface IngestionLedgerRow {
  id: string;
  observe_job_id: string | null;
}

export interface IngestDeps {
  /** Load the interaction, ALREADY tenant-scoped (returns null if not this tenant). */
  loadInteraction(interactionId: string): Promise<IngestInteraction | null>;
  /** Load the resolved customer card context, tenant-scoped (null when unresolved). */
  loadCardContext(personId: string | null, companyId: string | null): Promise<CardContext | null>;
  /** Load graph_nodes.id for interaction/person/company, tenant-scoped (may be []). */
  loadGraphNodeRefs(interaction: IngestInteraction): Promise<string[]>;
  /**
   * Atomically CLAIM the ingestion by inserting the ledger row. Returns
   * `{ claimed: true, row }` for the single winner; on a unique-constraint conflict
   * returns `{ claimed: false, row }` with the existing row (the loser reuses it).
   */
  claimIngestion(args: {
    tenantId: string;
    interactionId: string;
    mapperVersion: string;
    ingestKey: string;
    observeJobKey: string;
    domain: string;
  }): Promise<{ claimed: boolean; row: IngestionLedgerRow | null }>;
  /** Durable recovery: find an already-enqueued observe job by its deterministic key
   *  (ANY status), closing the crash window between claim and enqueue. */
  findObserveJobByKey(observeJobKey: string): Promise<string | null>;
  /** Enqueue the observe job idempotently (active-key dedup). */
  enqueueObserve(args: {
    observeJobKey: string;
    draft: ObservationDraft;
    interactionId: string;
  }): Promise<{ jobId: string | null; duplicate: boolean }>;
  /** Record the observe job id back onto the ledger row (best-effort lineage). */
  recordObserveJob(ingestionId: string, observeJobId: string): Promise<void>;
}

export type IngestOutcome =
  | "observed" // newly claimed + observe enqueued
  | "reused" // ledger already existed; existing/recovered observe job returned
  | "rejected"; // not found / cross-tenant / not eligible / error

export interface IngestResult {
  interactionId: string;
  outcome: IngestOutcome;
  idempotent: boolean;
  ingestionId: string | null;
  observeJobId: string | null;
  observeJobType: string; // always intelligence.observe — never a direct evaluation
  channel: string | null;
  reason?: string;
}

export interface IngestBatchResult {
  processed: number;
  observed: number;
  reused: number;
  rejected: number;
  results: IngestResult[];
}

export interface IngestOptions {
  tenantId: string;
  interactionIds: string[];
  mapperVersion?: string;
  domain?: string;
  /** Hard cap on the bounded batch — historical rows are never swept implicitly. */
  maxBatch?: number;
}

export const DEFAULT_MAX_BATCH = 25;

/**
 * Ingest an EXPLICIT, bounded set of interaction ids into the observe pipeline.
 *
 * Idempotency / concurrency model:
 *  • The ledger unique key (tenant, interaction, mapper_version) is an ATOMIC claim:
 *    exactly one worker wins the insert; concurrent/retry callers get claimed:false
 *    and REUSE the existing row (reqs 1–3).
 *  • The observe job key is deterministic, so the queue's active-key dedup collapses
 *    duplicates; on the narrow claim→enqueue crash window the durable
 *    findObserveJobByKey (any status) recovers the existing job instead of creating a
 *    second Observation.
 *  • Cross-tenant interactions/cards are rejected (req 4); tenant-scoped loaders make
 *    entity references impossible to leak across tenants.
 *  • Only the ids passed here are touched — nothing is swept implicitly (reqs 5, 11).
 *  • Every id is handled in isolation; one failure never aborts the batch (reqs 6, 12).
 *  • The bridge only ENQUEUES intelligence.observe; it never evaluates directly and
 *    never creates an automation intent (reqs 13, 14).
 */
export async function ingestInteractions(
  deps: IngestDeps,
  opts: IngestOptions,
): Promise<IngestBatchResult> {
  const mapperVersion = opts.mapperVersion ?? MAPPER_VERSION;
  const domain = opts.domain ?? DEFAULT_INGEST_DOMAIN;
  const cap = Math.max(1, opts.maxBatch ?? DEFAULT_MAX_BATCH);
  const ids = opts.interactionIds.slice(0, cap); // bounded — never the full history

  const results: IngestResult[] = [];
  for (const interactionId of ids) {
    results.push(await ingestOne(deps, opts.tenantId, interactionId, mapperVersion, domain));
  }

  const observed = results.filter((r) => r.outcome === "observed").length;
  const reused = results.filter((r) => r.outcome === "reused").length;
  const rejected = results.filter((r) => r.outcome === "rejected").length;
  return { processed: results.length, observed, reused, rejected, results };
}

function reject(interactionId: string, reason: string, channel: string | null): IngestResult {
  return {
    interactionId,
    outcome: "rejected",
    idempotent: false,
    ingestionId: null,
    observeJobId: null,
    observeJobType: OBSERVE_JOB_TYPE,
    channel,
    reason,
  };
}

async function ingestOne(
  deps: IngestDeps,
  tenantId: string,
  interactionId: string,
  mapperVersion: string,
  domain: string,
): Promise<IngestResult> {
  try {
    const interaction = await deps.loadInteraction(interactionId);
    if (!interaction) return reject(interactionId, "not_found_or_cross_tenant", null);
    // Defence in depth even though the loader is tenant-scoped (req 4).
    if (interaction.tenant_id !== tenantId) {
      return reject(interactionId, "cross_tenant", interaction.source_type);
    }
    if (!isEligibleForIngest(interaction)) {
      return reject(interactionId, "not_eligible", interaction.source_type);
    }

    const key = ingestKey(tenantId, interactionId, mapperVersion);
    const jobKey = observeJobKey(tenantId, interactionId, mapperVersion);

    const claim = await deps.claimIngestion({
      tenantId,
      interactionId,
      mapperVersion,
      ingestKey: key,
      observeJobKey: jobKey,
      domain,
    });

    // ── REUSE PATH: the ledger already existed (retry or concurrent loser). ──────
    if (!claim.claimed) {
      const row = claim.row;
      if (row?.observe_job_id) {
        return reused(interactionId, row.id, row.observe_job_id, interaction.source_type);
      }
      // Ledger exists but the observe job id is not recorded — recover the durable
      // job by its deterministic key BEFORE ever enqueueing a second one.
      const recovered = await deps.findObserveJobByKey(jobKey);
      if (recovered) {
        if (row) await deps.recordObserveJob(row.id, recovered);
        return reused(interactionId, row?.id ?? null, recovered, interaction.source_type);
      }
      // Truly orphaned (crashed before the first enqueue) → enqueue now, idempotently.
      const draft = await buildDraft(deps, tenantId, interaction, mapperVersion, domain);
      const enq = await deps.enqueueObserve({ observeJobKey: jobKey, draft, interactionId });
      if (row && enq.jobId) await deps.recordObserveJob(row.id, enq.jobId);
      return reused(interactionId, row?.id ?? null, enq.jobId, interaction.source_type);
    }

    // ── CLAIM PATH: we are the single winner → build + enqueue exactly once. ─────
    const draft = await buildDraft(deps, tenantId, interaction, mapperVersion, domain);
    const enq = await deps.enqueueObserve({ observeJobKey: jobKey, draft, interactionId });
    const ingestionId = claim.row?.id ?? null;
    if (ingestionId && enq.jobId) await deps.recordObserveJob(ingestionId, enq.jobId);
    return {
      interactionId,
      outcome: "observed",
      idempotent: false,
      ingestionId,
      observeJobId: enq.jobId,
      observeJobType: OBSERVE_JOB_TYPE,
      channel: interaction.source_type,
    };
  } catch (e) {
    // Failure-isolated: one bad record never aborts the bounded batch (req 6/12).
    return reject(interactionId, e instanceof Error ? e.message.slice(0, 200) : "error", null);
  }
}

async function buildDraft(
  deps: IngestDeps,
  tenantId: string,
  interaction: IngestInteraction,
  mapperVersion: string,
  domain: string,
): Promise<ObservationDraft> {
  const card = await deps.loadCardContext(
    interaction.related_person_id,
    interaction.related_company_id,
  );
  const graphNodeRefs = await deps.loadGraphNodeRefs(interaction);
  return buildObservationDraft({
    tenantId,
    interaction,
    customerCardContext: card,
    graphNodeRefs,
    mapperVersion,
    domain,
  });
}

function reused(
  interactionId: string,
  ingestionId: string | null,
  observeJobId: string | null,
  channel: string | null,
): IngestResult {
  return {
    interactionId,
    outcome: "reused",
    idempotent: true,
    ingestionId,
    observeJobId,
    observeJobType: OBSERVE_JOB_TYPE,
    channel,
  };
}
