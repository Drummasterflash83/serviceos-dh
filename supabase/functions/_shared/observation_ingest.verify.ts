// Unit tests for the PURE observation-ingest bridge core. No DB, no queue, no network
// — every effect is injected. Run: node supabase/functions/_shared/observation_ingest.verify.ts

import {
  DEFAULT_MAX_BATCH,
  IngestTenantMismatchError,
  MAPPER_VERSION,
  OBSERVATION_CREATED_FROM,
  OBSERVE_JOB_TYPE,
  buildObservationDraft,
  ingestInteractions,
  ingestKey,
  isEligibleForIngest,
  observeJobKey,
  type CardContext,
  type IngestDeps,
  type IngestInteraction,
} from "./observation_ingest.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const T = "00000000-0000-0000-0000-000000000001";
const OTHER_T = "00000000-0000-0000-0000-0000000000ff";

// Two interactions IDENTICAL except channel + source references (email vs phone).
function emailInteraction(over: Partial<IngestInteraction> = {}): IngestInteraction {
  return {
    id: "int-email",
    tenant_id: T,
    source_type: "email",
    source_connector_id: "google-workspace",
    source_table: "email_messages",
    source_id: "em-1",
    source_external_id: "gmail-abc",
    interaction_type: "email_message",
    direction: "inbound",
    processing_status: "enriched",
    occurred_at: "2026-07-15T09:00:00Z",
    subject: "Boiler quote please",
    summary: "Customer asked for a boiler quote",
    body_preview: "Hi, could you quote a new boiler?",
    from_name: "Ann Example",
    from_address: "ann@acme.co.uk",
    sentiment: "neutral",
    priority: "medium",
    related_person_id: "person-1",
    related_company_id: "company-1",
    ...over,
  };
}
function phoneInteraction(over: Partial<IngestInteraction> = {}): IngestInteraction {
  return {
    ...emailInteraction(),
    id: "int-phone",
    source_type: "phone",
    source_connector_id: "simwood",
    source_table: "phone_calls",
    source_id: "pc-1",
    source_external_id: "call-xyz",
    interaction_type: "phone_call",
    from_address: null,
    ...over,
  };
}

const card: CardContext = {
  tenant_id: T,
  title: "Ann Example — Acme",
  summary: "Repeat customer, boiler enquiry",
  status: "active",
  priority: "medium",
  priority_score: 42,
  confidence: 0.66,
  recommended_action: "respond_to_customer",
};

// ── Pure builder: channel-neutrality + determinism + honesty ─────────────────
console.log("Pure ObservationDraft builder:");

const emailDraft = buildObservationDraft({
  tenantId: T,
  interaction: emailInteraction(),
  customerCardContext: card,
  graphNodeRefs: ["node-int", "node-person", "node-company"],
  mapperVersion: MAPPER_VERSION,
  domain: "core",
});
const phoneDraft = buildObservationDraft({
  tenantId: T,
  interaction: phoneInteraction(),
  customerCardContext: card,
  graphNodeRefs: ["node-int2", "node-person", "node-company"],
  mapperVersion: MAPPER_VERSION,
  domain: "core",
});

check(
  "email + phone drives the SAME evaluation algorithm (scores/domain equal)",
  emailDraft.confidence === phoneDraft.confidence &&
    emailDraft.ambiguity === phoneDraft.ambiguity &&
    emailDraft.risk === phoneDraft.risk &&
    emailDraft.reversibility === phoneDraft.reversibility &&
    emailDraft.domain === phoneDraft.domain &&
    emailDraft.severity === phoneDraft.severity &&
    emailDraft.created_from === phoneDraft.created_from,
);
check(
  "channel value changes PROVENANCE only",
  (emailDraft.attributes.channel as string) === "email" &&
    (phoneDraft.attributes.channel as string) === "phone" &&
    JSON.stringify((emailDraft.attributes.source as Record<string, unknown>).source_table) !==
      JSON.stringify((phoneDraft.attributes.source as Record<string, unknown>).source_table),
);
check("created_from marks the bridge", emailDraft.created_from === OBSERVATION_CREATED_FROM);

