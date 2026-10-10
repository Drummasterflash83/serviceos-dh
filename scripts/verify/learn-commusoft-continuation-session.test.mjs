import test from "node:test";
import assert from "node:assert/strict";
import {
  newContinuationPlan,
  validateContinuationPlan,
  continuationPreservationQuery,
  continuationDefinition,
  publicContinuationSummary,
  runContinuation,
} from "./learn-commusoft-continuation-session.mjs";
import { validateInputRequest, resolveOperatorInput } from "../../src/lib/learn-operator-inputs.ts";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const forbidden = () => {
  throw Error("Unexpected external action");
};
function fixture() {
  const p = {
    ...newContinuationPlan(),
    cutoff: "2026-10-10T22:00:00Z",
    keyFingerprint: "a".repeat(64),
    startPages: 100,
    approvalId: id(7),
    lastJob: id(8),
    checkpoint: { approvalId: id(7), pages: 100, after: 10000, complete: false },
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const overview = {
    tenant_id: p.tenant,
    flags: { "learn.enabled": true, "learn.inputs.commusoft.enabled": true },
    connections: [
      {
        id: p.connection,
        status: "configured",
        revoked: false,
        credential_bound: true,
        verified_at: "2026-10-10T20:00:00Z",
        account_key: "19136",
        region: "uk",
        revision: "2026-10-10T20:00:00Z",
      },
    ],
    accounts: [
      {
        id: p.account,
        connection_id: p.connection,
        resource: "jobs",
        approval_id: p.approvalId,
        checkpoint: { complete: false, after: 10000, pages: 100, approvalId: id(7) },
        latest_job: { id: p.lastJob, status: "succeeded" },
      },
    ],
  };
  return { p, overview };
}
test("fixed TEST scope, budget, duration and unique identities cannot change", () => {
  const { p } = fixture();
  validateContinuationPlan(p);
  for (const patch of [
    { projectRef: "production" },
    { tenant: id(1) },
    { connection: id(2) },
    { account: id(3) },
    { durationMinutes: 61 },
    { maxProviderRequests: 4001 },
    { limits: { ...p.limits, additionalJobPages: 501 } },
    { grant: p.user },
    { email: "other@example.invalid" },
  ])
    assert.throws(() => validateContinuationPlan({ ...p, ...patch }));
});
test("all mutations require exact approval and a non-retired, preserved session before external access", async () => {
  for (const mode of [
    "activate",
    "enable",
    "resume-jobs",
    "start-customer-contacts",
    "start-workaddress-contacts",
    "worker-step",
  ])
    for (const patch of [
      { approvedRun: id(9) },
      { state: "retired" },
      { state: "grant_retired" },
      { preserved: false },
    ]) {
      const p = { ...fixture().p, ...patch };
      await assert.rejects(
        runContinuation(mode, {
          read: () => p,
          approvedRun: patch.approvedRun ?? p.runId,
          sql: forbidden,
          fetcher: forbidden,
          catalog: forbidden,
          save: forbidden,
        }),
      );
    }
});
test("uncertain activation is never repeated", async () => {
  const p = { ...fixture().p, state: "activation_started" };
  await assert.rejects(
    runContinuation("activate", {
      read: () => p,
      approvedRun: p.runId,
      sql: forbidden,
      fetcher: forbidden,
      catalog: forbidden,
      save: forbidden,
    }),
    /replayed/,
  );
});
test("resume keeps the original approval, exact checkpoint and collection, allowing 500 further pages", async () => {
  const { p, overview } = fixture(),
    definition = continuationDefinition("resume-jobs", p, overview);
  assert.equal(definition.max_pages, 600);
  assert.deepEqual(definition.checkpoint, overview.accounts[0].checkpoint);
  assert.equal(definition.approval_id, p.approvalId);
  assert.ok(!("resource" in definition));
  const request = { tenantId: p.tenant, actorId: p.user, requestId: id(12), definition };
  validateInputRequest(request);
  const result = await resolveOperatorInput(
    {
      rpc: async (name, args) => {
        assert.equal(name, "learn_operator_resume_commusoft");
        assert.deepEqual(args.p_definition, definition);
        return {
          error: null,
          data: {
            tenant_id: p.tenant,
            request_id: id(12),
            kind: "resume_commusoft",
            state: "recorded",
            account_id: p.account,
            job_id: id(13),
            approval_id: p.approvalId,
            checkpoint: definition.checkpoint,
          },
        };
      },
    },
    request,
    "apply",
  );
  assert.equal(result.state, "recorded");
  for (const patch of [
    { resource: "properties" },
    { checkpoint: { ...overview.accounts[0].checkpoint, after: 10001 } },
    { latest_job: { id: p.lastJob, status: "running" } },
  ])
    assert.throws(() =>
      continuationDefinition("resume-jobs", p, {
        ...overview,
        accounts: [{ ...overview.accounts[0], ...patch }],
      }),
    );
});
test("contacts require completion and bind the preceding customer traversal to its actual request receipt", () => {
  const { p, overview } = fixture();
  assert.throws(() => continuationDefinition("start-customer-contacts", p, overview));
  p.inputRequests = { "resume-jobs": { state: "recorded" } };
  overview.accounts[0].checkpoint.complete = true;
  const customer = continuationDefinition("start-customer-contacts", p, overview);
  assert.equal(customer.max_pages, 2000);
  assert.equal(customer.contact_type, "customer");
  validateInputRequest({
    tenantId: p.tenant,
    actorId: p.user,
    requestId: id(13),
    definition: customer,
  });
  overview.accounts[0].resource = "propertyContacts";
  overview.accounts[0].approval_id = id(14);
  p.inputRequests["start-customer-contacts"] = {
    state: "recorded",
    receipt: { request_id: id(14) },
  };
  const work = continuationDefinition("start-workaddress-contacts", p, overview);
  assert.equal(work.max_pages, 1500);
  assert.equal(work.contact_type, "workaddress");
  validateInputRequest({
    tenantId: p.tenant,
    actorId: p.user,
    requestId: id(15),
    definition: work,
  });
  p.inputRequests["start-customer-contacts"].receipt.request_id = id(99);
  assert.throws(() => continuationDefinition("start-workaddress-contacts", p, overview));
});
test("revoked, unbound or different-account credentials and disabled capture cannot continue", () => {
  const { p, overview } = fixture();
  for (const patch of [
    { revoked: true },
    { credential_bound: false },
    { account_key: "other" },
    { region: "us" },
  ])
    assert.throws(() =>
      continuationDefinition("resume-jobs", p, {
        ...overview,
        connections: [{ ...overview.connections[0], ...patch }],
      }),
    );
  assert.throws(() =>
    continuationDefinition("resume-jobs", p, {
      ...overview,
      flags: { ...overview.flags, "learn.enabled": false },
    }),
  );
});
test("preservation includes old Drummonds sources, Vault and canonical records; only new appends and exact control rows are excluded", () => {
  const { p } = fixture(),
    s = continuationPreservationQuery(p);
  assert.equal(s.split(" union all ").length, 78);
  assert.match(s, /from vault.secrets s where true/);
  assert.match(s, /from public.jobs s where true/);
  assert.match(s, /from public.tenants s where true/);
  assert.match(s, /from public.provider_connections s where true/);
  assert.match(s, /s.committed_at<=/);
  assert.match(s, /s.first_seen_at<=/);
  assert.match(s, /r.id=s.page_id/);
  assert.match(s, /r.id=s.approval_id/);
  assert.match(s, new RegExp(`from public.profiles s where id<>'${p.user}'`));
});
test("expired authority, exhausted budget or an unknown worker outcome blocks dispatch", async () => {
  for (const patch of [
    { expiresAt: "2020-01-01T00:00:00Z" },
    { workerInvocations: 4000 },
    { workerUnconfirmed: { jobId: id(20) } },
  ]) {
    const p = {
      ...fixture().p,
      state: "active",
      inputRequests: { enable: { state: "recorded" }, "resume-jobs": { state: "recorded" } },
      ...patch,
    };
    await assert.rejects(
      runContinuation("worker-step", {
        read: () => p,
        approvedRun: p.runId,
        sql: forbidden,
        fetcher: forbidden,
        save: forbidden,
      }),
    );
  }
});
test("a nonterminal worker retains its uncertainty handle", async () => {
  const p = { ...fixture().p, workerUnconfirmed: { jobId: id(20) } };
  await assert.rejects(
    runContinuation("check-worker", {
      read: () => p,
      sql: async () => [{ status: "running" }],
      save: forbidden,
      fetcher: forbidden,
    }),
    /not terminal/,
  );
  assert.ok(p.workerUnconfirmed);
});
test("another tenant or account job prevents dispatch before key access", async () => {
  for (const patch of [{ tenant_id: id(99) }, { account_id: id(99) }, { status: "running" }]) {
    const p = {
      ...fixture().p,
      state: "active",
      inputRequests: { enable: { state: "recorded" }, "resume-jobs": { state: "recorded" } },
    };
    await assert.rejects(
      runContinuation("worker-step", {
        read: () => p,
        approvedRun: p.runId,
        sql: async () => [
          { id: id(21), tenant_id: p.tenant, account_id: p.account, status: "queued", ...patch },
        ],
        fetcher: forbidden,
        save: forbidden,
      }),
      /Exactly one/,
    );
  }
});
test("retirement ends the exact grant first and never bans a mismatched identity", async () => {
  const p = { ...fixture().p, state: "active" },
    calls = [];
  const jwt = (role) =>
    "e30." +
    Buffer.from(JSON.stringify({ ref: p.projectRef, role })).toString("base64url") +
    ".fake";
  await assert.rejects(
    runContinuation("retire", {
      read: () => p,
      save: async () => {},
      sql: async (sql, readOnly) => {
        assert.equal(readOnly, false);
        assert.match(sql, new RegExp(p.grant));
        assert.match(sql, /approved-continuation:/);
        calls.push("end-grant");
        return [];
      },
      fetcher: async (url, init) => {
        assert.equal(init.method, "GET");
        calls.push("read");
        return Response.json(
          url.includes("/api-keys")
            ? ["anon", "service_role"].map((name) => ({ name, api_key: jwt(name) }))
            : { email: "wrong@example.invalid", app_metadata: {} },
        );
      },
    }),
    /identity differs/,
  );
  assert.equal(calls[0], "end-grant");
  assert.equal(p.state, "grant_retired");
});
test("public output never includes password, key fingerprint, source data or preservation rows", () => {
  const p = {
    ...fixture().p,
    password: "NEVER_PRINT",
    raw: "NEVER_PRINT",
    before: [{ raw: "NEVER_PRINT" }],
  };
  const out = JSON.stringify(publicContinuationSummary(p));
  assert.ok(!out.includes("NEVER_PRINT"));
  assert.ok(!out.includes(p.keyFingerprint));
});
