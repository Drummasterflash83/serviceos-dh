// Run (local stack must be up):
//   eval "$(npx --no-install supabase status --output json | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const j=JSON.parse(s);console.log(`export SUPABASE_URL=${j.API_URL}`);console.log(`export SUPABASE_SERVICE_ROLE_KEY=${j.SERVICE_ROLE_KEY}`)})')"
//   node scripts/customer-health-shadow.test.ts
//
// Integration test: exercises the REAL Customer Health store + review + pipeline
// against the local Docker Postgres on an isolated synthetic tenant (purged at the
// end). Proves, in order:
//   • the unpublished-policy gate (skipped_unpublished, zero writes);
//   • the source boundary DEFAULT-DENY (missing config / disabled / disallowed source
//     ⇒ skipped_*, zero writes; only enabled + explicitly-allowed source proceeds);
//   • candidate → Health Object + assessment + proposal; folding (one proposal);
//   • uncertain → UNKNOWN assessment, no proposal, plan == exact writes;
//   • governed review: payload validation (no empty corrections), invalid decisions,
//     write-error surfacing (injected failures), undo truthfulness,
//     confirm_resolution eligibility + idempotency + undo prohibition;
//   • corrections IS written for correction-class decisions (documented: that table
//     is tenant-readable under its existing RLS — correction content is NOT
//     Chris-only);
//   • shadow-safety: zero writes to canonical work/execution/outcome/graph tables.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  loadCallbackConfig,
  processCandidate,
} from "../supabase/functions/_shared/health/store.ts";
import {
  applyReviewDecision,
  loadShadowSurface,
} from "../supabase/functions/_shared/health/review.ts";
import type { CommunicationInput } from "../supabase/functions/_shared/health/types.ts";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run the eval line in the header).",
  );
  process.exit(2);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

// Unique synthetic tenant per run so a prior run's append-only residue never collides.
const RUN = Date.now().toString(16).padStart(12, "0").slice(-12);
const TENANT = `a0a0a0a0-0000-0000-0000-${RUN}`;
const PERSON = "a0a0a0a0-0000-0000-0000-0000000000b1";
const PERSON_UNCERTAIN = "a0a0a0a0-0000-0000-0000-0000000000b2";
const PERSON_RES = "a0a0a0a0-0000-0000-0000-0000000000b3";
const PERSON_FAIL = "a0a0a0a0-0000-0000-0000-0000000000b4";
const NOW = Date.parse("2026-07-22T12:00:00Z");
// Every canonical work/execution/outcome/graph table that EXISTS locally and must
// never change during shadow processing. (automation_executions / notifications do
// not exist as tables on this branch — see shadow_safety.ts for the doc-level list.)
const FORBIDDEN = [
  "intelligence_objects",
  "object_state_history",
  "objective_links",
  "automation_intents",
  "automation_intent_states",
  "automation_approvals",
  "outcomes",
  "review_tasks",
  "decision_log",
  "recommendations",
  "platform_events",
  "people",
  "companies",
  "customer_cards",
  "interactions",
  "jobs",
  "responsibility_assignments",
  "authority_grants",
];

let failed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
  }
}
async function counts(tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await db.from(t).select("*", { count: "exact", head: true });
    out[t] = count ?? 0;
  }
  return out;
}
const HEALTH_TABLES = [
  "health_objects",
  "health_assessments",
  "health_commitment_proposals",
  "health_proposal_sources",
];
async function healthCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of HEALTH_TABLES) {
    const { count } = await db
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT);
    out[t] = count ?? 0;
  }
  return out;
}
function comm(over: Partial<CommunicationInput>): CommunicationInput {
  return {
    interactionId: over.interactionId ?? "x",
    interactionType: "phone_call",
    direction: "inbound",
    occurredAt: "2026-07-22T09:00:00Z",
    fromName: "Cust",
    fromAddress: null,
    phoneFrom: "+449000000000",
    phoneTo: "+441111000001",
    subject: null,
    summary: null,
    bodyPreview: null,
    disposition: null,
    queue: "scheduling",
    relatedPersonId: PERSON,
    relatedCompanyId: null,
    ...over,
  };
}