// Determinism: same inputs → deep-equal output.
const emailDraftAgain = buildObservationDraft({
  tenantId: T,
  interaction: emailInteraction(),
  customerCardContext: card,
  graphNodeRefs: ["node-int", "node-person", "node-company"],
  mapperVersion: MAPPER_VERSION,
  domain: "core",
});
check(
  "same interaction + mapper version ⇒ identical draft (deterministic)",
  JSON.stringify(emailDraft) === JSON.stringify(emailDraftAgain),
);
check(
  "ingest + observe keys are deterministic and mapper-versioned",
  ingestKey(T, "int-email", MAPPER_VERSION) === `ingest:${T}:int-email:${MAPPER_VERSION}` &&
    observeJobKey(T, "int-email", MAPPER_VERSION) ===
      `${OBSERVE_JOB_TYPE}:${T}:int-email:${MAPPER_VERSION}` &&
    ingestKey(T, "int-email", "obs-ingest/2") !== ingestKey(T, "int-email", MAPPER_VERSION),
);

// Evidence + source references preserved.
check(
  "source interaction id + evidence references preserved",
  emailDraft.source_interactions.length === 1 &&
    emailDraft.source_interactions[0] === "int-email" &&
    emailDraft.evidence.some((e) => e.ref === "interaction" && e.interaction_id === "int-email"),
);
check(
  "resolved graph nodes carried as source_entities",
  emailDraft.source_entities.length === 3 &&
    (emailDraft.attributes.graph_context as { entity_node_count: number }).entity_node_count === 3,
);

// Confidence/ambiguity: preserved from card, else deterministically derived.
check("card confidence is PRESERVED over the derived value", emailDraft.confidence === 0.66);
const derivedResolved = buildObservationDraft({
  tenantId: T,
  interaction: emailInteraction(),
  customerCardContext: null,
  graphNodeRefs: [],
  mapperVersion: MAPPER_VERSION,
  domain: "core",
});
const derivedUnresolved = buildObservationDraft({
  tenantId: T,
  interaction: emailInteraction({ related_person_id: null, related_company_id: null }),
  customerCardContext: null,
  graphNodeRefs: [],
  mapperVersion: MAPPER_VERSION,
  domain: "core",
});
check(
  "confidence/ambiguity deterministically derived when no card (resolved vs unresolved)",
  derivedResolved.confidence === 0.7 &&
    derivedResolved.ambiguity === 0.2 &&
    derivedUnresolved.confidence === 0.5 &&
    derivedUnresolved.ambiguity === 0.5,
);

// Honest absence — no fabrication, no crash.
check(
  "missing customer card is represented as null (not fabricated)",
  derivedResolved.attributes.customer_context === null,
);
check(
  "missing graph context is honest (empty entities, zero count)",
  derivedResolved.source_entities.length === 0 &&
    (derivedResolved.attributes.graph_context as { entity_node_count: number })
      .entity_node_count === 0,
);

// Cross-tenant references are rejected in the pure builder.
check(
  "cross-tenant interaction is rejected",
  (() => {
    try {
      buildObservationDraft({
        tenantId: T,
        interaction: emailInteraction({ tenant_id: OTHER_T }),
        customerCardContext: null,
        graphNodeRefs: [],
        mapperVersion: MAPPER_VERSION,
        domain: "core",
      });
      return false;
    } catch (e) {
      return e instanceof IngestTenantMismatchError;
    }
  })(),
);
check(
  "cross-tenant customer card is rejected",
  (() => {
    try {
      buildObservationDraft({
        tenantId: T,
        interaction: emailInteraction(),
        customerCardContext: { ...card, tenant_id: OTHER_T },
        graphNodeRefs: [],
        mapperVersion: MAPPER_VERSION,
        domain: "core",
      });
      return false;
    } catch (e) {
      return e instanceof IngestTenantMismatchError;
    }
  })(),
);

// Eligibility predicate — enriched only.
check(
  "only enriched interactions are eligible",
  isEligibleForIngest({ processing_status: "enriched" }) &&
    !isEligibleForIngest({ processing_status: "pending" }) &&
    !isEligibleForIngest({ processing_status: "ready" }) &&
    !isEligibleForIngest({ processing_status: null }),
);

// ── Orchestrator: idempotency / concurrency / batching (injected effects) ────
console.log("Ingest orchestrator (idempotency + concurrency):");

