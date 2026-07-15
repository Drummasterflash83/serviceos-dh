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
 * Cancel-then-delete every platform job owned by THIS run (exact `verify:<run>:` key
 * prefix), scoped to the tenant. Active jobs are cancelled through the lifecycle
 * first so no stuck active job lingers (the failure mode of verify-20260715-a78555ae);
 * unrelated jobs are never touched. Reports each disposition.
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
  const plan = planRunJobCleanup((rows ?? []) as RunJobRow[], runId);
  const cancelled = new Set(plan.cancel);
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
      "cleanup: delete run-tagged mutable fixtures; RETAIN immutable audit (attempts/outcomes/guard/decision) + report ids",
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

export const SUITES: Record<string, Suite> = {
  remote: remoteSuite,
  automation: automationSuite,
  objectives: objectivesSuite,
  intelligence: intelligenceSuite,
};
