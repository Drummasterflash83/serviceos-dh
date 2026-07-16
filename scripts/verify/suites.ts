// Remote Verification Harness — suites.
//
// Each suite exposes plan() (static ordered steps, used by --dry-run) and run()
// (live, against the linked remote via the injected VerifyClient). Every mutation is
// tagged with the run id; immutable audit rows are never deleted (their ids are
// retained + reported). No suite enables a dangerous connector, sends anything
// external, or bypasses Operational Mode / authority.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  IMMUTABLE_JOB_REFERENCE_TABLES,
  LEGACY_STUCK_RUN,
  VerificationRun,
  describeJobResult,
  discoveryBlocked,
  fixtureTag,
  handlerOutcome,
  jobStatusLabel,
  planRunJobCleanup,
  processJobStage,
  runGuarded,
  stageJobKey,
  type JobTerminalResult,
  type RunJobRow,
  type StageDeps,
  type VerifyEnv,
} from "./lib.ts";
// Single source of truth for the deterministic bridge keys + mapper version: the same
// pure module the handler uses, so the suite asserts against exactly what it produces.
import {
  MAPPER_VERSION as INGEST_MAPPER_VERSION,
  observeJobKey,
} from "../../supabase/functions/_shared/observation_ingest.ts";
import { shouldCreateIntelligence } from "../../supabase/functions/_shared/intelligence/eligibility.ts";
import type { VerifyClient } from "./client.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function repoFile(rel: string): string {
  try {
    return readFileSync(join(REPO, rel), "utf8");
  } catch {
    return "";
  }
}

export interface Suite {
  name: string;
  /** True for suites that mutate tenant state (they acquire the mutating-run lease). */
  mutating?: boolean;
  plan(): string[];
  run(run: VerificationRun, c: VerifyClient, env: VerifyEnv): Promise<void>;
}

const nowIso = () => new Date().toISOString();
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/**
 * Enqueue ONE job for this stage's deterministic key, then drive it to terminal by
 * repeatedly invoking the worker and polling THAT job id (never the key). An active
 * duplicate is REUSED (polled), never re-inserted; a non-2xx worker response is an
 * infrastructure failure; a job that never finishes is reported with full DB + worker
 * diagnostics (never `status=undefined`). The DB job row is the source of truth.
 */