interface FakeState {
  interactions: Record<string, IngestInteraction>;
  card?: CardContext | null;
  graph?: string[];
  ledger: Map<string, { id: string; observe_job_id: string | null }>;
  jobsByKey: Map<string, string>;
  calls: { enqueue: number; claim: number; record: number; loadInteraction: string[] };
  loadInteractionThrowsFor?: Set<string>;
}
function makeDeps(init: {
  interactions: Record<string, IngestInteraction>;
  card?: CardContext | null;
  graph?: string[];
  seedLedger?: Array<{ ingestKey: string; id: string; observe_job_id: string | null }>;
  seedJobs?: Array<{ observeJobKey: string; jobId: string }>;
  loadInteractionThrowsFor?: string[];
}): { deps: IngestDeps; state: FakeState } {
  let seq = 0;
  const state: FakeState = {
    interactions: init.interactions,
    card: init.card ?? null,
    graph: init.graph ?? [],
    ledger: new Map(),
    jobsByKey: new Map(),
    calls: { enqueue: 0, claim: 0, record: 0, loadInteraction: [] },
    loadInteractionThrowsFor: new Set(init.loadInteractionThrowsFor ?? []),
  };
  for (const s of init.seedLedger ?? [])
    state.ledger.set(s.ingestKey, { id: s.id, observe_job_id: s.observe_job_id });
  for (const s of init.seedJobs ?? []) state.jobsByKey.set(s.observeJobKey, s.jobId);

  const deps: IngestDeps = {
    loadInteraction: async (id) => {
      state.calls.loadInteraction.push(id);
      if (state.loadInteractionThrowsFor!.has(id)) throw new Error("load boom");
      return state.interactions[id] ?? null;
    },
    loadCardContext: async () => state.card ?? null,
    loadGraphNodeRefs: async () => state.graph ?? [],
    claimIngestion: async ({ ingestKey: k }) => {
      state.calls.claim++;
      const existing = state.ledger.get(k);
      if (existing) return { claimed: false, row: existing };
      const row = { id: `ing-${++seq}`, observe_job_id: null as string | null };
      state.ledger.set(k, row);
      return { claimed: true, row };
    },
    findObserveJobByKey: async (k) => state.jobsByKey.get(k) ?? null,
    enqueueObserve: async ({ observeJobKey: k }) => {
      state.calls.enqueue++;
      const existing = state.jobsByKey.get(k);
      if (existing) return { jobId: existing, duplicate: true };
      const jobId = `job-${++seq}`;
      state.jobsByKey.set(k, jobId);
      return { jobId, duplicate: false };
    },
    recordObserveJob: async (ingestionId, jobId) => {
      state.calls.record++;
      for (const row of state.ledger.values())
        if (row.id === ingestionId) row.observe_job_id = jobId;
    },
  };
  return { deps, state };
}

// A first, clean ingestion → observed, enqueues exactly one observe job.
{
  const { deps, state } = makeDeps({ interactions: { "int-email": emailInteraction() }, card });
  const r = await ingestInteractions(deps, { tenantId: T, interactionIds: ["int-email"] });
  check(
    "first ingestion ⇒ observed, one observe job enqueued",
    r.observed === 1 &&
      r.results[0].outcome === "observed" &&
      r.results[0].observeJobType === OBSERVE_JOB_TYPE &&
      state.calls.enqueue === 1,
    r,
  );

  // Retry the SAME interaction against the shared ledger ⇒ reused, no second job.
  const r2 = await ingestInteractions(deps, { tenantId: T, interactionIds: ["int-email"] });
  check(
    "retry ⇒ reused (idempotent), NO second observe job / Observation",
    r2.reused === 1 &&
      r2.results[0].idempotent === true &&
      r2.results[0].observeJobId === r.results[0].observeJobId &&
      state.calls.enqueue === 1,
    { r2, enqueue: state.calls.enqueue },
  );
}

// Concurrency: two workers, same interaction. The ledger claim is the single gate.
{
  const { deps, state } = makeDeps({ interactions: { "int-email": emailInteraction() }, card });
  const [a, b] = await Promise.all([
    ingestInteractions(deps, { tenantId: T, interactionIds: ["int-email"] }),
    ingestInteractions(deps, { tenantId: T, interactionIds: ["int-email"] }),
  ]);
  const jobIds = new Set([a.results[0].observeJobId, b.results[0].observeJobId]);
  check(
    "two concurrent workers ⇒ exactly one logical Observation (one job id)",
    state.jobsByKey.size === 1 &&
      jobIds.size === 1 &&
      a.results[0].observeJobType === OBSERVE_JOB_TYPE,
    { jobs: state.jobsByKey.size, jobIds: [...jobIds] },
  );
}

// Crash window: ledger row exists (claim won) but observe_job_id null AND the job
// already exists ⇒ recover it, never enqueue a second.
{
  const jobKey = observeJobKey(T, "int-email", MAPPER_VERSION);
  const { deps, state } = makeDeps({
    interactions: { "int-email": emailInteraction() },
    card,
    seedLedger: [
      { ingestKey: ingestKey(T, "int-email", MAPPER_VERSION), id: "ing-x", observe_job_id: null },
    ],
    seedJobs: [{ observeJobKey: jobKey, jobId: "job-existing" }],
  });
  const r = await ingestInteractions(deps, { tenantId: T, interactionIds: ["int-email"] });
  check(
    "crash window (job exists, id unrecorded) ⇒ recovered, no duplicate enqueue",
    r.results[0].outcome === "reused" &&
      r.results[0].observeJobId === "job-existing" &&
      state.calls.enqueue === 0,
    { r, enqueue: state.calls.enqueue },
  );
}

