// Controlled in-process proof of the interaction → intelligence seam. NO database, NO
// cron, NO deploy: it runs the REAL pure decision engine on the bridge's output for one
// email-shaped and one phone-shaped interaction, proving each reaches
//   interaction → bridge → intelligence.observe payload → DecisionPackage / review routing
// with NO customer-, channel- or industry-specific rule. The live queue→observe→DB
// round-trip is exercised by Step 1b (scheduler), deliberately deferred.
//
// Run: node supabase/functions/_shared/observation_ingest.integration.ts

import {
  ingestInteractions,
  type IngestDeps,
  type IngestInteraction,
  type ObservationDraft,
} from "./observation_ingest.ts";
import { resolveEffectiveProfile } from "./intelligence/profile.ts";
import { resolveAuthorityContext } from "./intelligence/authority.ts";
import { evaluateDecision } from "./intelligence/decision.ts";
import type {
  DecisionInput,
  DecisionPackage,
  IntelligenceObject,
  Policy,
  ProfileEntry,
} from "./intelligence/types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const T = "00000000-0000-0000-0000-000000000001";

// A realistic platform operating profile (the decision-critical keys). No tenant- or
// industry-specific entries — universal configuration only.
const PROFILE: ProfileEntry[] = [
  ["confidence", "customer_facing_min", 0.8],
  ["confidence", "evidence_floor", 0.3],
  ["confidence", "auto_max_ambiguity", 0.3],
  ["risk", "high_min", 0.6],
  ["risk", "critical_min", 0.85],
  ["risk", "auto_max_score", 0.4],
  ["authority", "delegated_limit", 0],
  ["authority", "currency", "GBP"],
].map(([namespace, key, value]) => ({
  scope_kind: "platform",
  scope_ref: null,
  domain: null,
  namespace: namespace as string,
  key: key as string,
  value: value as unknown,
}));

// Controlled email + phone interactions — identical business facts, different channel.
function emailInteraction(): IngestInteraction {
  return {
    id: "int-email-001",
    tenant_id: T,
    source_type: "email",
    source_connector_id: "google-workspace",
    source_table: "email_messages",
    source_id: "em-001",
    source_external_id: "gmail-001",
    interaction_type: "email_message",
    direction: "inbound",
    processing_status: "enriched",
    occurred_at: "2026-07-15T09:00:00Z",
    subject: "Can you help with my boiler?",
    summary: "Customer asking for help with a boiler",
    body_preview: "Hi, my boiler is making a noise — can someone help?",
    from_name: "Ann Example",
    from_address: "ann@acme.co.uk",
    sentiment: "neutral",
    priority: "medium",
    related_person_id: "person-001",
    related_company_id: "company-001",
  };
}
function phoneInteraction(): IngestInteraction {
  return {
    ...emailInteraction(),
    id: "int-phone-001",
    source_type: "phone",
    source_connector_id: "simwood",
    source_table: "phone_calls",
    source_id: "pc-001",
    source_external_id: "call-001",
    interaction_type: "phone_call",
    from_address: null,
  };
}

// Fake bridge deps that capture the enqueued observe payload (the seam's hand-off).
function captureDeps(interaction: IngestInteraction): {
  deps: IngestDeps;
  captured: { draft: ObservationDraft | null; jobType: string | null };
} {
  const captured: { draft: ObservationDraft | null; jobType: string | null } = {
    draft: null,
    jobType: null,
  };
  const deps: IngestDeps = {
    loadInteraction: async () => interaction,
    loadCardContext: async () => ({
      tenant_id: T,
      title: "Ann Example",
      summary: "Known customer",
      status: "active",
      priority: "medium",
      priority_score: 40,
      confidence: 0.6,
      recommended_action: "respond_to_customer",
    }),
    loadGraphNodeRefs: async () => ["node-interaction", "node-person", "node-company"],
    claimIngestion: async () => ({ claimed: true, row: { id: "ing-1", observe_job_id: null } }),
    findObserveJobByKey: async () => null,
    enqueueObserve: async ({ draft }) => {
      captured.draft = draft; // the exact payload intelligence.observe would receive
      captured.jobType = "intelligence.observe";
      return { jobId: "observe-job-1", duplicate: false };
    },
    recordObserveJob: async () => {},
  };
  return { deps, captured };
}

