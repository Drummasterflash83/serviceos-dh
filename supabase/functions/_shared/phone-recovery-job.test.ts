import test from "node:test";
import assert from "node:assert/strict";
import {
  claimManualPhoneJob,
  heartbeatPhoneJob,
  settlePhoneJob,
  phoneJobUnconfirmed,
} from "./phone-recovery-job.ts";
import { handlePhoneProcessPending } from "./worker_handlers/phone_process_pending.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  jobId = id(2),
  recording = id(3);
const owner = { tenantId: tenant, jobId, claim: { claimedBy: "fixture-worker", attemptCount: 1 } };
const base = () => ({
  id: jobId,
  tenant_id: tenant,
  job_type: "phone.process_pending",
  status: "running",
  claimed_by: "fixture-worker",
  attempt_count: 1,
  lease_expires_at: new Date(Date.now() + 300000).toISOString(),
});
function fixture(opts: any = {}) {
  const row: any = { ...base(), ...opts.row },
    writes: any[] = [],
    rpc: any[] = [],
    requests: any[] = [];
  let counts = 0;
  const db: any = {
    rpc: async (name: string, args: any) => {
      rpc.push({ name, args });
      return {
        data:
          opts.selected === undefined
            ? [{ id: recording, tenant_id: tenant, stage: "download" }]
            : opts.selected,
        error: opts.selectError ? { message: "PRIVATE_DB_DETAIL" } : null,
      };
    },
    from: (table: string) => {
      const filters: any[] = [];
      let patch: any;
      const result = () => {
        if (table === "phone_recording_pipeline_state") {
          counts++;
          return {
            count: opts.badCount === counts ? null : 1,
            error: opts.countError === counts ? { message: "PRIVATE" } : null,
          };
        }
        writes.push({ patch, filters });
        if (opts.failWrite?.(writes.length, row))
          return { data: null, error: { message: "PRIVATE_WRITE_DETAIL" } };
        if (!filters.every(([op, k, v]) => (op === "eq" ? row[k] === v : row[k] > v)))
          return { data: null, error: null };
        Object.assign(row, patch);
        return { data: { id: row.id }, error: null };
      };
      const q: any = {
        update: (v: any) => {
          patch = v;
          return q;
        },
        select: () => q,
        eq: (k: string, v: any) => {
          filters.push(["eq", k, v]);
          return q;
        },
        gt: (k: string, v: any) => {
          filters.push(["gt", k, v]);
          return q;
        },
        maybeSingle: async () => result(),
        then: (yes: any, no: any) => Promise.resolve(result()).then(yes, no),
      };
      return q;
    },
  };
  const invoke = async () => {
    (globalThis as any).Deno = {
      env: {
        get: (k: string) =>
          (
            ({
              SUPABASE_URL: "https://synthetic.invalid",
              SUPABASE_SERVICE_ROLE_KEY: "synthetic",
            }) as any
          )[k],
      },
    };
    const original = globalThis.fetch;
    globalThis.fetch = async (_u: any, request: any) => {
      requests.push(JSON.parse(request.body));
      opts.onChild?.(row);
      return Response.json(
        opts.child ?? {
          success: true,
          recording_id: recording,
          downloaded: true,
          transcribed: true,
          analysed: true,
        },
        { status: opts.http ?? 200 },
      );
    };
    const originalRpc = db.rpc;
    db.rpc = async (name: string, args: any) =>
      name === "learn_capture_admission"
        ? {
            data: {
              version: "learn-capture-admission/1",
              tenant_id: tenant,
              source: "phone",
              allowed: opts.allowed !== false,
              checked_at: new Date().toISOString(),
            },
            error: null,
          }
        : originalRpc(name, args);
    try {
      return await handlePhoneProcessPending({
        supabaseAdmin: db,
        tenantId: tenant,
        jobId,
        claim: owner.claim,
        payload: { limit: 2 },
      });
    } finally {
      globalThis.fetch = original;
    }
  };
  return { db, row, writes, rpc, requests, invoke };
}
test("manual claim is conditional on a new queued job and does not steal a worker claim", async () => {
  const f = fixture({ row: { status: "queued", attempt_count: 0, claimed_by: null } });
  assert.ok(await claimManualPhoneJob(f.db, tenant, jobId, "manual"));
  assert.equal(f.row.claimed_by, "manual");
  assert.equal(f.row.attempt_count, 1);
  assert.equal(await claimManualPhoneJob(f.db, tenant, jobId, "other"), null);
  assert.equal(f.row.claimed_by, "manual");
});
test("heartbeat and settlement refuse changed tenant, owner, attempt, status, type or expired lease", async () => {
  for (const row of [
    { tenant_id: id(9) },
    { claimed_by: "other" },
    { attempt_count: 2 },
    { status: "cancelled" },
    { job_type: "email.gmail_sync" },
    { lease_expires_at: new Date(Date.now() - 1000).toISOString() },
  ]) {
    const f = fixture({ row });
    const before = JSON.stringify(f.row);
    assert.equal(await heartbeatPhoneJob(f.db, owner, 1), false);
    assert.equal(await settlePhoneJob(f.db, owner, { success: true }), "unconfirmed");
    assert.equal(JSON.stringify(f.row), before);
  }
});
test("failed partial batches remain failed; worker retries retain results and respect attempt budget", async () => {
  const result = {
    success: false,
    recordsProcessed: 1,
    result: { failed: 1 },
    error: { code: "provider_timeout", message: "Try later.", retryable: true },
  };
  const manual = fixture();
  assert.equal(await settlePhoneJob(manual.db, owner, result), "failed");
  assert.equal(manual.row.result.failed, 1);
  const worker = fixture();
  assert.equal(await settlePhoneJob(worker.db, owner, result, 5), "retrying");
  assert.ok(Date.parse(worker.row.available_at) > Date.now());
  const terminal = fixture();
  assert.equal(await settlePhoneJob(terminal.db, owner, result, 1), "dead_letter");
  const unknown = fixture();
  assert.equal(await settlePhoneJob(unknown.db, owner, phoneJobUnconfirmed(), 5), "unconfirmed");
  assert.equal(unknown.writes.length, 0);
});
test("lost settlement acknowledgement never reports a completed job", async () => {
  const f = fixture({ failWrite: () => true });
  assert.equal(await settlePhoneJob(f.db, owner, { success: true }), "unconfirmed");
});
test("malformed, foreign, duplicate and failed selections stop before child processing without leaking diagnostics", async () => {
  for (const opts of [
    { selected: null },
    { selectError: true },
    { selected: [{ id: recording, tenant_id: id(8), stage: "download" }] },
    { selected: [{ id: recording, tenant_id: tenant, stage: "complete" }] },
    { selected: Array(2).fill({ id: recording, tenant_id: tenant, stage: "download" }) },
    { selected: [1, 2, 3].map((n) => ({ id: id(n + 9), tenant_id: tenant, stage: "download" })) },
  ]) {
    const f = fixture(opts);
    const r = await f.invoke();
    assert.equal(r.success, false);
    assert.equal(f.requests.length, 0);
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
});
test("missing or failed backlog counts never manufacture an empty or completed backlog", async () => {
  for (const opts of [{ badCount: 1 }, { countError: 1 }, { badCount: 2 }, { countError: 2 }]) {
    const f = fixture(opts);
    const r = await f.invoke();
    assert.equal(r.success, false);
    assert.equal(r.error?.code, "phone_recovery_unconfirmed");
  }
});
test("successful child result must match recording, HTTP status and completed stages", async () => {
  for (const opts of [
    { http: 500 },
    {
      child: {
        success: true,
        recording_id: id(9),
        downloaded: true,
        transcribed: true,
        analysed: true,
      },
    },
    { child: { success: true, recording_id: recording, downloaded: true } },
  ]) {
    const f = fixture(opts);
    const r = await f.invoke();
    assert.equal(r.success, false);
    assert.equal(r.result?.failed, 1);
    assert.equal(r.result?.analysed, 0);
  }
  const f = fixture();
  const r = await f.invoke();
  assert.equal(r.success, true);
  assert.equal(r.result?.analysed, 1);
});
test("lost ownership after a child stops the batch and cannot complete a replacement claim", async () => {
  const f = fixture({
    selected: [
      { id: recording, tenant_id: tenant, stage: "download" },
      { id: id(4), tenant_id: tenant, stage: "download" },
    ],
    onChild: (r: any) => (r.claimed_by = "replacement"),
  });
  const r = await f.invoke();
  assert.equal(r.error?.code, "phone_job_unconfirmed");
  assert.equal(f.requests.length, 1);
  assert.equal(await settlePhoneJob(f.db, owner, r), "unconfirmed");
  assert.equal(f.row.claimed_by, "replacement");
});
test("paused downloads remain waiting; retained audio can proceed to transcription", async () => {
  const f = fixture({ allowed: false });
  const r = await f.invoke();
  assert.equal(r.result?.capture_waiting, 1);
  assert.equal(f.requests.length, 0);
  const stored = fixture({
    allowed: false,
    selected: [{ id: recording, tenant_id: tenant, stage: "transcribe" }],
  });
  assert.equal((await stored.invoke()).success, true);
  assert.equal(stored.requests.length, 1);
});

test("unconfirmed pipeline settlement requires review instead of automatically retrying processing", async () => {
  const f = fixture({
    http: 503,
    child: {
      success: false,
      recording_id: recording,
      downloaded: true,
      transcribed: true,
      analysed: true,
      completion_confirmed: false,
      error: { code: "phone_pipeline_completion_unconfirmed", message: "Review the saved run." },
    },
  });
  const r = await f.invoke();
  assert.equal(r.success, false);
  assert.equal(r.error?.retryable, false);
  assert.equal(r.error?.code, "phone_pipeline_completion_unconfirmed");
  assert.equal(f.requests.length, 1);
  await settlePhoneJob(f.db, owner, r, 5);
  assert.equal(f.row.status, "dead_letter");
});