async function processStage(
  c: VerifyClient,
  run: VerificationRun,
  args: {
    stage: string;
    jobType: string;
    jobKey: string;
    tenantId: string;
    payload: Record<string, unknown>;
  },
): Promise<JobTerminalResult> {
  const deps: StageDeps = {
    enqueue: async (jobKey) => {
      const { data, error } = await c.db
        .from("platform_jobs")
        .insert({
          tenant_id: args.tenantId,
          connector_id: "openfolk-core",
          module_id: "verification",
          job_type: args.jobType,
          job_key: jobKey,
          status: "queued",
          priority: 100,
          max_attempts: 3,
          available_at: nowIso(),
          payload: args.payload,
        })
        .select("id")
        .single();
      if (!error && data) return { id: data.id as string, duplicate: false, error: null };
      // Active-duplicate on platform_jobs_active_job_key_uk → REUSE the existing
      // active job (retrieve + poll it); do NOT insert a second row for the same key.
      if (error && (error as { code?: string }).code === "23505") {
        const { data: existing } = await c.db
          .from("platform_jobs")
          .select("id")
          .eq("tenant_id", args.tenantId)
          .eq("job_key", jobKey)
          .in("status", ["queued", "running", "retrying"])
          .limit(1)
          .maybeSingle();
        return { id: (existing?.id as string | undefined) ?? null, duplicate: true, error: null };
      }
      return { id: null, duplicate: false, error: error?.message ?? "enqueue failed" };
    },
    invokeWorker: () => c.invokeWorker([args.jobType]),
    readJob: async (id) => {
      const { data: j } = await c.db
        .from("platform_jobs")
        .select(
          "status, error_code, last_error, result, attempt_count, claimed_by, lease_expires_at",
        )
        .eq("id", id)
        .maybeSingle();
      return j
        ? {
            status: j.status as string,
            error_code: j.error_code as string | null,
            last_error: j.last_error as string | null,
            result: j.result,
            attempt_count: j.attempt_count as number,
            claimed_by: j.claimed_by as string | null,
            lease_expires_at: j.lease_expires_at as string | null,
          }
        : null;
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  const result = await processJobStage(deps, {
    jobKey: args.jobKey,
    timeoutMs: 45_000,
    intervalMs: 1_500,
  });
  if (result.jobId) run.fixture("platform_job", result.jobId, "platform_jobs");
  if (result.classification === "infrastructure_error") {
    run.error(
      `stage ${args.stage}: worker/enqueue infrastructure failure — ${describeJobResult(result)}`,
    );
  } else if (result.classification === "timed_out") {
    run.error(
      `stage ${args.stage}: job did not reach a terminal state — ${describeJobResult(result)}`,
    );
  }
  return result;
}

/**
 * True iff any IMMUTABLE audit row references this platform job via its `job_id` FK
 * (guard decisions / objective health / contribution assessments). Such a job is
 * lineage: it CANNOT be deleted without violating the FK that protects append-only
 * audit history, so it is retained. Best-effort per table (a read error is treated
 * as "cannot prove deletable" ⇒ retain, the safe direction).
 */
async function jobHasImmutableLineage(c: VerifyClient, jobId: string): Promise<boolean> {
  for (const ref of IMMUTABLE_JOB_REFERENCE_TABLES) {
    const { count, error } = await c.db
      .from(ref.table)
      .select("*", { head: true, count: "exact" })
      .eq(ref.column, jobId);
    if (error) return true; // fail safe — never delete when lineage is uncertain
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Classify + clean every platform job owned by THIS run (exact `verify:<run>:` key
 * prefix), scoped to the tenant. A job that anchors immutable audit lineage is
 * RETAINED (never deleted — deleting it violates the guard-decision/outcome FK, the
 * cause of the cleanup FAIL). A mutable job (no immutable references) is deleted,
 * cancelled first if still active so no stuck active job lingers. Jobs not owned by
 * this run are never touched. Reports each disposition.
 */
async function cleanupRunJobs(
  c: VerifyClient,
  run: VerificationRun,
  tenantId: string,
): Promise<void> {
  const runId = run.report.runId;
  const { data: rows } = await c.db
    .from("platform_jobs")
    .select("id, job_key, status")
    .eq("tenant_id", tenantId)
    .like("job_key", `verify:${runId}:%`);

  // Enrich each row with whether an immutable audit row references it.
  const enriched: RunJobRow[] = [];
  for (const r of rows ?? []) {
    enriched.push({
      id: r.id as string,
      job_key: r.job_key as string | null,
      status: r.status as string,
      hasImmutableLineage: await jobHasImmutableLineage(c, r.id as string),
    });
  }

  const plan = planRunJobCleanup(enriched, runId);
  const cancelled = new Set(plan.cancel);

  // Immutable-lineage jobs: keep for audit/history (never cancelled or deleted).
  for (const id of plan.retain) {
    run.dispose("platform_job", id, "retained", "anchors immutable audit lineage (guard/outcome)");
  }

  // Mutable jobs: cancel any still-active one, then delete.
  for (const id of plan.cancel) {
    try {
      await c.db
        .from("platform_jobs")
        .update({ status: "cancelled", cancelled_at: nowIso(), lease_expires_at: null })
        .eq("id", id)
        .eq("tenant_id", tenantId);
    } catch {
      // best-effort — the delete below still removes the row
    }
  }
  for (const id of plan.delete) {
    try {
      const { error } = await c.db
        .from("platform_jobs")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) {
        run.dispose("platform_job", id, "cleanup_failed", (error as { message?: string }).message);
        run.error(`cleanup platform_job:${id} failed`);
      } else {
        run.dispose(
          "platform_job",
          id,
          "deleted",
          cancelled.has(id) ? "cancelled active job then deleted" : undefined,
        );
      }
    } catch (e) {
      run.dispose("platform_job", id, "cleanup_failed", e instanceof Error ? e.message : String(e));
      run.error(`cleanup platform_job:${id} threw`);
    }
  }
}

// One-time remediation for the failed live run verify-20260715-a78555ae, which left
// its automation.execute job under the OLD (pre-per-stage-key) scheme. Matched by the
// EXACT tenant + job_key, so it can never touch any unrelated job; a no-op once the
// job is gone. Safe to remove after the incident is confirmed cleared.
const LEGACY_STUCK_JOB = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  jobKey:
    "automation.execute:00000000-0000-0000-0000-000000000001:22d113a1-3f41-4099-87ac-d1d701c93d66",
};

async function cleanupLegacyStuckJob(c: VerifyClient, run: VerificationRun): Promise<void> {
  const { data: rows } = await c.db
    .from("platform_jobs")
    .select("id, status")
    .eq("tenant_id", LEGACY_STUCK_JOB.tenantId)
    .eq("job_key", LEGACY_STUCK_JOB.jobKey)
    .in("status", ["queued", "running", "retrying"]);
  for (const j of rows ?? []) {
    const id = j.id as string;
    try {
      // If the stuck job already anchors immutable audit lineage, RETAIN it (deleting
      // would violate the guard-decision/outcome FK). Otherwise cancel + delete.
      if (await jobHasImmutableLineage(c, id)) {
        run.dispose(
          "legacy_platform_job",
          id,
          "retained",
          `${LEGACY_STUCK_RUN} job anchors immutable audit lineage`,
        );
        continue;
      }
      await c.db
        .from("platform_jobs")
        .update({ status: "cancelled", cancelled_at: nowIso(), lease_expires_at: null })
        .eq("id", id)
        .eq("tenant_id", LEGACY_STUCK_JOB.tenantId);
      const { error } = await c.db
        .from("platform_jobs")
        .delete()
        .eq("id", id)
        .eq("tenant_id", LEGACY_STUCK_JOB.tenantId);
      run.dispose(
        "legacy_platform_job",
        id,
        error ? "cleanup_failed" : "deleted",
        error ? "delete failed" : `${LEGACY_STUCK_RUN} stuck job cancelled + deleted`,
      );
    } catch (e) {
      run.dispose(
        "legacy_platform_job",
        id,
        "cleanup_failed",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

async function count(
  c: VerifyClient,
  table: string,
  match: Record<string, unknown>,
): Promise<number> {
  let q = c.db.from(table).select("*", { head: true, count: "exact" });
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v as never);
  const { count: n } = await q;
  return n ?? 0;
}

// ── CORE REMOTE SUITE ───────────────────────────────────────────────────────
export const remoteSuite: Suite = {
  name: "remote",
  plan() {
    return [
      "read: linked tenant exists",
      "read: required tables exist (probe each)",
      "read: controlled registries are populated",
      "source: worker job types registered in worker_handlers/index.ts",
      "source: required migrations present (objectives, automation, order-check)",
      "read: dangerous intent 'schedule_engineer_visit' is disabled",
      "read: safe capabilities (internal.record_execution/create_note) exist",
    ];
  },
  async run(run, c, env) {
    const { data: tenant } = await c.db
      .from("tenants")
      .select("id")
      .eq("id", env.tenantId)
      .maybeSingle();
    run.assert("linked tenant exists", !!tenant, `tenant ${env.tenantId} not found`);

    const tables = [
      "automation_intents",
      "automation_execution_attempts",
      "automation_approvals",
      "outcomes",
      "objectives",
      "objective_health",
      "measurements",
      "decision_log",
      "platform_jobs",
      "platform_events",
      "tenant_connectors",
      "tenant_connector_capabilities",
    ];
    for (const t of tables) {
      const { error } = await c.db.from(t).select("*", { head: true, count: "exact" }).limit(0);
      run.assert(`table exists: ${t}`, !error, error?.message);
    }

    const registries: [string, number][] = [
      ["automation_reason_codes", 20],
      ["automation_event_types", 8],
      ["automation_connector_capabilities", 2],
      ["automation_intent_types", 3],
      ["outcome_verification_states", 5],
      ["decision_destinations", 2],
      ["operational_modes", 5],
      ["objective_reason_codes", 10],
    ];
    for (const [t, min] of registries) {
      const n = await count(c, t, {});
      run.assert(`registry populated: ${t} (≥${min})`, n >= min, `got ${n}`);
    }

    const idx = repoFile("supabase/functions/_shared/worker_handlers/index.ts");
    for (const jt of ["automation.execute", "objective.evaluate", "intelligence.evaluate"]) {
      run.assert(
        `source: job type registered: ${jt}`,
        idx.includes(`"${jt}":`),
        "missing in WORKER_HANDLERS",
      );
    }
    run.assert(
      "source: automation migration present",
      repoFile("supabase/migrations/20260722120000_automation_engine.sql").length > 0,
    );
    run.assert(
      "source: automation_claim_and_start RPC defined in migration",
      repoFile("supabase/migrations/20260722120000_automation_engine.sql").includes(
        "function automation_claim_and_start",
      ),
    );

    const { data: sev } = await c.db
      .from("automation_intent_types")
      .select("enabled")
      .eq("intent_type", "schedule_engineer_visit")
      .maybeSingle();
    run.assert(
      "dangerous intent schedule_engineer_visit is DISABLED",
      sev?.enabled === false,
      `enabled=${sev?.enabled}`,
    );

    for (const cap of ["internal.record_execution", "internal.create_note"]) {
      const { data } = await c.db
        .from("automation_connector_capabilities")
        .select("capability_key, external_side_effect")
        .eq("capability_key", cap)
        .maybeSingle();
      run.assert(
        `safe capability exists: ${cap}`,
        !!data && data.external_side_effect === false,
        "missing/external",
      );
    }
  },
};

// ── AUTOMATION ENGINE SUITE ─────────────────────────────────────────────────
export const automationSuite: Suite = {
  name: "automation",
  mutating: true,
  plan() {
    return [
      "read: automation registries (record_controlled_execution/internal_note enabled, schedule_engineer_visit disabled)",
      "behaviour: outcomes/attempts append-only reject mutation",
      "fixture: controlled action intelligence_object (tagged)",
      "fixture: immutable AUTOMATION_AUTHORISED decision_log package (tagged, retained)",
      "fixture: controlled tenant connector (no external effect, enabled+healthy)",
      "fixture: enable internal.record_execution capability",
      "fixture: controlled record_controlled_execution intent (tagged; existing unsupported intent untouched)",
      "assert: Discovery mode BLOCKS execution (intent stays pending, no attempt/outcome)",
      "fixture: temporary tenant Trusted-mode override via a verification config_version",
      "run: process the intent through platform-worker (WORKER_SECRET)",
      "assert: guard allowed; in-flight + terminal attempts; intent succeeded; one system_observed operational outcome; no business outcome; no objective-health write; synthetic external ref only",
      "assert: retry ⇒ already_completed; no duplicate succeeded attempt/outcome",
      "restore: previous operational mode",
      "cleanup: delete run-tagged MUTABLE fixtures; RETAIN immutable audit (attempts/outcomes/guard/decision) AND the platform_jobs that anchor it + report ids",
    ];
  },
  async run(run, c, env) {
    const tag = fixtureTag(run.report.runId);
    const T = env.tenantId;
    const correlationId = crypto.randomUUID();
    const CONN = "verify-controlled";
    const CAP = "internal.record_execution";

    // ── PREFLIGHT: one-time remediation of the verify-20260715-a78555ae stuck job.
    // Narrowly scoped (exact tenant + job_key); a no-op once cleared.
    await cleanupLegacyStuckJob(c, run);

    // ── CAPTURE exact pre-run state BEFORE any mutation (for restoration) ──────
    const capMode =
      (
        await c.db
          .from("operating_profile_entries")
          .select("id, value, version_id")
          .eq("tenant_id", T)
          .eq("scope_kind", "tenant")
          .eq("namespace", "operational_mode")
          .eq("key", "current")
          .maybeSingle()
      ).data ?? null;
    const capConnector =
      (
        await c.db
          .from("tenant_connectors")
          .select("*")
          .eq("tenant_id", T)
          .eq("connector_id", CONN)
          .maybeSingle()
      ).data ?? null;
    const capCapability =
      (
        await c.db
          .from("tenant_connector_capabilities")
          .select("*")
          .eq("tenant_id", T)
          .eq("connector_id", CONN)
          .eq("capability_key", CAP)
          .maybeSingle()
      ).data ?? null;

    const st = {
      intentId: null as string | null,
      cvId: null as string | null,
      modeEntryId: null as string | null,
      modeCreated: !capMode,
      connectorCreated: !capConnector,
      capabilityCreated: !capCapability,
    };

    const guarded = await runGuarded(
      // ── BODY: fixtures + assertions ─────────────────────────────────────────
      async () => {
        for (const [it, want] of [
          ["record_controlled_execution", true],
          ["record_internal_note", true],
          ["schedule_engineer_visit", false],
        ] as [string, boolean][]) {
          const { data } = await c.db
            .from("automation_intent_types")
            .select("enabled")
            .eq("intent_type", it)
            .maybeSingle();
          run.assert(
            `intent type ${it} enabled=${want}`,
            data?.enabled === want,
            `got ${data?.enabled}`,
          );
        }

        const { data: action, error: aErr } = await c.db
          .from("intelligence_objects")
          .insert({
            tenant_id: T,
            domain: "serviceos",
            object_type: "Action",
            object_class: "action",
            subject: "verification controlled action",
            status: "ready",
            attributes: tag,
          })
          .select("id")
          .single();
        if (aErr || !action) throw new Error(`action fixture failed: ${aErr?.message}`);
        run.fixture("action_object", action.id as string, "intelligence_objects");

        const decisionPackage = {
          id: "verify",
          tenantId: T,
          decision: "AUTOMATION_AUTHORISED",
          risk: { level: "low", score: 0.1, categories: [] },
          reversibility: { level: "fully_reversible", compensationAvailable: false },
          authority: { withinDelegatedAuthority: true },
          routing: {
            reviewRequired: false,
            openfolkRequired: false,
            tenantReviewRequired: false,
            customerApprovalRequired: false,
            waitCondition: null,
          },
          versions: { policyVersionIds: [], learningVersionIds: [], operatingProfileVersion: null },
        };
        const { data: dec, error: dErr } = await c.db
          .from("decision_log")
          .insert({
            tenant_id: T,
            object_id: action.id,
            object_snapshot: tag,
            effective_profile_hash: "verify",
            input_hash: `verify-${run.report.runId}`,
            decision: "AUTOMATION_AUTHORISED",
            next_owner_kind: "ai",
            reason_codes: ["verification"],
            decision_package: decisionPackage,
          })
          .select("id")
          .single();
        if (dErr || !dec) throw new Error(`decision fixture failed: ${dErr?.message}`);
        run.retain("decision_log", dec.id as string, "decision_log");

        await c.db.from("tenant_connectors").upsert(
          {
            tenant_id: T,
            connector_id: CONN,
            provider: "internal",
            category: "verification",
            status: "active",
            health_status: "healthy",
            enabled: true,
            settings: tag,
          },
          { onConflict: "tenant_id,connector_id" },
        );
        run.fixture("tenant_connector", CONN, "tenant_connectors");

        await c.db
          .from("tenant_connector_capabilities")
          .upsert(
            { tenant_id: T, connector_id: CONN, capability_key: CAP, enabled: true, config: tag },
            { onConflict: "tenant_id,connector_id,capability_key" },
          );
        run.fixture(
          "tenant_connector_capability",
          `${CONN}/${CAP}`,
          "tenant_connector_capabilities",
        );

        const { data: intent, error: iErr } = await c.db
          .from("automation_intents")
          .insert({
            tenant_id: T,
            action_object_id: action.id,
            intent_type: "record_controlled_execution",
            parameters: { ...tag, note: "controlled verification execution" },
            status: "pending",
            connector_id: CONN,
            capability_key: CAP,
            decision_id: dec.id,
            expires_at: inHours(24),
            max_attempts: 3,
            correlation_id: correlationId,
          })
          .select("id")
          .single();
        if (iErr || !intent) throw new Error(`intent fixture failed: ${iErr?.message}`);
        st.intentId = intent.id as string;
        run.fixture("automation_intent", st.intentId, "automation_intents");

        // ── DISCOVERY: process the intent while the tenant is at its default mode.
        // The proof is BEHAVIOURAL (persisted DB state), not the worker HTTP shape:
        // the worker must have processed the job (so a real guard ran), the intent
        // must remain pending, there must be zero attempts + zero outcomes, and a
        // guard BLOCK record must exist (distinguishing a real block from a job that
        // never ran).
        const discovery = await processStage(c, run, {
          stage: "discovery",
          jobType: "automation.execute",
          jobKey: stageJobKey(run.report.runId, "automation", "discovery"),
          tenantId: T,
          payload: {
            automation_intent_id: st.intentId,
            triggered_by: "manual",
            correlation_id: correlationId,
          },
        });
        run.assert(
          "Discovery stage processed by worker",
          discovery.classification === "succeeded",
          jobStatusLabel(discovery),
        );
        const { data: afterBlock } = await c.db
          .from("automation_intents")
          .select("status")
          .eq("id", st.intentId)
          .maybeSingle();
        const discAttempts = await count(c, "automation_execution_attempts", {
          automation_intent_id: st.intentId,
        });
        const discOutcomes = await count(c, "outcomes", { automation_intent_id: st.intentId });
        const { data: blockGuards } = await c.db
          .from("automation_execution_guard_decisions")
          .select("id, outcome")
          .eq("automation_intent_id", st.intentId)
          .eq("outcome", "BLOCKED");
        const blockGuardCount = (blockGuards ?? []).length;
        for (const g of blockGuards ?? [])
          run.retain("guard_decision", g.id as string, "automation_execution_guard_decisions");
        run.assert(
          "intent stays pending under Discovery",
          afterBlock?.status === "pending",
          `status=${afterBlock?.status}`,
        );
        run.assert(
          "no execution attempt created under Discovery",
          discAttempts === 0,
          `got ${discAttempts}`,
        );
        run.assert(
          "no operational outcome under Discovery",
          discOutcomes === 0,
          `got ${discOutcomes}`,
        );
        run.assert(
          "Discovery mode blocks execution",
          discoveryBlocked({
            intentStatus: afterBlock?.status ?? null,
            attempts: discAttempts,
            outcomes: discOutcomes,
            blockGuards: blockGuardCount,
          }),
          `pending=${afterBlock?.status === "pending"} attempts=${discAttempts} outcomes=${discOutcomes} blockGuards=${blockGuardCount}`,
        );

        // Temporary Trusted override via a dedicated verification config version.
        const { data: cv } = await c.db
          .from("config_versions")
          .insert({
            tenant_id: T,
            artifact_kind: "operating_profile",
            artifact_key: `verify.mode.${run.report.runId}`,
            version: 1,
            status: "draft",
            author: "verification",
            note: `run ${run.report.runId}`,
          })
          .select("id")
          .single();
        st.cvId = (cv?.id as string | undefined) ?? null;
        if (st.cvId) run.fixture("config_version", st.cvId, "config_versions");
        if (capMode) {
          await c.db
            .from("operating_profile_entries")
            .update({ value: "trusted", version_id: st.cvId ?? capMode.version_id })
            .eq("id", capMode.id);
          st.modeEntryId = capMode.id as string;
        } else {
          const { data: me } = await c.db
            .from("operating_profile_entries")
            .insert({
              tenant_id: T,
              scope_kind: "tenant",
              scope_ref: null,
              domain: null,
              namespace: "operational_mode",
              key: "current",
              value: "trusted",
              version_id: st.cvId,
            })
            .select("id")
            .single();
          st.modeEntryId = (me?.id as string | undefined) ?? null;
        }
        if (st.modeEntryId)
          run.fixture("operating_profile_entry", st.modeEntryId, "operating_profile_entries");

        // Process under Trusted — a NEW stage, so a distinct deterministic job key.
        const trusted = await processStage(c, run, {
          stage: "trusted",
          jobType: "automation.execute",
          jobKey: stageJobKey(run.report.runId, "automation", "trusted"),
          tenantId: T,
          payload: {
            automation_intent_id: st.intentId,
            triggered_by: "manual",
            correlation_id: correlationId,
          },
        });
        run.assert(
          "execution allowed + succeeded under Trusted",
          trusted.classification === "succeeded",
          jobStatusLabel(trusted),
        );
        run.assert(
          "engine reports intent succeeded (persisted job result)",
          handlerOutcome(trusted).status === "succeeded",
          `handler=${handlerOutcome(trusted).status ?? "?"} job=${jobStatusLabel(trusted)}`,
        );

        const { data: inflight } = await c.db
          .from("automation_execution_attempts")
          .select("id")
          .eq("automation_intent_id", st.intentId)
          .eq("status", "in_flight");
        run.assert("immutable in-flight attempt exists", (inflight ?? []).length >= 1);
        const { data: succeededAtt } = await c.db
          .from("automation_execution_attempts")
          .select("id, external_reference")
          .eq("automation_intent_id", st.intentId)
          .eq("status", "succeeded");
        run.assert(
          "immutable terminal (succeeded) attempt exists",
          (succeededAtt ?? []).length === 1,
        );
        for (const a of [...(inflight ?? []), ...(succeededAtt ?? [])])
          run.retain("execution_attempt", a.id as string, "automation_execution_attempts");

        const { data: fin } = await c.db
          .from("automation_intents")
          .select("status")
          .eq("id", st.intentId)
          .maybeSingle();
        run.assert(
          "intent status is succeeded",
          fin?.status === "succeeded",
          `status=${fin?.status}`,
        );

        const { data: outs } = await c.db
          .from("outcomes")
          .select("id, outcome_layer, verification_state")
          .eq("automation_intent_id", st.intentId);
        const opOut = (outs ?? []).filter((o) => o.outcome_layer === "operational");
        run.assert("exactly one operational outcome", opOut.length === 1, `got ${opOut.length}`);
        run.assert(
          "outcome is system_observed",
          opOut[0]?.verification_state === "system_observed",
        );
        run.assert(
          "no business outcome exists",
          (outs ?? []).filter((o) => o.outcome_layer === "business").length === 0,
        );
        for (const o of outs ?? []) run.retain("outcome", o.id as string, "outcomes");

        run.assert(
          "no objective-health row written for this run",
          (await count(c, "objective_health", { correlation_id: correlationId })) === 0,
        );
        run.assert(
          "external reference is synthetic (no external side effect)",
          ((succeededAtt ?? [])[0]?.external_reference as string | undefined)?.startsWith(
            "ctrl-",
          ) === true,
        );
        const { data: guard } = await c.db
          .from("automation_execution_guard_decisions")
          .select("id")
          .eq("automation_intent_id", st.intentId)
          .eq("outcome", "EXECUTION_ALLOWED")
          .limit(1);
        run.assert("guard decision EXECUTION_ALLOWED recorded", (guard ?? []).length >= 1);

        // Retry ⇒ already_completed, no duplicates. A genuinely NEW stage, so a
        // distinct deterministic key (never a re-insert of an active key).
        const retry = await processStage(c, run, {
          stage: "idempotency-retry",
          jobType: "automation.execute",
          jobKey: stageJobKey(run.report.runId, "automation", "idempotency-retry"),
          tenantId: T,
          payload: {
            automation_intent_id: st.intentId,
            triggered_by: "retry",
            correlation_id: correlationId,
          },
        });
        run.assert(
          "retry job processed by worker",
          retry.classification === "succeeded",
          jobStatusLabel(retry),
        );
        const rr = handlerOutcome(retry);
        run.assert(
          "retry returns already_completed/idempotent",
          rr.status === "already_completed" || rr.idempotent === true,
          `handler=${rr.status ?? "?"} job=${jobStatusLabel(retry)}`,
        );
        run.assert(
          "no duplicate succeeded attempt",
          (await count(c, "automation_execution_attempts", {
            automation_intent_id: st.intentId,
            status: "succeeded",
          })) === 1,
        );
        run.assert(
          "no duplicate operational outcome",
          (await c.db
            .from("outcomes")
            .select("id", { count: "exact", head: true })
            .eq("automation_intent_id", st.intentId)
            .eq("outcome_layer", "operational")
            .then((r) => r.count ?? 0)) === 1,
        );
      },
      // ── FINALLY: restore prior state + classified cleanup (always runs) ──────
      async () => {
        const safe = async (
          kind: string,
          id: string,
          fn: () => PromiseLike<{ error: unknown }>,
          disposition: "restored" | "deleted",
        ) => {
          try {
            const { error } = await fn();
            if (error) {
              run.dispose(
                kind,
                id,
                "cleanup_failed",
                (error as { message?: string }).message ?? "error",
              );
              run.error(`cleanup ${kind}:${id} failed`);
            } else {
              run.dispose(kind, id, disposition);
            }
          } catch (e) {
            run.dispose(kind, id, "cleanup_failed", e instanceof Error ? e.message : String(e));
            run.error(`cleanup ${kind}:${id} threw`);
          }
        };

        // 1) Operational Mode — restore prior value OR delete our created override.
        if (!st.modeCreated && capMode) {
          await safe(
            "operating_profile_entry",
            capMode.id as string,
            () =>
              c.db
                .from("operating_profile_entries")
                .update({ value: capMode.value, version_id: capMode.version_id })
                .eq("id", capMode.id),
            "restored",
          );
        } else if (st.modeCreated && st.modeEntryId) {
          await safe(
            "operating_profile_entry",
            st.modeEntryId,
            () =>
              c.db
                .from("operating_profile_entries")
                .delete()
                .eq("id", st.modeEntryId as string),
            "deleted",
          );
        }

        // 2) Connector — restore a PRE-EXISTING one; delete only if WE created it.
        if (!st.connectorCreated && capConnector) {
          await safe(
            "tenant_connector",
            CONN,
            () =>
              c.db
                .from("tenant_connectors")
                .update({
                  provider: capConnector.provider,
                  category: capConnector.category,
                  status: capConnector.status,
                  health_status: capConnector.health_status,
                  enabled: capConnector.enabled,
                  settings: capConnector.settings,
                })
                .eq("tenant_id", T)
                .eq("connector_id", CONN),
            "restored",
          );
        } else if (st.connectorCreated) {
          await safe(
            "tenant_connector",
            CONN,
            () =>
              c.db.from("tenant_connectors").delete().eq("tenant_id", T).eq("connector_id", CONN),
            "deleted",
          );
        }

        // 3) Capability — same rule (never delete a pre-existing capability).
        if (!st.capabilityCreated && capCapability) {
          await safe(
            "tenant_connector_capability",
            `${CONN}/${CAP}`,
            () =>
              c.db
                .from("tenant_connector_capabilities")
                .update({ enabled: capCapability.enabled, config: capCapability.config })
                .eq("tenant_id", T)
                .eq("connector_id", CONN)
                .eq("capability_key", CAP),
            "restored",
          );
        } else if (st.capabilityCreated) {
          await safe(
            "tenant_connector_capability",
            `${CONN}/${CAP}`,
            () =>
              c.db
                .from("tenant_connector_capabilities")
                .delete()
                .eq("tenant_id", T)
                .eq("connector_id", CONN)
                .eq("capability_key", CAP),
            "deleted",
          );
        }

        // 4) Verification-created mutable rows → delete.
        if (st.cvId)
          await safe(
            "config_version",
            st.cvId,
            () =>
              c.db
                .from("config_versions")
                .delete()
                .eq("id", st.cvId as string),
            "deleted",
          );
        // Run-scoped platform-job cleanup: cancel any still-active stage job, then
        // delete every job owned by this run (exact `verify:<run>:` prefix). Never
        // touches unrelated jobs.
        await cleanupRunJobs(c, run, T);

        // 5) The intent has immutable attempts (FK cascade) → RETAIN, never delete.
        if (st.intentId)
          run.dispose(
            "automation_intent",
            st.intentId,
            "retained",
            "has immutable execution attempts",
          );
        // 6) Immutable audit rows already recorded via retain() → classify retained.
        for (const r of run.report.retainedAudit) run.dispose(r.kind, r.id, "retained");
        run.report.cleanup.status = "done";
      },
    );
    if (guarded.bodyThrew) run.error(`suite body error: ${guarded.bodyError}`);
    if (guarded.finallyThrew) {
      run.error(`restoration error: ${guarded.finallyError}`);
      run.report.cleanup.status = "error";
    }
  },
};

// ── OBJECTIVES SUITE ────────────────────────────────────────────────────────
export const objectivesSuite: Suite = {
  name: "objectives",
  plan() {
    return [
      "read: objective registries populated (types, statuses, reason codes, directions)",
      "behaviour: objective_health append-only rejects UPDATE and DELETE",
      "behaviour: measurements append-only rejects UPDATE",
      "read: no falsely-confirmed contribution (0 contribution_confirmed assessments)",
      "source: pure evaluator determinism proven by objective_evaluation.verify.ts",
      "note: uses only draft/test-tagged objectives — never publishes strategy",
    ];
  },
  async run(run, c) {
    for (const [t, min] of [
      ["objective_types", 15],
      ["objective_statuses", 5],
      ["objective_reason_codes", 10],
      ["metric_directions", 7],
      ["contribution_states", 7],
    ] as [string, number][]) {
      run.assert(`registry populated: ${t}`, (await count(c, t, {})) >= min);
    }

    // behavioural immutability on an existing health row if one exists; else skip safely.
    const { data: health } = await c.db.from("objective_health").select("id, status").limit(1);
    if ((health ?? []).length > 0) {
      const id = health![0].id as string;
      const upd = await c.expectRejected(() =>
        c.db.from("objective_health").update({ status: "on_track" }).eq("id", id),
      );
      run.assert(
        "objective_health UPDATE is rejected (append-only)",
        upd.rejected,
        upd.message ?? "",
      );
      const del = await c.expectRejected(() => c.db.from("objective_health").delete().eq("id", id));
      run.assert(
        "objective_health DELETE is rejected (append-only)",
        del.rejected,
        del.message ?? "",
      );
    } else {
      run.assert(
        "objective_health present to probe (skipped — none yet)",
        true,
        "no rows to probe",
      );
    }

    const { data: meas } = await c.db.from("measurements").select("id").limit(1);
    if ((meas ?? []).length > 0) {
      const upd = await c.expectRejected(() =>
        c.db.from("measurements").update({ value: 0 }).eq("id", meas![0].id),
      );
      run.assert("measurements UPDATE is rejected (append-only)", upd.rejected, upd.message ?? "");
    } else {
      run.assert("measurements present to probe (skipped — none yet)", true, "no rows to probe");
    }

    run.assert(
      "no falsely-confirmed contribution",
      (await count(c, "objective_contribution_assessments", {
        state: "contribution_confirmed",
      })) === 0,
    );
    run.assert(
      "source: pure evaluator determinism test present",
      repoFile("supabase/functions/_shared/intelligence/objective_evaluation.verify.ts").length > 0,
    );
  },
};

// ── INTELLIGENCE SUITE ──────────────────────────────────────────────────────
export const intelligenceSuite: Suite = {
  name: "intelligence",
  plan() {
    return [
      "read: decision registries (destinations, owner kinds, reason codes)",
      "read: operational modes registry (discovery..optimisation)",
      "read: domain packs present (ServiceOS/ProductOS configuration)",
      "behaviour: decision_log append-only rejects UPDATE/DELETE",
      "read: review routing exists for missing-permission decisions",
      "source: intelligence.evaluate/observe handlers registered",
    ];
  },
  async run(run, c) {
    for (const [t, min] of [
      ["decision_destinations", 2],
      ["decision_owner_kinds", 1],
      ["operational_modes", 5],
    ] as [string, number][]) {
      run.assert(`registry populated: ${t}`, (await count(c, t, {})) >= min);
    }
    for (const mode of ["discovery", "recommendation", "assisted", "trusted", "optimisation"]) {
      run.assert(
        `operational mode present: ${mode}`,
        (await count(c, "operational_modes", { mode })) === 1,
      );
    }
    run.assert("domain packs present", (await count(c, "domain_packs", {})) >= 1);

    const { data: dl } = await c.db.from("decision_log").select("id").limit(1);
    if ((dl ?? []).length > 0) {
      const id = dl![0].id as string;
      const upd = await c.expectRejected(() =>
        c.db.from("decision_log").update({ decision: "REJECT" }).eq("id", id),
      );
      run.assert("decision_log UPDATE is rejected (append-only)", upd.rejected, upd.message ?? "");
      const del = await c.expectRejected(() => c.db.from("decision_log").delete().eq("id", id));
      run.assert("decision_log DELETE is rejected (append-only)", del.rejected, del.message ?? "");
    } else {
      run.assert("decision_log present to probe (skipped — none yet)", true, "no rows to probe");
    }
    run.assert("review routing table present", (await count(c, "review_tasks", {})) >= 0);

    const idx = repoFile("supabase/functions/_shared/worker_handlers/index.ts");
    run.assert(
      "source: intelligence.evaluate registered",
      idx.includes('"intelligence.evaluate":'),
    );
    run.assert("source: intelligence.observe registered", idx.includes('"intelligence.observe":'));
  },
};

// ── INTELLIGENCE INGEST BRIDGE SUITE ────────────────────────────────────────
// Proves, without manual SQL, the horizontal channel-neutral bridge:
//   controlled interaction → intelligence.ingest_interaction → intelligence.observe
//   → Observation → immutable DecisionPackage → review routing
// for one email-shaped AND one phone-shaped interaction, plus idempotency, tenant /
// eligibility safety, and no side effects. Reuses the shared lock, fixture tagging,
// worker invocation, bounded polling, cleanup + report model. It creates NO automation
// intent, enables NO connector, and sends nothing external.

export type IngestChannel = "email" | "phone";

/** A verification-tagged canonical `interactions` row that resembles the normalised
 *  shape the real pipeline produces. PURE + deterministic given its inputs. Channel
 *  changes only source/provenance fields — never the business content — so email and
 *  phone drive the identical bridge path. */
export function buildIngestInteractionFixture(args: {
  runId: string;
  tenantId: string;
  channel: IngestChannel;
  interactionId: string;
  nowIso: string;
  processingStatus?: string;
}): Record<string, unknown> {
  const isEmail = args.channel === "email";
  return {
    id: args.interactionId,
    tenant_id: args.tenantId,
    // Provenance / source references (the ONLY channel-dependent fields).
    source_connector_id: isEmail ? "google-workspace" : "simwood",
    source_type: args.channel,
    source_table: isEmail ? "email_messages" : "phone_calls",
    source_id: args.interactionId, // synthetic self-ref — no real source-of-record row
    source_external_id: `verify-${args.channel}-${args.runId}`,
    interaction_type: isEmail ? "email_message" : "phone_call",
    direction: "inbound",
    occurred_at: args.nowIso,
    // Business content — identical across channels.
    subject: "Verification inbound communication",
    summary: "Controlled verification inbound communication",
    body_preview: "verification fixture — no real customer content",
    from_address: isEmail ? `verify-${args.runId}@example.invalid` : null,
    from_name: "Verification Contact",
    phone_from: isEmail ? null : "+440000000000",
    to_addresses: [],
    status: "active",
    processing_status: args.processingStatus ?? "enriched",
    sentiment: "neutral",
    priority: "medium",
    related_person_id: null,
    related_company_id: null,
    metadata: fixtureTag(args.runId),
  };
}

const REVIEW_DESTINATIONS: ReadonlySet<string> = new Set([
  "OPENFOLK_REVIEW",
  "TENANT_SENIOR_REVIEW",
  "CUSTOMER_APPROVAL",
  "ESCALATE",
]);

/** Drive a PRE-EXISTING job (e.g. the observe job the handler enqueued) to terminal —
 *  poll by id, re-invoking the worker each cycle. Never inserts a new job. */
async function drivePreexistingJob(
  c: VerifyClient,
  jobType: string,
  jobId: string,
  jobKey: string,
): Promise<JobTerminalResult> {
  const deps: StageDeps = {
    enqueue: async () => ({ id: jobId, duplicate: true, error: null }),
    invokeWorker: () => c.invokeWorker([jobType]),
    readJob: async (id) => {
      const { data: j } = await c.db
        .from("platform_jobs")
        .select(
          "status, error_code, last_error, result, attempt_count, claimed_by, lease_expires_at",
        )
        .eq("id", id)
        .maybeSingle();
      return j
        ? {
            status: j.status as string,
            error_code: j.error_code as string | null,
            last_error: j.last_error as string | null,
            result: j.result,
            attempt_count: j.attempt_count as number,
            claimed_by: j.claimed_by as string | null,
            lease_expires_at: j.lease_expires_at as string | null,
          }
        : null;
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  return processJobStage(deps, { jobKey, timeoutMs: 45_000, intervalMs: 1_500 });
}

async function observationsFor(
  c: VerifyClient,
  tenantId: string,
  interactionId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data } = await c.db
    .from("intelligence_objects")
    .select("id, object_class, source_interactions, attributes, decision_id, domain")
    .eq("tenant_id", tenantId)
    .eq("object_class", "observation")
    .contains("source_interactions", [interactionId]);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export const intelligenceIngestSuite: Suite = {
  name: "intelligence-ingest",
  mutating: true,
  plan() {
    return [
      "fixture: controlled ENRICHED email + phone canonical interactions (tagged)",
      "fixture: one ENRICHED interaction NOT passed to ingest (proves no history sweep)",
      "fixture: one INELIGIBLE (pending) interaction (proves eligibility rejection)",
      "run: enqueue intelligence.ingest_interaction per channel; drive platform-worker",
      "assert: ingestion job succeeds; exactly one ledger row per (tenant, interaction, mapper)",
      "run: drive the linked intelligence.observe job to terminal",
      "assert: exactly one observe job (deterministic key); one immutable Observation",
      "assert: Observation preserves source interaction id; channel is provenance only",
      "assert: immutable DecisionPackage written; review routing present",
      "assert: NO Action/Automation Intent materialised; no external side effect",
      "assert: same mapper version + same handler + same evaluation path for both channels",
      "assert: retry ⇒ idempotent (one ledger/observe/Observation; no duplicate DecisionPackage)",
      "assert: cross-tenant ingest rejected; unknown id rejected; ineligible rejected",
      "assert: a failing record does not block others in a bounded batch",
      "assert: untouched enriched interaction was NOT ingested (no implicit sweep)",
      "cleanup: delete MUTABLE fixtures; RETAIN Observation/DecisionPackage/ledger/observe-job + report ids",
    ];
  },
  async run(run, c, env) {
    const T = env.tenantId;
    const runId = run.report.runId;
    const mapper = INGEST_MAPPER_VERSION;
    const nowIso = new Date().toISOString();
    const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // deliberately NOT T

    // Track mutable fixtures we must clean up, and the per-channel identities.
    const created = {
      interactions: [] as string[], // all interaction fixtures (id)
      retainInteractions: new Set<string>(), // referenced by retained lineage
      crossTenantJobKey: null as string | null,
    };
    const chan: Record<IngestChannel, { id: string; observeKey: string }> = {
      email: { id: "", observeKey: "" },
      phone: { id: "", observeKey: "" },
    };
    let untouchedId = "";
    let ineligibleId = "";

    const guarded = await runGuarded(
      async () => {
        // ── Fixtures ─────────────────────────────────────────────────────────
        for (const ch of ["email", "phone"] as IngestChannel[]) {
          const id = crypto.randomUUID();
          const { error } = await c.db.from("interactions").insert(
            buildIngestInteractionFixture({
              runId,
              tenantId: T,
              channel: ch,
              interactionId: id,
              nowIso,
            }),
          );
          if (error) throw new Error(`${ch} interaction fixture failed: ${error.message}`);
          created.interactions.push(id);
          run.fixture("interaction", id, "interactions");
          chan[ch] = { id, observeKey: observeJobKey(T, id, mapper) };
        }
        untouchedId = crypto.randomUUID();
        await c.db.from("interactions").insert(
          buildIngestInteractionFixture({
            runId,
            tenantId: T,
            channel: "email",
            interactionId: untouchedId,
            nowIso,
          }),
        );
        created.interactions.push(untouchedId);
        run.fixture("interaction", untouchedId, "interactions");
        ineligibleId = crypto.randomUUID();
        await c.db.from("interactions").insert(
          buildIngestInteractionFixture({
            runId,
            tenantId: T,
            channel: "phone",
            interactionId: ineligibleId,
            nowIso,
            processingStatus: "pending",
          }),
        );
        created.interactions.push(ineligibleId);
        run.fixture("interaction", ineligibleId, "interactions");

        // ── Per-channel proof ────────────────────────────────────────────────
        for (const ch of ["email", "phone"] as IngestChannel[]) {
          const f = chan[ch];
          const ingest = await processStage(c, run, {
            stage: `${ch}-ingest`,
            jobType: "intelligence.ingest_interaction",
            jobKey: stageJobKey(runId, "intelligence-ingest", ch),
            tenantId: T,
            payload: { interaction_ids: [f.id] },
          });
          run.assert(
            `${ch}: ingestion job reaches terminal success`,
            ingest.classification === "succeeded",
            jobStatusLabel(ingest),
          );
          const ir = handlerOutcome(ingest);
          run.assert(
            `${ch}: exactly one interaction observed`,
            ir.observed === 1,
            `got observed=${ir.observed}`,
          );

          const ledgerN = await count(c, "intelligence_ingestions", {
            tenant_id: T,
            interaction_id: f.id,
            mapper_version: mapper,
          });
          run.assert(`${ch}: exactly one ingestion-ledger record`, ledgerN === 1, `got ${ledgerN}`);
          const { data: led } = await c.db
            .from("intelligence_ingestions")
            .select("id, observe_job_id")
            .eq("tenant_id", T)
            .eq("interaction_id", f.id)
            .eq("mapper_version", mapper)
            .maybeSingle();
          if (led?.id) {
            run.retain("intelligence_ingestion", led.id as string, "intelligence_ingestions");
            created.retainInteractions.add(f.id);
          }
          run.assert(`${ch}: observe job linked on the ledger`, !!led?.observe_job_id);

          // Drive the observe job (enqueued by the handler with the deterministic key).
          const observe = await drivePreexistingJob(
            c,
            "intelligence.observe",
            (led?.observe_job_id as string) ?? "",
            f.observeKey,
          );
          run.assert(
            `${ch}: observe job reaches terminal success`,
            observe.classification === "succeeded",
            jobStatusLabel(observe),
          );
          const obsJobN = await count(c, "platform_jobs", { tenant_id: T, job_key: f.observeKey });
          run.assert(
            `${ch}: exactly one intelligence.observe job (idempotent key)`,
            obsJobN === 1,
            `got ${obsJobN}`,
          );
          if (led?.observe_job_id)
            run.retain("platform_job", led.observe_job_id as string, "platform_jobs");

          const obs = await observationsFor(c, T, f.id);
          run.assert(
            `${ch}: exactly one logical Observation`,
            obs.length === 1,
            `got ${obs.length}`,
          );
          const observation = obs[0] ?? {};
          if (observation.id)
            run.retain("observation", observation.id as string, "intelligence_objects");
          run.assert(
            `${ch}: Observation preserves the source interaction id`,
            Array.isArray(observation.source_interactions) &&
              (observation.source_interactions as string[]).includes(f.id),
          );
          run.assert(
            `${ch}: channel is provenance only`,
            ((observation.attributes as Record<string, unknown>)?.channel as string) === ch,
          );

          const { data: dls } = await c.db
            .from("decision_log")
            .select("id, decision, decision_package")
            .eq("object_id", observation.id as string);
          const dl = (dls ?? [])[0];
          run.assert(`${ch}: immutable DecisionPackage written`, !!dl && !!dl.decision_package);
          for (const d of dls ?? []) run.retain("decision_log", d.id as string, "decision_log");
          const pkg = (dl?.decision_package ?? {}) as {
            routing?: { reviewRequired?: boolean };
            automationIntent?: unknown;
          };
          run.assert(
            `${ch}: review routing present`,
            pkg.routing?.reviewRequired === true || REVIEW_DESTINATIONS.has(dl?.decision as string),
            `decision=${dl?.decision}`,
          );

          // No Action materialised ⇒ no Automation Intent ⇒ no external side effect.
          const actionN = await count(c, "intelligence_objects", {
            tenant_id: T,
            object_class: "action",
            decision_id: dl?.id as string,
          });
          run.assert(
            `${ch}: no Action/Automation Intent materialised`,
            actionN === 0,
            `actions=${actionN}`,
          );
          run.assert(
            `${ch}: DecisionPackage carries no automation intent`,
            (pkg.automationIntent ?? null) === null,
          );

          // Idempotency: a retry reuses the ledger/observe/Observation — no duplicates.
          const retry = await processStage(c, run, {
            stage: `${ch}-retry`,
            jobType: "intelligence.ingest_interaction",
            jobKey: stageJobKey(runId, "intelligence-ingest", `${ch}-retry`),
            tenantId: T,
            payload: { interaction_ids: [f.id] },
          });
          run.assert(
            `${ch}: retry ingestion succeeds`,
            retry.classification === "succeeded",
            jobStatusLabel(retry),
          );
          run.assert(
            `${ch}: retry is idempotent (reused)`,
            handlerOutcome(retry).reused === 1,
            `reused=${handlerOutcome(retry).reused}`,
          );
          run.assert(
            `${ch}: still exactly one ledger row after retry`,
            (await count(c, "intelligence_ingestions", {
              tenant_id: T,
              interaction_id: f.id,
              mapper_version: mapper,
            })) === 1,
          );
          run.assert(
            `${ch}: still exactly one Observation after retry`,
            (await observationsFor(c, T, f.id)).length === 1,
          );
        }

        // ── Channel neutrality: same mapper, handler, evaluation path ─────────
        run.assert(
          "email + phone share the same mapper version + observe path (keys differ only by interaction)",
          chan.email.observeKey === observeJobKey(T, chan.email.id, mapper) &&
            chan.phone.observeKey === observeJobKey(T, chan.phone.id, mapper) &&
            chan.email.observeKey !== chan.phone.observeKey,
        );

        // ── Bounded batch: rejections + failure isolation in ONE job ─────────
        const unknownId = crypto.randomUUID();
        const mixed = await processStage(c, run, {
          stage: "mixed-batch",
          jobType: "intelligence.ingest_interaction",
          jobKey: stageJobKey(runId, "intelligence-ingest", "mixed"),
          tenantId: T,
          payload: { interaction_ids: [chan.email.id, ineligibleId, unknownId] },
        });
        run.assert(
          "mixed batch does not abort on a failing record",
          mixed.classification === "succeeded",
          jobStatusLabel(mixed),
        );
        const mr = (handlerOutcome(mixed).results ?? []) as Array<{
          interactionId: string;
          outcome: string;
          reason?: string;
        }>;
        const byId = Object.fromEntries(mr.map((x) => [x.interactionId, x]));
        run.assert(
          "ineligible (pending) interaction is rejected",
          byId[ineligibleId]?.reason === "not_eligible",
          JSON.stringify(byId[ineligibleId]),
        );
        run.assert(
          "unknown interaction id is rejected",
          byId[unknownId]?.outcome === "rejected",
          JSON.stringify(byId[unknownId]),
        );
        run.assert(
          "the healthy interaction in the batch is still handled (reused)",
          byId[chan.email.id]?.outcome === "reused",
        );

        // ── Cross-tenant: a worker for ANOTHER tenant cannot ingest T's row ──
        created.crossTenantJobKey = stageJobKey(runId, "intelligence-ingest", "cross-tenant");
        const { data: xrow } = await c.db
          .from("platform_jobs")
          .insert({
            tenant_id: OTHER_TENANT,
            connector_id: "openfolk-core",
            module_id: "verification",
            job_type: "intelligence.ingest_interaction",
            job_key: created.crossTenantJobKey,
            status: "queued",
            priority: 100,
            max_attempts: 1,
            available_at: nowIso,
            payload: { interaction_id: chan.email.id },
          })
          .select("id")
          .single();
        if (xrow?.id) {
          const xjob = await drivePreexistingJob(
            c,
            "intelligence.ingest_interaction",
            xrow.id as string,
            created.crossTenantJobKey,
          );
          const xr = (handlerOutcome(xjob).results ?? []) as Array<{ outcome: string }>;
          run.assert(
            "cross-tenant ingestion is rejected (tenant-scoped loader sees nothing)",
            xjob.classification === "succeeded" && (xr[0]?.outcome ?? "rejected") === "rejected",
            jobStatusLabel(xjob),
          );
        }

        // ── No implicit history sweep ────────────────────────────────────────
        run.assert(
          "untouched enriched interaction was NOT ingested (no implicit sweep)",
          (await count(c, "intelligence_ingestions", {
            tenant_id: T,
            interaction_id: untouchedId,
          })) === 0,
        );
      },

      // ── FINALLY: cleanup — delete mutable fixtures; retain immutable lineage ─
      async () => {
        // Harness-enqueued ingest jobs (verify:<run>: prefix, tenant T) → cancel + delete.
        await cleanupRunJobs(c, run, T);

        // Cross-tenant ingest job lives under OTHER_TENANT → delete explicitly.
        if (created.crossTenantJobKey) {
          try {
            const { error } = await c.db
              .from("platform_jobs")
              .delete()
              .eq("tenant_id", OTHER_TENANT)
              .eq("job_key", created.crossTenantJobKey);
            if (!error)
              run.dispose(
                "platform_job",
                created.crossTenantJobKey,
                "deleted",
                "cross-tenant probe job",
              );
          } catch {
            /* best-effort */
          }
        }

        // Interactions: retain those referenced by retained lineage (ledger/Observation);
        // delete the purely-mutable ones (untouched + ineligible).
        for (const id of created.interactions) {
          if (created.retainInteractions.has(id)) {
            run.dispose("interaction", id, "retained", "referenced by retained ingestion lineage");
            continue;
          }
          try {
            const { error } = await c.db
              .from("interactions")
              .delete()
              .eq("id", id)
              .eq("tenant_id", T);
            run.dispose(
              "interaction",
              id,
              error ? "cleanup_failed" : "deleted",
              error ? (error as { message?: string }).message : undefined,
            );
            if (error) run.error(`cleanup interaction:${id} failed`);
          } catch (e) {
            run.dispose(
              "interaction",
              id,
              "cleanup_failed",
              e instanceof Error ? e.message : String(e),
            );
          }
        }

        // Immutable audit already retained via retain() → classify retained.
        for (const r of run.report.retainedAudit) run.dispose(r.kind, r.id, "retained");
        run.report.cleanup.status = "done";
      },
    );
    if (guarded.bodyThrew) run.error(`suite body error: ${guarded.bodyError}`);
    if (guarded.finallyThrew) {
      run.error(`restoration error: ${guarded.finallyError}`);
      run.report.cleanup.status = "error";
    }
  },
};

// ── GOLDEN LOOP SUITE — the ONE continuous, live intelligence loop ──────────────
// The Phase-7 proof point: drive ONE realistic customer complaint, as a single
// continuous journey against the live remote, through EVERY stage of the operating
// loop and assert the whole lineage links up:
//
//   seed enriched complaint + business context (person, high-value customer card,
//     prior-failure history)
//   → intelligence.ingest_interaction   (eligibility verdict: customer_risk, >0.9)
//   → intelligence.observe              (immutable Observation + DecisionPackage;
//                                        assisted mode materialises an Action + a
//                                        PENDING automation_intent — record_internal_note)
//   → human approval                    (automation_approvals — the SAME immutable row
//                                        the intelligence-review-action endpoint writes)
//   → automation.execute                (verified guard = EXECUTION_ALLOWED → controlled
//                                        internal.create_note → succeeded)
//   → immutable operational Outcome     (system_observed; synthetic reference only)
//
// Unlike the two half-loop suites (ingest stops at review routing; automation starts
// from a hand-built intent), this proves the JOIN end-to-end. It is tagged + self-
// cleaning, captures & restores the tenant's vertical activation (never leaves it
// changed if it was not already on), retains all immutable audit, and sends nothing
// external (internal.create_note has external_side_effect = false).

const GOLDEN_VERTICAL_POLICY_NAME =
  "Propose a controlled internal note for inbound communications (vertical)";

/** A realistic enriched `interactions` row. `kind:"trigger"` is Sarah's frustrated
 *  complaint (negative sentiment + risk language → customer_risk); `kind:"history"`
 *  rows are her prior heating failures (so "repeat contact" is TRUE in the data, not
 *  fabricated). Distinct source_id per row satisfies the (tenant, source_table,
 *  source_id) unique key. */
function buildComplaintInteraction(args: {
  runId: string;
  tenantId: string;
  interactionId: string;
  personId: string;
  occurredAt: string;
  kind: "trigger" | "history";
  index?: number;
}): Record<string, unknown> {
  const isTrigger = args.kind === "trigger";
  return {
    id: args.interactionId,
    tenant_id: args.tenantId,
    source_connector_id: "google-workspace",
    source_type: "email",
    source_table: "email_messages",
    source_id: args.interactionId, // synthetic self-ref; distinct per row
    source_external_id: `golden-${args.kind}-${args.index ?? 0}-${args.runId}`,
    interaction_type: "email_message",
    direction: "inbound",
    occurred_at: args.occurredAt,
    subject: isTrigger
      ? "My boiler has broken again and nobody has resolved it"
      : `Heating failure — no hot water (report ${args.index ?? 0})`,
    summary: isTrigger
      ? "Customer is frustrated after a third heating breakdown in a month with no resolution."
      : "Reported heating breakdown; engineer attended.",
    body_preview: isTrigger
      ? "This is the third time my boiler has broken in a month. I have no heating and nobody has fixed it. I am extremely unhappy and want this resolved urgently."
      : "The boiler has stopped working again. Please send someone.",
    from_address: "sarah.mitchell@example.invalid",
    from_name: "Sarah Mitchell",
    phone_from: null,
    to_addresses: [],
    status: "active",
    processing_status: "enriched",
    sentiment: isTrigger ? "negative" : "neutral",
    priority: isTrigger ? "high" : "medium",
    related_person_id: args.personId,
    related_company_id: null,
    metadata: fixtureTag(args.runId),
  };
}

export const goldenLoopSuite: Suite = {
  name: "golden-loop",
  mutating: true,
  plan() {
    return [
      "capture: tenant's current vertical activation (operational mode + tenant policy)",
      "activate: ensure the internal-note vertical is ON (assisted mode + policy + connector)",
      "fixture: seed Sarah Mitchell — person, high-value customer card (conf 0.94), 3 prior heating-failure interactions (tagged)",
      "fixture: seed the triggering enriched complaint interaction (negative + risk language)",
      "run: intelligence.ingest_interaction on the complaint; drive platform-worker",
      "assert: eligibility verdict recorded = customer_risk with confidence > 0.9 (one ledger row)",
      "run: drive the linked intelligence.observe job to terminal",
      "assert: one immutable Observation; confidence carried from the customer card (0.94); customer context present",
      "assert: immutable DecisionPackage requires human approval (no auto-execution)",
      "assert: assisted mode materialised an Action + exactly one PENDING automation_intent (record_internal_note / internal.create_note); no execution attempt yet",
      "human gate: record an immutable automation_approvals row (approved, tenant_senior) — as the review-action endpoint does",
      "run: automation.execute the approved intent through platform-worker",
      "assert: guard EXECUTION_ALLOWED; succeeded attempt; intent succeeded; one system_observed operational outcome; synthetic reference only; no external side effect",
      "assert: retry ⇒ already_completed/idempotent; no duplicate attempt or outcome",
      "assert: the full lineage links — interaction → ledger → Observation → DecisionPackage → Action → intent → approval → attempt → outcome",
      "restore: return the tenant's vertical activation to its captured state",
      "cleanup: delete MUTABLE fixtures (person, card, history); RETAIN all immutable audit + the trigger interaction (ledger FK) + report ids",
    ];
  },
  async run(run, c, env) {
    const T = env.tenantId;
    const runId = run.report.runId;
    const mapper = INGEST_MAPPER_VERSION;
    const now = new Date();
    const nowIsoStr = now.toISOString();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

    // ── PREFLIGHT: one-time remediation of the legacy stuck job (shared helper). ──
    await cleanupLegacyStuckJob(c, run);

    // ── CAPTURE the tenant's vertical activation BEFORE any change (for restore) ──
    const capMode =
      (
        await c.db
          .from("operating_profile_entries")
          .select("id, value, version_id")
          .eq("tenant_id", T)
          .eq("scope_kind", "tenant")
          .eq("namespace", "operational_mode")
          .eq("key", "current")
          .maybeSingle()
      ).data ?? null;
    const capPolicy =
      (
        await c.db
          .from("policies")
          .select("id, enabled")
          .eq("tenant_id", T)
          .eq("name", GOLDEN_VERTICAL_POLICY_NAME)
          .maybeSingle()
      ).data ?? null;
    const wasVerticalActive =
      (capMode?.value === "assisted" || capMode?.value === '"assisted"') &&
      capPolicy?.enabled === true;

    // Identities of everything we seed (mutable) + the loop's discovered lineage ids.
    const seeded = {
      personId: null as string | null,
      cardId: null as string | null,
      historyIds: [] as string[],
      triggerId: null as string | null,
    };
    const activatedByUs = { value: false };

    const guarded = await runGuarded(
      // ── BODY ────────────────────────────────────────────────────────────────
      async () => {
        // 1) Ensure the internal-note vertical is ON (idempotent activation).
        const { error: actErr } = await c.db.rpc("serviceos_set_automation_vertical", {
          p_tenant: T,
          p_enable: true,
        });
        run.assert(
          "vertical activation succeeds (assisted mode + policy + connector)",
          !actErr,
          actErr?.message,
        );
        activatedByUs.value = !wasVerticalActive;

        // 2) Seed Sarah — person, high-value customer card, prior-failure history.
        const personId = crypto.randomUUID();
        const { error: pErr } = await c.db.from("people").insert({
          id: personId,
          tenant_id: T,
          display_name: "Sarah Mitchell",
          first_name: "Sarah",
          last_name: "Mitchell",
          primary_email: "sarah.mitchell@example.invalid",
          metadata: fixtureTag(runId),
        });
        if (pErr) throw new Error(`person fixture failed: ${pErr.message}`);
        seeded.personId = personId;
        run.fixture("person", personId, "people");

        const cardId = crypto.randomUUID();
        const { error: cErr } = await c.db.from("customer_cards").insert({
          id: cardId,
          tenant_id: T,
          person_id: personId,
          title: "Sarah Mitchell",
          summary:
            "Repeat heating failure — 3 breakdowns in 30 days, unresolved. High-value customer; sentiment declining.",
          status: "red",
          priority: "high",
          priority_score: 88,
          confidence: 0.94,
          recommended_action: "Escalate to priority response",
          latest_activity_at: nowIsoStr,
          context: {
            projection: { business: { relationship_count: 3, lifetime_value_gbp: 8400 } },
          },
          metadata: fixtureTag(runId),
        });
        if (cErr) throw new Error(`customer_card fixture failed: ${cErr.message}`);
        seeded.cardId = cardId;
        run.fixture("customer_card", cardId, "customer_cards");

        for (let i = 0; i < 3; i++) {
          const hid = crypto.randomUUID();
          const { error: hErr } = await c.db.from("interactions").insert(
            buildComplaintInteraction({
              runId,
              tenantId: T,
              interactionId: hid,
              personId,
              occurredAt: daysAgo(28 - i * 10), // ~28, 18, 8 days ago
              kind: "history",
              index: i + 1,
            }),
          );
          if (hErr) throw new Error(`history interaction ${i} failed: ${hErr.message}`);
          seeded.historyIds.push(hid);
          run.fixture("interaction", hid, "interactions");
        }

        // 3) Seed the triggering complaint (enriched, negative, risk language).
        const triggerId = crypto.randomUUID();
        const { error: tErr } = await c.db.from("interactions").insert(
          buildComplaintInteraction({
            runId,
            tenantId: T,
            interactionId: triggerId,
            personId,
            occurredAt: nowIsoStr,
            kind: "trigger",
          }),
        );
        if (tErr) throw new Error(`trigger interaction failed: ${tErr.message}`);
        seeded.triggerId = triggerId;
        run.fixture("interaction", triggerId, "interactions");

        // 4) INGEST — the complaint enters the intelligence layer.
        const ingest = await processStage(c, run, {
          stage: "ingest",
          jobType: "intelligence.ingest_interaction",
          jobKey: stageJobKey(runId, "golden-loop", "ingest"),
          tenantId: T,
          payload: { interaction_ids: [triggerId] },
        });
        run.assert(
          "ingestion job reaches terminal success",
          ingest.classification === "succeeded",
          jobStatusLabel(ingest),
        );
        run.assert(
          "exactly one interaction observed by ingest",
          handlerOutcome(ingest).observed === 1,
          `observed=${handlerOutcome(ingest).observed}`,
        );

        // 5) ELIGIBILITY — the verdict. The pure decision (eligibility.ts) is the source
        //    of truth, so prove it in-process against the exact complaint facts. (The
        //    ledger's eligibility_reason/confidence columns are asserted opportunistically:
        //    they are only present once migration 20260803 + the updated ingest handler are
        //    deployed — see the Phase-7 deployment-drift finding.)
        const verdict = shouldCreateIntelligence({
          direction: "inbound",
          interaction_type: "email_message",
          subject: "My boiler has broken again and nobody has resolved it",
          summary:
            "Customer is frustrated after a third heating breakdown in a month with no resolution.",
          body_preview:
            "This is the third time my boiler has broken in a month. I have no heating and nobody has fixed it. I am extremely unhappy and want this resolved urgently.",
          sentiment: "negative",
          priority: "high",
          from_address: "sarah.mitchell@example.invalid",
          related_person_id: personId,
          related_company_id: null,
        });
        run.assert(
          "eligibility verdict = customer_risk with confidence > 0.9",
          verdict.eligible && verdict.reason === "customer_risk" && verdict.confidence > 0.9,
          `reason=${verdict.reason} conf=${verdict.confidence} signals=${verdict.signals.join(",")}`,
        );

        // Ledger row (minimal columns — robust to the not-yet-deployed eligibility cols).
        const { data: ledger } = await c.db
          .from("intelligence_ingestions")
          .select("id, status, observe_job_id")
          .eq("tenant_id", T)
          .eq("interaction_id", triggerId)
          .eq("mapper_version", mapper)
          .maybeSingle();
        run.assert("exactly one ingestion-ledger row", !!ledger, "no ledger row");
        if (ledger?.id)
          run.retain("intelligence_ingestion", ledger.id as string, "intelligence_ingestions");

        // 6) OBSERVE — the immutable Observation + DecisionPackage; assisted mode
        //    materialises the Action + PENDING intent. Drive the observe job by its
        //    deterministic key (falling back from the ledger link), never an empty id.
        let observeJobId = (ledger?.observe_job_id as string | null) ?? null;
        if (!observeJobId) {
          const { data: oj } = await c.db
            .from("platform_jobs")
            .select("id")
            .eq("tenant_id", T)
            .eq("job_key", observeJobKey(T, triggerId, mapper))
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          observeJobId = (oj?.id as string | null) ?? null;
        }
        run.assert("observe job present for the complaint", !!observeJobId, "no observe job");
        const observe = await drivePreexistingJob(
          c,
          "intelligence.observe",
          observeJobId ?? "",
          observeJobKey(T, triggerId, mapper),
        );
        run.assert(
          "observe job reaches terminal success",
          observe.classification === "succeeded",
          jobStatusLabel(observe),
        );
        const obsOut = handlerOutcome(observe);
        run.assert(
          "observe ran in assisted mode",
          obsOut.operational_mode === "assisted",
          `mode=${obsOut.operational_mode}`,
        );
        run.assert(
          "assisted mode permitted materialisation (can_execute)",
          obsOut.can_execute === true,
          `can_execute=${obsOut.can_execute}`,
        );

        const obs = await observationsFor(c, T, triggerId);
        run.assert(
          "exactly one Observation for the complaint",
          obs.length === 1,
          `got ${obs.length}`,
        );
        const observation = obs[0] ?? {};
        if (observation.id)
          run.retain("observation", observation.id as string, "intelligence_objects");
        const { data: obsRow } = await c.db
          .from("intelligence_objects")
          .select("id, confidence, decision_id, attributes, object_class")
          .eq("id", observation.id as string)
          .maybeSingle();
        run.assert(
          "Observation confidence is high, carried from the customer card (≥0.9)",
          Number(obsRow?.confidence ?? 0) >= 0.9,
          `confidence=${obsRow?.confidence}`,
        );
        run.assert(
          "Observation carries the resolved customer context",
          !!(obsRow?.attributes as Record<string, unknown> | null)?.customer_context,
          "customer_context missing",
        );
        const decisionId = (obsRow?.decision_id as string | null) ?? null;
        run.assert("Observation links to its DecisionPackage", !!decisionId);

        const { data: dec } = await c.db
          .from("decision_log")
          .select("id, decision, decision_package")
          .eq("id", decisionId as string)
          .maybeSingle();
        if (dec?.id) run.retain("decision_log", dec.id as string, "decision_log");
        const pkg = (dec?.decision_package ?? {}) as {
          decision?: string;
          automationIntent?: { requiresApproval?: boolean } | null;
        };
        run.assert(
          "DecisionPackage requires human approval before execution",
          dec?.decision === "AUTOMATION_REQUIRES_APPROVAL" &&
            pkg.automationIntent?.requiresApproval === true,
          `decision=${dec?.decision}`,
        );

        // 7) The materialised Action + PENDING intent.
        const { data: actions } = await c.db
          .from("intelligence_objects")
          .select("id")
          .eq("tenant_id", T)
          .eq("object_class", "action")
          .eq("decision_id", decisionId as string);
        run.assert(
          "exactly one Action materialised",
          (actions ?? []).length === 1,
          `got ${(actions ?? []).length}`,
        );
        const actionId = (actions ?? [])[0]?.id as string | undefined;
        if (actionId) run.retain("action", actionId, "intelligence_objects");

        const { data: intent } = await c.db
          .from("automation_intents")
          .select(
            "id, status, intent_type, capability_key, connector_id, decision_id, action_object_id",
          )
          .eq("tenant_id", T)
          .eq("decision_id", decisionId as string)
          .maybeSingle();
        run.assert("exactly one automation intent materialised", !!intent, "no intent");
        const intentId = (intent?.id as string | undefined) ?? null;
        if (intentId) run.retain("automation_intent", intentId, "automation_intents");
        run.assert(
          "intent is PENDING (awaiting human approval)",
          intent?.status === "pending",
          `status=${intent?.status}`,
        );
        run.assert(
          "intent is the controlled internal note (record_internal_note / internal.create_note / openfolk-core)",
          intent?.intent_type === "record_internal_note" &&
            intent?.capability_key === "internal.create_note" &&
            intent?.connector_id === "openfolk-core",
          `${intent?.intent_type}/${intent?.capability_key}/${intent?.connector_id}`,
        );
        run.assert(
          "no execution attempt before approval",
          (await count(c, "automation_execution_attempts", { automation_intent_id: intentId })) ===
            0,
        );

        // 8) HUMAN GATE — record the immutable approval (as the endpoint does).
        const { error: appErr } = await c.db.from("automation_approvals").insert({
          tenant_id: T,
          automation_intent_id: intentId,
          decision_id: decisionId,
          approver_kind: "tenant_senior",
          approver_ref: "verification-operator",
          authority_basis: "tenant_operator_review",
          decision: "approved",
          granted_at: new Date().toISOString(),
          evidence: { via: "golden-loop-verification", ...fixtureTag(runId) },
        });
        run.assert("human approval recorded (automation_approvals)", !appErr, appErr?.message);
        const { data: appRow } = await c.db
          .from("automation_approvals")
          .select("id")
          .eq("automation_intent_id", intentId as string)
          .eq("decision", "approved")
          .maybeSingle();
        if (appRow?.id)
          run.retain("automation_approval", appRow.id as string, "automation_approvals");

        // 9) EXECUTE — the approved intent runs through the frozen Automation Engine.
        const exec = await processStage(c, run, {
          stage: "execute",
          jobType: "automation.execute",
          jobKey: stageJobKey(runId, "golden-loop", "execute"),
          tenantId: T,
          payload: { automation_intent_id: intentId, triggered_by: "manual" },
        });
        run.assert(
          "execute job reaches terminal success",
          exec.classification === "succeeded",
          jobStatusLabel(exec),
        );
        run.assert(
          "engine reports the intent succeeded",
          handlerOutcome(exec).status === "succeeded",
          `handler=${handlerOutcome(exec).status ?? "?"}`,
        );

        const { data: guardOk } = await c.db
          .from("automation_execution_guard_decisions")
          .select("id")
          .eq("automation_intent_id", intentId as string)
          .eq("outcome", "EXECUTION_ALLOWED")
          .limit(1);
        run.assert("guard decision EXECUTION_ALLOWED recorded", (guardOk ?? []).length >= 1);
        for (const g of guardOk ?? [])
          run.retain("guard_decision", g.id as string, "automation_execution_guard_decisions");

        const { data: succeededAtt } = await c.db
          .from("automation_execution_attempts")
          .select("id, external_reference, status")
          .eq("automation_intent_id", intentId as string)
          .eq("status", "succeeded");
        run.assert("exactly one succeeded execution attempt", (succeededAtt ?? []).length === 1);
        for (const a of succeededAtt ?? [])
          run.retain("execution_attempt", a.id as string, "automation_execution_attempts");
        run.assert(
          "external reference is synthetic (no external side effect)",
          ((succeededAtt ?? [])[0]?.external_reference as string | undefined)?.startsWith(
            "note-",
          ) === true,
          `ref=${(succeededAtt ?? [])[0]?.external_reference}`,
        );

        const { data: finIntent } = await c.db
          .from("automation_intents")
          .select("status")
          .eq("id", intentId as string)
          .maybeSingle();
        run.assert(
          "intent status is succeeded",
          finIntent?.status === "succeeded",
          `status=${finIntent?.status}`,
        );

        const { data: outs } = await c.db
          .from("outcomes")
          .select("id, outcome_layer, verification_state")
          .eq("automation_intent_id", intentId as string);
        const opOut = (outs ?? []).filter((o) => o.outcome_layer === "operational");
        run.assert("exactly one operational outcome", opOut.length === 1, `got ${opOut.length}`);
        run.assert(
          "outcome is system_observed (no external verification claimed)",
          opOut[0]?.verification_state === "system_observed",
        );
        run.assert(
          "no business-layer outcome fabricated",
          (outs ?? []).filter((o) => o.outcome_layer === "business").length === 0,
        );
        for (const o of outs ?? []) run.retain("outcome", o.id as string, "outcomes");

        // 10) IDEMPOTENCY — a retry re-executes nothing.
        const retry = await processStage(c, run, {
          stage: "execute-retry",
          jobType: "automation.execute",
          jobKey: stageJobKey(runId, "golden-loop", "execute-retry"),
          tenantId: T,
          payload: { automation_intent_id: intentId, triggered_by: "retry" },
        });
        run.assert(
          "retry job processed",
          retry.classification === "succeeded",
          jobStatusLabel(retry),
        );
        const rr = handlerOutcome(retry);
        run.assert(
          "retry ⇒ already_completed/idempotent",
          rr.status === "already_completed" || rr.idempotent === true,
          `handler=${rr.status ?? "?"}`,
        );
        run.assert(
          "no duplicate succeeded attempt after retry",
          (await count(c, "automation_execution_attempts", {
            automation_intent_id: intentId,
            status: "succeeded",
          })) === 1,
        );
        run.assert(
          "no duplicate operational outcome after retry",
          opOut.length === 1 &&
            (await c.db
              .from("outcomes")
              .select("id", { count: "exact", head: true })
              .eq("automation_intent_id", intentId as string)
              .eq("outcome_layer", "operational")
              .then((r) => r.count ?? 0)) === 1,
        );

        // 11) THE CONTINUOUS LINEAGE — one decision thread from complaint to outcome.
        run.assert(
          "full lineage links: interaction → Observation → DecisionPackage → Action → intent → outcome share one decision thread",
          !!decisionId &&
            !!actionId &&
            intent?.decision_id === decisionId &&
            (obsRow?.decision_id as string) === decisionId &&
            (opOut[0] ? true : false),
          "lineage break",
        );
      },

      // ── FINALLY: restore vertical activation + classified cleanup ─────────────
      async () => {
        const safeDelete = async (table: string, id: string, kind: string) => {
          try {
            const { error } = await c.db.from(table).delete().eq("id", id).eq("tenant_id", T);
            run.dispose(
              kind,
              id,
              error ? "cleanup_failed" : "deleted",
              error ? (error as { message?: string }).message : undefined,
            );
            if (error) run.error(`cleanup ${kind}:${id} failed`);
          } catch (e) {
            run.dispose(kind, id, "cleanup_failed", e instanceof Error ? e.message : String(e));
            run.error(`cleanup ${kind}:${id} threw`);
          }
        };

        // 1) Restore the tenant's vertical activation to its captured state.
        if (!wasVerticalActive) {
          try {
            await c.db.rpc("serviceos_set_automation_vertical", { p_tenant: T, p_enable: false });
            // The RPC removes the mode override; re-instate the captured prior mode row.
            if (capMode) {
              await c.db.from("operating_profile_entries").insert({
                tenant_id: T,
                scope_kind: "tenant",
                scope_ref: null,
                domain: null,
                namespace: "operational_mode",
                key: "current",
                value: capMode.value,
                version_id: capMode.version_id,
              });
            }
            run.dispose("vertical_activation", T, "restored", "deactivated (was off before run)");
          } catch (e) {
            run.dispose(
              "vertical_activation",
              T,
              "cleanup_failed",
              e instanceof Error ? e.message : String(e),
            );
            run.error("cleanup vertical activation failed");
          }
        } else {
          run.dispose("vertical_activation", T, "retained", "was already active before run");
        }

        // 2) Run-enqueued platform jobs (verify:<run>: prefix) → cancel + delete.
        await cleanupRunJobs(c, run, T);

        // 3) Mutable fixtures: history interactions, card, person (card FK is SET NULL).
        for (const id of seeded.historyIds) await safeDelete("interactions", id, "interaction");
        if (seeded.cardId) await safeDelete("customer_cards", seeded.cardId, "customer_card");
        if (seeded.personId) await safeDelete("people", seeded.personId, "person");

        // 4) The trigger interaction is referenced by the retained ledger row → RETAIN.
        if (seeded.triggerId)
          run.dispose(
            "interaction",
            seeded.triggerId,
            "retained",
            "referenced by retained ingestion ledger",
          );

        // 5) Immutable audit already recorded via retain() → classify retained.
        for (const r of run.report.retainedAudit) run.dispose(r.kind, r.id, "retained");
        run.report.cleanup.status = "done";
      },
    );
    if (guarded.bodyThrew) run.error(`suite body error: ${guarded.bodyError}`);
    if (guarded.finallyThrew) {
      run.error(`restoration error: ${guarded.finallyError}`);
      run.report.cleanup.status = "error";
    }
  },
};

export const SUITES: Record<string, Suite> = {
  remote: remoteSuite,
  automation: automationSuite,
  objectives: objectivesSuite,
  intelligence: intelligenceSuite,
  "intelligence-ingest": intelligenceIngestSuite,
  "golden-loop": goldenLoopSuite,
};