// ── Injected-failure client: delegates to the real client, but the named ops on the
// named table return an error result. Used to prove the review path surfaces EVERY
// write failure instead of swallowing it.
/* eslint-disable @typescript-eslint/no-explicit-any */
function failChain(): any {
  const res = { data: null, error: { message: "injected failure", code: "XXINJ" } };
  const chain: any = {};
  for (const m of ["select", "eq", "order", "limit", "insert", "update", "not", "in"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(res);
  chain.single = () => Promise.resolve(res);
  chain.then = (onF: any, onR: any) => Promise.resolve(res).then(onF, onR);
  return chain;
}
function failingOn(table: string, ops: string[]): any {
  return {
    from(name: string) {
      const b = (db as any).from(name);
      if (name !== table) return b;
      return new Proxy(b, {
        get(target: any, prop: string) {
          if (ops.includes(prop)) return () => failChain();
          const v = target[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// True cleanup. Append-only triggers block DELETE via the API, so purge via psql with
// replication triggers disabled (local Docker superuser). Isolated to the synthetic
// tenant; also sweeps stray old ch-int test tenants.
function purge(tenant: string) {
  const tables = [
    "health_proposal_decisions",
    "health_proposal_sources",
    "health_commitment_proposals",
    "health_assessments",
    "health_objects",
    "corrections",
    "operating_profile_entries",
    "config_versions",
  ];
  const dels = tables.map((t) => `delete from ${t} where tenant_id='${tenant}';`).join(" ");
  const sql = `begin; set local session_replication_role=replica; ${dels} delete from tenants where id='${tenant}'; commit;`;
  try {
    execSync(
      `docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "${sql}"`,
      { stdio: "ignore" },
    );
  } catch {
    /* best effort */
  }
}

async function setAllowlist(value: unknown, versionId: string) {
  await db
    .from("operating_profile_entries")
    .delete()
    .eq("tenant_id", TENANT)
    .eq("namespace", "customer_health")
    .eq("key", "source.allowlist");
  await db.from("operating_profile_entries").insert({
    tenant_id: TENANT,
    scope_kind: "tenant",
    scope_ref: TENANT,
    domain: "serviceos",
    namespace: "customer_health",
    key: "source.allowlist",
    value,
    version_id: versionId,
  });
}

async function main() {
  // Fresh synthetic tenant (unique per run).
  purge(TENANT);
  await db.from("tenants").insert({
    id: TENANT,
    slug: "ch-int-" + RUN,
    display_name: "CH Integration",
    industry: "hvac",
  });

  // Seed a DRAFT policy + config — deliberately WITHOUT any source.allowlist entry,
  // to prove missing configuration fails closed.
  const { data: cv } = await db
    .from("config_versions")
    .insert({
      tenant_id: TENANT,
      artifact_kind: "policy",
      artifact_key: "customer_health",
      version: 1,
      status: "draft",
      author: "test",
    })
    .select("id")
    .single();
  const versionId = cv!.id as string;
  const cfgRows = [
    [
      "ownership.maps",
      {
        queue: { scheduling: { responsibility: "team:scheduling", label: "Scheduling queue" } },
        ddi: { "+441111000001": { responsibility: "team:finance", label: "Finance" } },
        fallback_role: { responsibility: "role:coordinator", label: "Coordinator" },
      },
    ],
    ["ownership.resolution_order", ["ddi", "queue", "named_recipient", "fallback_role"]],
    ["privacy", { redact_excerpts: true, max_excerpt_chars: 120, expose_transcript: false }],
  ] as const;
  for (const [key, value] of cfgRows) {
    await db.from("operating_profile_entries").insert({
      tenant_id: TENANT,
      scope_kind: "tenant",
      scope_ref: TENANT,
      domain: "serviceos",
      namespace: "customer_health",
      key,
      value,
      version_id: versionId,
    });
  }

  const before = await counts(FORBIDDEN);

  // ── Gate 1: draft policy refuses everything. ──────────────────────────────
  await ok("unpublished policy → skipped_unpublished, zero writes (gate)", async () => {
    const cfg = await loadCallbackConfig(db, TENANT);
    assert.equal(cfg.published, false);
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-1",
        summary: "please call me back about my quote",
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.equal(r.outcome, "skipped_unpublished");
    assert.equal(r.healthObjectId, null);
    const h = await healthCounts();
    for (const t of HEALTH_TABLES) assert.equal(h[t], 0, `${t} must be untouched`);
  });

  // Publish the policy.
  await db
    .from("config_versions")
    .update({ status: "published", published_at: new Date(NOW).toISOString() })
    .eq("id", versionId);

  // ── Gate 2: source boundary DEFAULT-DENY. ─────────────────────────────────
  await ok("published + MISSING allowlist config → fails closed, zero writes", async () => {
    const cfg = await loadCallbackConfig(db, TENANT);
    assert.equal(cfg.published, true);
    assert.equal(cfg.sourceAllowlistEnabled, false, "missing config must read as disabled");
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-1",
        summary: "please call me back about my quote",
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.equal(r.outcome, "skipped_source_boundary_disabled");
    const h = await healthCounts();
    for (const t of HEALTH_TABLES) assert.equal(h[t], 0, `${t} must be untouched`);
  });

  await ok("published + allowlist DISABLED → skipped, zero writes", async () => {
    await setAllowlist({ enabled: false, sources: [] }, versionId);
    const cfg = await loadCallbackConfig(db, TENANT);
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-1",
        summary: "please call me back about my quote",
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.equal(r.outcome, "skipped_source_boundary_disabled");
    const h = await healthCounts();
    for (const t of HEALTH_TABLES) assert.equal(h[t], 0, `${t} must be untouched`);
  });

  await ok("published + allowlist enabled + DISALLOWED source → skipped, zero writes", async () => {
    await setAllowlist({ enabled: true, sources: ["phone_call"] }, versionId);
    const cfg = await loadCallbackConfig(db, TENANT);
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-sms",
        interactionType: "sms_message",
        summary: "please call me back about my quote",
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.equal(r.outcome, "skipped_source_not_allowed");
    const h = await healthCounts();
    for (const t of HEALTH_TABLES) assert.equal(h[t], 0, `${t} must be untouched`);
  });

  // ── Candidate → Health Object + assessment + proposal. ────────────────────
  let proposalId: string | null = null;
  await ok("allowed source: candidate → Health Object + assessment + proposal", async () => {
    const cfg = await loadCallbackConfig(db, TENANT);
    assert.equal(cfg.sourceAllowlistEnabled, true);
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-1",
        summary: "please call me back about my quote",
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.equal(r.outcome, "candidate_proposed");
    assert.ok(r.healthObjectId, "health object created");
    assert.ok(r.assessmentId, "assessment created");
    assert.ok(r.proposalId, "proposal created");
    assert.ok(r.shadowSafe);
    proposalId = r.proposalId;
  });

  await ok("second comm, same obligation → FOLDS (one proposal, 2 sources)", async () => {
    const cfg = await loadCallbackConfig(db, TENANT);
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({ interactionId: "int-2", summary: "chasing a callback on my quote" }),
      config: cfg,
      nowMs: NOW + 3_600_000,
    });
    assert.equal(r.proposalId, proposalId, "same proposal (folded)");
    assert.equal(r.folded, true);
    const { count } = await db
      .from("health_proposal_sources")
      .select("*", { count: "exact", head: true })
      .eq("proposal_id", proposalId!);
    assert.equal(count, 2, "two candidate sources folded onto one proposal");
    const { count: propCount } = await db
      .from("health_commitment_proposals")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT);
    assert.equal(propCount, 1, "still exactly one proposal");
  });

  await ok("excluded candidate → NO writes", async () => {
    const cfg = await loadCallbackConfig(db, TENANT);
    const h0 = await healthCounts();
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-3",
        disposition: "missed",
        summary: "missed call, line dropped",
        queue: undefined,
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.equal(r.outcome, "excluded");
    assert.equal(r.healthObjectId, null);
    assert.deepEqual(await healthCounts(), h0, "no health table changed");
  });

  // ── Uncertain → UNKNOWN assessment; declared plan == actual writes. ───────
  await ok("uncertain → unknown assessment, NO proposal, plan == exact writes", async () => {
    const cfg = await loadCallbackConfig(db, TENANT);
    const h0 = await healthCounts();
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-4",
        disposition: "voicemail",
        summary: "left message",
        queue: undefined,
        relatedPersonId: PERSON_UNCERTAIN,
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.equal(r.outcome, "needs_context");
    assert.ok(r.healthObjectId, "health object recorded");
    assert.ok(r.assessmentId, "assessment recorded");
    assert.equal(r.proposalId, null, "NO proposal for uncertain evidence");
    const { data: a } = await db
      .from("health_assessments")
      .select("state, drivers, confidence, evidence")
      .eq("id", r.assessmentId!)
      .single();
    assert.equal(a!.state, "unknown", "uncertain evidence must read unknown, NEVER healthy");
    assert.ok(
      (a!.drivers as { code: string }[]).some((d) => d.code === "uncertainty"),
      "uncertainty driver present",
    );
    assert.ok((a!.confidence as number) < 0.5, "reduced confidence");
    assert.ok(
      (a!.evidence as { source: string }[]).some((e) => e.source === "classifier"),
      "assessment evidence explains what could not be established",
    );
    // Declared plan for the uncertain route is exactly health_objects +
    // health_assessments: prove the ACTUAL table effects match.
    const h1 = await healthCounts();
    assert.equal(h1.health_objects, h0.health_objects + 1, "one health object added");
    assert.equal(h1.health_assessments, h0.health_assessments + 1, "one assessment added");
    assert.equal(h1.health_commitment_proposals, h0.health_commitment_proposals, "no proposal");
    assert.equal(h1.health_proposal_sources, h0.health_proposal_sources, "no source row");
  });

  // ── Governed review: validation. ──────────────────────────────────────────
  await ok("invalid decision string is rejected before any write", async () => {
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: proposalId!,
      decision: "banana" as never,
      actor: "chris@test",
    });
    assert.ok(!res.ok && /unknown decision/.test(res.error));
  });

  await ok("EMPTY correction payload is rejected — no empty corrections ever", async () => {
    const { count: c0 } = await db
      .from("corrections")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT);
    for (const [decision, msg] of [
      ["correct", /corrected_title/],
      ["correct_responsibility", /corrected_responsibility/],
      ["correct_due", /corrected_due_at/],
      ["attach", /attach_to_proposal_id/],
    ] as const) {
      const res = await applyReviewDecision(db, TENANT, {
        proposalId: proposalId!,
        decision,
        actor: "chris@test",
      });
      assert.ok(!res.ok && msg.test(res.error), `${decision} without payload must fail`);
    }
    const { count: c1 } = await db
      .from("corrections")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT);
    assert.equal(c1, c0, "no correction row was created");
  });

  await ok("review confirm → decision recorded, no correction", async () => {
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: proposalId!,
      decision: "confirm",
      actor: "chris@test",
    });
    assert.ok(res.ok && res.toState === "confirmed");
    const { data: prop } = await db
      .from("health_commitment_proposals")
      .select("state")
      .eq("id", proposalId!)
      .single();
    assert.equal(prop!.state, "confirmed");
  });

  // NOTE (documented behaviour): correction-class decisions append a row to the
  // canonical `corrections` table, which is readable by ANY authenticated tenant
  // user under its existing RLS — correction content is NOT Chris-only.
  await ok("review correct (with payload) → correction row appended + linked", async () => {
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: proposalId!,
      decision: "correct",
      actor: "chris@test",
      correctedTitle: "Call back re: boiler quote",
      reason: "wrong topic",
    });
    assert.ok(res.ok);
    const { data: dec } = await db
      .from("health_proposal_decisions")
      .select("correction_id")
      .eq("proposal_id", proposalId!)
      .eq("decision", "correct")
      .single();
    assert.ok(dec!.correction_id, "decision links a correction");
    const { count } = await db
      .from("corrections")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT);
    assert.ok((count ?? 0) >= 1, "correction row exists (tenant-readable — documented)");
  });

  await ok("undo → ACTUALLY reverts the latest decision (state + title)", async () => {
    const { data: propBefore } = await db
      .from("health_commitment_proposals")
      .select("proposed_title, state")
      .eq("id", proposalId!)
      .single();
    assert.equal(propBefore!.state, "corrected");
    assert.equal(propBefore!.proposed_title, "Call back re: boiler quote");
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: proposalId!,
      decision: "undo",
      actor: "chris@test",
    });
    assert.ok(res.ok);
    const { data: dec } = await db
      .from("health_proposal_decisions")
      .select("decision, supersedes_id")
      .eq("proposal_id", proposalId!)
      .eq("decision", "undo")
      .single();
    assert.ok(dec!.supersedes_id, "undo supersedes a prior decision");
    // Truthfulness: the proposal is back to its pre-'correct' values.
    const { data: propAfter } = await db
      .from("health_commitment_proposals")
      .select("proposed_title, state")
      .eq("id", proposalId!)
      .single();
    assert.equal(propAfter!.state, "confirmed", "state reverted to pre-correct value");
    assert.notEqual(propAfter!.proposed_title, "Call back re: boiler quote", "title reverted");
  });

  // ── Injected write failures must surface, never silently succeed. ─────────
  await ok("INJECTED corrections-insert failure → reject fails, state unchanged", async () => {
    const { data: p0 } = await db
      .from("health_commitment_proposals")
      .select("state")
      .eq("id", proposalId!)
      .single();
    const res = await applyReviewDecision(failingOn("corrections", ["insert"]), TENANT, {
      proposalId: proposalId!,
      decision: "reject",
      actor: "chris@test",
      reason: "injected",
    });
    assert.ok(!res.ok && /correction append failed/.test(res.error));
    const { data: p1 } = await db
      .from("health_commitment_proposals")
      .select("state")
      .eq("id", proposalId!)
      .single();
    assert.equal(p1!.state, p0!.state, "proposal state must be unchanged");
  });

  await ok("INJECTED proposal-update failure → defer fails, no decision appended", async () => {
    const { count: d0 } = await db
      .from("health_proposal_decisions")
      .select("*", { count: "exact", head: true })
      .eq("proposal_id", proposalId!);
    const res = await applyReviewDecision(
      failingOn("health_commitment_proposals", ["update"]),
      TENANT,
      { proposalId: proposalId!, decision: "defer", actor: "chris@test" },
    );
    assert.ok(!res.ok && /proposal update failed/.test(res.error));
    const { count: d1 } = await db
      .from("health_proposal_decisions")
      .select("*", { count: "exact", head: true })
      .eq("proposal_id", proposalId!);
    assert.equal(d1, d0, "no decision row appended");
  });

  await ok("INJECTED decision-insert failure → surfaces typed partial failure", async () => {
    const res = await applyReviewDecision(
      failingOn("health_proposal_decisions", ["insert"]),
      TENANT,
      { proposalId: proposalId!, decision: "needs_context", actor: "chris@test" },
    );
    assert.ok(!res.ok && /decision append failed/.test(res.error));
    assert.ok("partial" in res && res.partial === true, "typed partial-failure");
    // Restore the proposal to a resolution-eligible state for the next tests.
    const fix = await applyReviewDecision(db, TENANT, {
      proposalId: proposalId!,
      decision: "confirm",
      actor: "chris@test",
    });
    assert.ok(fix.ok);
  });

  // ── confirm_resolution governance. ────────────────────────────────────────
  let failProposalId: string | null = null;
  let failObjectId: string | null = null;
  await ok("INJECTED reassessment failure → confirm_resolution surfaces partial", async () => {
    // Run against a separate proposal so the main flow stays clean.
    const cfg = await loadCallbackConfig(db, TENANT);
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-5",
        summary: "please ring me back about my invoice",
        relatedPersonId: PERSON_FAIL,
        queue: undefined,
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.ok(r.proposalId);
    failProposalId = r.proposalId;
    failObjectId = r.healthObjectId;
    const res = await applyReviewDecision(failingOn("health_assessments", ["insert"]), TENANT, {
      proposalId: r.proposalId!,
      decision: "confirm_resolution",
      actor: "chris@test",
    });
    assert.ok(!res.ok && /reassessment failed/.test(res.error));
    assert.ok("partial" in res && res.partial === true, "typed partial-failure");
  });

  await ok("confirm_resolution → verified + ONE recovering reassessment", async () => {
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: proposalId!,
      decision: "confirm_resolution",
      actor: "chris@test",
    });
    assert.ok(res.ok);
    const { data: prop } = await db
      .from("health_commitment_proposals")
      .select("state, resolution_state")
      .eq("id", proposalId!)
      .single();
    assert.equal(prop!.state, "resolved_shadow");
    assert.equal(prop!.resolution_state, "verified");
    const { data: recovering } = await db
      .from("health_assessments")
      .select("id, evaluator_version, input_hash, evidence")
      .eq("tenant_id", TENANT)
      .eq("state", "recovering");
    assert.equal(recovering!.length, 1, "exactly one recovering reassessment");
    assert.equal(recovering![0].evaluator_version, "customer-health@1", "shared constant");
    assert.ok(recovering![0].input_hash, "deterministic input_hash present");
    assert.ok(
      JSON.stringify(recovering![0].evidence).includes("chris@test"),
      "evidence identifies the actor and shadow-review method",
    );
  });

  await ok("REPEATED confirm_resolution is idempotent (no duplicates)", async () => {
    const { count: d0 } = await db
      .from("health_proposal_decisions")
      .select("*", { count: "exact", head: true })
      .eq("proposal_id", proposalId!);
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: proposalId!,
      decision: "confirm_resolution",
      actor: "chris@test",
    });
    assert.ok(res.ok && "idempotent" in res && res.idempotent === true);
    const { count: d1 } = await db
      .from("health_proposal_decisions")
      .select("*", { count: "exact", head: true })
      .eq("proposal_id", proposalId!);
    assert.equal(d1, d0, "no duplicate decision row");
    const { count: rec } = await db
      .from("health_assessments")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT)
      .eq("state", "recovering");
    assert.equal(rec, 1, "still exactly one recovering assessment");
  });

  await ok("undo AFTER confirm_resolution is prohibited (Option B)", async () => {
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: proposalId!,
      decision: "undo",
      actor: "chris@test",
    });
    assert.ok(!res.ok && /cannot be undone/.test(res.error));
    // History preserved: the recovering assessment and the resolution decision stay.
    const { count: rec } = await db
      .from("health_assessments")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT)
      .eq("state", "recovering");
    assert.equal(rec, 1, "resolution history preserved");
  });

  await ok("confirm_resolution from an INELIGIBLE state is rejected", async () => {
    const cfg = await loadCallbackConfig(db, TENANT);
    const r = await processCandidate({
      db,
      tenantId: TENANT,
      communication: comm({
        interactionId: "int-6",
        summary: "please call me back about a service visit",
        relatedPersonId: PERSON_RES,
        queue: undefined,
      }),
      config: cfg,
      nowMs: NOW,
    });
    assert.ok(r.proposalId);
    const rej = await applyReviewDecision(db, TENANT, {
      proposalId: r.proposalId!,
      decision: "reject",
      actor: "chris@test",
      reason: "not a real obligation",
    });
    assert.ok(rej.ok);
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: r.proposalId!,
      decision: "confirm_resolution",
      actor: "chris@test",
    });
    assert.ok(!res.ok && /not eligible/.test(res.error));
  });

  await ok("RETRY after partial failure HEALS (idempotent repair, no duplicates)", async () => {
    // The injected-failure proposal was left resolved_shadow+verified with its
    // decision row present but NO recovering assessment. A retried confirmation must
    // repair the missing assessment without duplicating the decision.
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: failProposalId!,
      decision: "confirm_resolution",
      actor: "chris@test",
    });
    assert.ok(res.ok, `expected ok, got: ${res.ok ? "" : res.error}`);
    assert.ok("idempotent" in res && res.idempotent === true);
    assert.ok(res.ok && res.decisionId, "decision id returned after repair");
    const { count: dec } = await db
      .from("health_proposal_decisions")
      .select("*", { count: "exact", head: true })
      .eq("proposal_id", failProposalId!)
      .eq("decision", "confirm_resolution");
    assert.equal(dec, 1, "exactly one confirm_resolution decision after repair");
    const { count: rec } = await db
      .from("health_assessments")
      .select("*", { count: "exact", head: true })
      .eq("health_object_id", failObjectId!)
      .eq("state", "recovering");
    assert.equal(rec, 1, "the missing recovering assessment was repaired");
  });

  await ok("whitespace-only correction payload is rejected (normalised to missing)", async () => {
    const res = await applyReviewDecision(db, TENANT, {
      proposalId: failProposalId!,
      decision: "correct",
      actor: "chris@test",
      correctedTitle: "   ",
    });
    assert.ok(!res.ok && /corrected_title/.test(res.error));
  });

  await ok(
    "AGGREGATE: resolve one of two open callbacks → customer stays on remaining risk",
    async () => {
      const cfg = await loadCallbackConfig(db, TENANT);
      const person = "a0a0a0a0-0000-0000-0000-0000000000c1";
      // Obligation 1 — quote, raised 2 days ago ⇒ overdue.
      const r1 = await processCandidate({
        db,
        tenantId: TENANT,
        communication: comm({
          interactionId: "m-1",
          relatedPersonId: person,
          queue: undefined,
          occurredAt: "2026-07-20T09:00:00Z",
          summary: "please call me back about my quote",
        }),
        config: cfg,
        nowMs: NOW,
      });
      // Obligation 2 — invoice, in-time (different topic ⇒ separate obligation).
      const r2 = await processCandidate({
        db,
        tenantId: TENANT,
        communication: comm({
          interactionId: "m-2",
          relatedPersonId: person,
          queue: undefined,
          occurredAt: "2026-07-22T11:00:00Z",
          summary: "also please call me back about my invoice",
        }),
        config: cfg,
        nowMs: NOW,
      });
      assert.ok(r1.proposalId && r2.proposalId);
      assert.notEqual(r1.proposalId, r2.proposalId, "two distinct obligations, not folded");
      const objId = r1.healthObjectId!;
      const latest = async () => {
        const { data } = await db
          .from("health_assessments")
          .select("state")
          .eq("health_object_id", objId)
          .order("evaluated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data!.state as string;
      };
      assert.ok(["watch", "at_risk", "critical"].includes(await latest()), "open ⇒ risk state");
      // Resolve the invoice callback; the customer must NOT read recovering — quote still open.
      const res = await applyReviewDecision(db, TENANT, {
        proposalId: r2.proposalId!,
        decision: "confirm_resolution",
        actor: "chris@test",
        nowMs: NOW,
      });
      assert.ok(res.ok);
      const after = await latest();
      assert.notEqual(
        after,
        "recovering",
        "must not read recovering while another callback is open",
      );
      assert.ok(
        ["watch", "at_risk", "critical"].includes(after),
        `remaining risk drives (got ${after})`,
      );
    },
  );

  await ok("surface loads for the tenant", async () => {
    const surface = (await loadShadowSurface(db, TENANT)) as { objects: unknown[] };
    assert.ok(Array.isArray(surface.objects) && surface.objects.length >= 1);
  });

  await ok("SHADOW SAFETY: no canonical work/execution/outcome/graph table changed", async () => {
    const after = await counts(FORBIDDEN);
    for (const t of FORBIDDEN) {
      assert.equal(after[t], before[t], `${t} changed by ${after[t] - before[t]} (must be 0)`);
    }
  });
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    purge(TENANT);
    console.log(
      failed === 0
        ? "\ncustomer-health-shadow.test: ALL PASSED"
        : `\ncustomer-health-shadow.test: ${failed} FAILED`,
    );
    process.exit(failed === 0 ? 0 : 1);
  });