// Run the observe half of the seam on the captured draft — the REAL pure decision engine.
function evaluateDraft(draft: ObservationDraft): DecisionPackage {
  const object: IntelligenceObject = {
    tenant_id: T,
    domain: draft.domain,
    object_type: "Observation",
    object_class: "observation",
    subject: draft.subject,
    severity: draft.severity,
    confidence: draft.confidence,
    ambiguity: draft.ambiguity,
    risk: draft.risk,
    reversibility: draft.reversibility,
    status: "unknown",
    evidence: draft.evidence,
    source_interactions: draft.source_interactions,
    source_entities: draft.source_entities,
    attributes: draft.attributes,
  };
  const profile = resolveEffectiveProfile(PROFILE, {
    tenantId: T,
    industry: null,
    domain: draft.domain,
  });
  const input: DecisionInput = {
    decisionId: "11111111-1111-1111-1111-111111111111",
    correlationId: "22222222-2222-2222-2222-222222222222",
    evaluatedAt: "2026-07-15T09:00:00Z",
    engineVersion: "decision-engine/1.0.0",
    object,
    profile,
    authority: resolveAuthorityContext(object, profile),
    objectiveContext: null,
    policies: [] as Policy[], // horizontal proof: no bespoke rule needed
    domainPackKeys: [draft.domain],
    domainPackVersions: [],
    operatingProfileVersion: null,
    learningVersionIds: [],
    supersedes: null,
    now: Date.parse("2026-07-15T09:00:00Z"),
  };
  return evaluateDecision(input);
}

async function proveChannel(label: string, interaction: IngestInteraction) {
  console.log(`\n${label} channel:`);
  const { deps, captured } = captureDeps(interaction);
  const batch = await ingestInteractions(deps, {
    tenantId: T,
    interactionIds: [interaction.id],
  });

  check(
    `${label}: interaction → bridge → intelligence.observe job (no direct evaluation)`,
    batch.observed === 1 &&
      batch.results[0].observeJobType === "intelligence.observe" &&
      captured.jobType === "intelligence.observe" &&
      captured.draft != null,
    batch.results[0],
  );

  const draft = captured.draft!;
  const pkg = evaluateDraft(draft);

  check(
    `${label}: bridge → DecisionPackage (immutable, tenant-scoped)`,
    typeof pkg.id === "string" && pkg.tenantId === T && typeof pkg.decision === "string",
    { id: pkg.id, decision: pkg.decision },
  );
  check(
    `${label}: routes to HUMAN review before any side effect (no auto-execute, no intent)`,
    pkg.routing.reviewRequired === true && pkg.automationIntent === null,
    { decision: pkg.decision, routing: pkg.routing, automationIntent: pkg.automationIntent },
  );
  check(
    `${label}: source interaction preserved into the DecisionPackage evidence`,
    pkg.evidence.interactionIds.includes(interaction.id),
    pkg.evidence.interactionIds,
  );
  return { draft, pkg };
}

console.log("Controlled proof — interaction → bridge → observe → DecisionPackage:");
const email = await proveChannel("EMAIL", emailInteraction());
const phone = await proveChannel("PHONE", phoneInteraction());

console.log("\nChannel neutrality (same algorithm, provenance differs only):");
check(
  "email + phone reach the SAME decision destination + routing",
  email.pkg.decision === phone.pkg.decision &&
    email.pkg.routing.reviewRequired === phone.pkg.routing.reviewRequired,
  { email: email.pkg.decision, phone: phone.pkg.decision },
);
check(
  "the two decisions differ ONLY in provenance (their source interaction ids)",
  JSON.stringify(email.pkg.evidence.interactionIds) !==
    JSON.stringify(phone.pkg.evidence.interactionIds) &&
    email.draft.confidence === phone.draft.confidence &&
    email.draft.ambiguity === phone.draft.ambiguity &&
    email.draft.risk === phone.draft.risk &&
    email.draft.reversibility === phone.draft.reversibility,
);
check(
  "no automation intent / external side effect produced in this phase",
  email.pkg.automationIntent === null && phone.pkg.automationIntent === null,
);

console.log(
  failures === 0
    ? "\nINTEGRATION PROOF PASSED — email + phone reach DecisionPackage/review routing"
    : `\n${failures} INTEGRATION CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
