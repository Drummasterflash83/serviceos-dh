import test from "node:test";
import assert from "node:assert/strict";
import {
  newRealTestPlan,
  validateRealTestPlan,
  publicRealTestSummary,
  runRealTestSession,
  preservationQuery,
} from "./learn-commusoft-real-test-session.mjs";
import { TRAVERSAL_PRESERVED } from "./learn-commusoft-contact-traversal-catalog.mjs";
const plan = () => ({ ...newRealTestPlan(), keyFingerprint: "a".repeat(64) });
const forbidden = () => {
  throw Error("Unexpected external action");
};
test("wrong TEST scope, duration, budget and identities are refused", () => {
  for (const patch of [
    { projectRef: "production" },
    { durationMinutes: 60 },
    { maxProviderRequests: 402 },
    { accountKey: "other" },
    { slug: "other" },
    { user: "bad" },
  ])
    assert.throws(() => validateRealTestPlan({ ...plan(), ...patch }));
  const p = plan();
  assert.throws(() => validateRealTestPlan({ ...p, grant: p.user }));
});
test("every privileged phase requires approval of its exact saved run before external access", async () => {
  for (const mode of [
    "activate",
    "connect",
    "verify",
    "enable",
    "start-properties",
    "start-jobs",
    "start-customer-contacts",
    "start-workaddress-contacts",
    "worker-step",
  ]) {
    const p = plan();
    await assert.rejects(
      runRealTestSession(mode, {
        read: () => p,
        approvedRun: newRealTestPlan().runId,
        fetcher: forbidden,
        sql: forbidden,
        catalog: forbidden,
        save: forbidden,
        key: forbidden,
      }),
      /approval/,
    );
  }
});
test("an uncertain activation or request cannot be replayed", async () => {
  for (const [mode, state] of [
    ["activate", "activation_started"],
    ["connect", "connection_submitting"],
    ["verify", "verification_submitting"],
  ]) {
    const p = { ...plan(), state };
    await assert.rejects(
      runRealTestSession(mode, {
        read: () => p,
        approvedRun: p.runId,
        fetcher: forbidden,
        sql: forbidden,
        catalog: forbidden,
        save: forbidden,
        key: forbidden,
      }),
      /replayed/,
    );
  }
});
test("unknown worker results and exhausted budgets block another invocation", async () => {
  for (const extra of [{ workerUnconfirmed: {} }, { workerInvocations: 400 }]) {
    const p = {
      ...plan(),
      state: "verified",
      verification: { code: "access_verified" },
      inputRequests: { enable: { state: "recorded" } },
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      ...extra,
    };
    await assert.rejects(
      runRealTestSession("worker-step", {
        read: () => p,
        approvedRun: p.runId,
        fetcher: forbidden,
        sql: forbidden,
        save: forbidden,
      }),
    );
  }
});
test("nonterminal worker status cannot clear uncertainty", async () => {
  const p = { ...plan(), workerUnconfirmed: { jobId: newRealTestPlan().user } };
  await assert.rejects(
    runRealTestSession("check-worker", {
      read: () => p,
      sql: async () => [{ status: "running" }],
      save: forbidden,
      fetcher: forbidden,
    }),
    /not terminal/,
  );
  assert.ok(p.workerUnconfirmed);
});
test("retirement removes exact grant before checking identity; a mismatch cannot ban another user", async () => {
  const p = { ...plan(), state: "activation_started" },
    calls = [];
  const jwt = (role) =>
    "e30." +
    Buffer.from(JSON.stringify({ ref: p.projectRef, role })).toString("base64url") +
    ".fake";
  await assert.rejects(
    runRealTestSession("retire", {
      read: () => p,
      save: async () => {},
      sql: async (q, readOnly) => {
        assert.equal(readOnly, false);
        assert.match(q, new RegExp(p.grant));
        assert.match(q, /flag in \('learn.enabled','learn.inputs.commusoft.enabled'\)/);
        calls.push("retire-grant");
        return [];
      },
      fetcher: async (url, init) => {
        assert.equal(init.method, "GET");
        calls.push("read-auth");
        return Response.json(
          url.includes("/api-keys")
            ? ["anon", "service_role"].map((name) => ({ name, api_key: jwt(name) }))
            : { email: "wrong@example.invalid", app_metadata: {} },
        );
      },
    }),
    /identity differs/,
  );
  assert.equal(calls[0], "retire-grant");
  assert.equal(p.state, "grant_retired");
});
test("public evidence omits passwords, key fingerprints and source records", () => {
  const p = {
    ...plan(),
    password: "NEVER_PRINT",
    keyFingerprint: "a".repeat(64),
    before: [],
    rawSource: "NEVER_PRINT",
  };
  const s = JSON.stringify(publicRealTestSummary(p));
  assert.ok(!s.includes("NEVER_PRINT"));
  assert.ok(!s.includes("a".repeat(64)));
});
test("preservation covers all prior datasets and only excludes the exact new tenant, identity, grant and key binding", () => {
  const p = plan(),
    q = preservationQuery(p);
  for (const name of [...TRAVERSAL_PRESERVED, "public.learn_commusoft_contact_targets"])
    assert.ok(q.includes("from " + name + " s where"));
  assert.equal(q.split(" union all ").length, 78);
  assert.ok(q.includes("id<>'" + p.grant));
  assert.ok(q.includes("id<>'" + p.user));
  assert.ok(q.includes("provider_secret:" + p.tenant + ":commusoft:api_key"));
  assert.ok(q.includes("r.id=s.page_id and r.tenant_id='" + p.tenant));
  assert.equal(q.split("r.id=s.request_id and r.tenant_id='" + p.tenant).length - 1, 2);
});
test("a known preservation mismatch blocks further mutations before external access", async () => {
  const p = { ...plan(), state: "verified", preserved: false };
  await assert.rejects(
    runRealTestSession("worker-step", {
      read: () => p,
      approvedRun: p.runId,
      fetcher: forbidden,
      sql: forbidden,
      save: forbidden,
    }),
    /preservation mismatch/,
  );
});