// Orphan recovery: ledger row exists, observe_job_id null, NO job ⇒ enqueue now.
{
  const { deps, state } = makeDeps({
    interactions: { "int-email": emailInteraction() },
    card,
    seedLedger: [
      { ingestKey: ingestKey(T, "int-email", MAPPER_VERSION), id: "ing-y", observe_job_id: null },
    ],
  });
  const r = await ingestInteractions(deps, { tenantId: T, interactionIds: ["int-email"] });
  check(
    "orphan (claimed before enqueue crash) ⇒ enqueues once on recovery",
    r.results[0].outcome === "reused" &&
      r.results[0].observeJobId != null &&
      state.calls.enqueue === 1,
    r,
  );
}

// Cross-tenant + not-found + not-eligible rejections (batch continues).
{
  const { deps } = makeDeps({
    interactions: {
      "int-email": emailInteraction(),
      "int-foreign": emailInteraction({ id: "int-foreign", tenant_id: OTHER_T }),
      "int-pending": emailInteraction({ id: "int-pending", processing_status: "pending" }),
    },
    card,
  });
  const r = await ingestInteractions(deps, {
    tenantId: T,
    interactionIds: ["int-email", "int-foreign", "int-pending", "int-missing"],
  });
  const byId = Object.fromEntries(r.results.map((x) => [x.interactionId, x]));
  check(
    "cross-tenant / not-eligible / missing are rejected; valid one still observed",
    byId["int-email"].outcome === "observed" &&
      byId["int-foreign"].outcome === "rejected" &&
      byId["int-pending"].outcome === "rejected" &&
      byId["int-pending"].reason === "not_eligible" &&
      byId["int-missing"].outcome === "rejected" &&
      byId["int-missing"].reason === "not_found_or_cross_tenant",
    byId,
  );
}

// Failure isolation: one loader throws; the rest of the batch still processes.
{
  const { deps } = makeDeps({
    interactions: { a: emailInteraction({ id: "a" }), b: emailInteraction({ id: "b" }) },
    card,
    loadInteractionThrowsFor: ["a"],
  });
  const r = await ingestInteractions(deps, { tenantId: T, interactionIds: ["a", "b"] });
  const byId = Object.fromEntries(r.results.map((x) => [x.interactionId, x]));
  check(
    "one failed record does NOT abort the bounded batch",
    r.processed === 2 && byId["a"].outcome === "rejected" && byId["b"].outcome === "observed",
    r,
  );
}

// Historical rows are never swept: only the ids passed are touched, bounded by cap.
{
  const interactions: Record<string, IngestInteraction> = {};
  const ids: string[] = [];
  for (let n = 0; n < DEFAULT_MAX_BATCH + 10; n++) {
    const id = `h-${n}`;
    interactions[id] = emailInteraction({ id });
    ids.push(id);
  }
  const { deps, state } = makeDeps({ interactions, card });
  const r = await ingestInteractions(deps, { tenantId: T, interactionIds: ids });
  check(
    "bounded batch: never sweeps history (cap enforced, only passed ids touched)",
    r.processed === DEFAULT_MAX_BATCH &&
      state.calls.loadInteraction.length === DEFAULT_MAX_BATCH &&
      state.calls.loadInteraction.every((x) => ids.includes(x)),
    { processed: r.processed, loaded: state.calls.loadInteraction.length },
  );
}

// The bridge enqueues intelligence.observe ONLY — never evaluates, never creates an
// automation intent or any external side effect (the deps surface has no such power).
{
  const { deps, state } = makeDeps({ interactions: { "int-email": emailInteraction() }, card });
  const r = await ingestInteractions(deps, { tenantId: T, interactionIds: ["int-email"] });
  const depNames = Object.keys(deps);
  check(
    "handler enqueues intelligence.observe and nothing else (no evaluate/intent/execute)",
    r.results.every((x) => x.observeJobType === OBSERVE_JOB_TYPE) &&
      state.calls.enqueue === 1 &&
      !depNames.some((n) => /evaluate|decision|intent|approv|execute|adapter/i.test(n)),
    depNames,
  );
}

console.log(
  failures === 0 ? "\nALL OBSERVATION-INGEST UNIT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
