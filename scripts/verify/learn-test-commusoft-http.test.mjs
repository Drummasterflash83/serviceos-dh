import test from "node:test";
import assert from "node:assert/strict";
import { exerciseEmptyWorker } from "./learn-test-commusoft-http.mjs";
import {
  expectedCommusoftEndpoint,
  expectedCommusoftRuntime,
  installedCommusoftWorker,
} from "./learn-test-commusoft-runtime.mjs";
import { catalog } from "./learn-commusoft-test-fixture.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";

function deployed() {
  const c = catalog(true);
  c.base.functions = [
    ...expectedCommusoftRuntime().afterEndpoints,
    expectedCommusoftEndpoint().endpoint,
  ];
  c.readinessCatalogSha256 = catalogFingerprint(c.base);
  return c;
}
test("runtime acceptance requires exact worker, JWT enforcement and all prior contracts", () => {
  assert.equal(installedCommusoftWorker(deployed()), true);
  for (const mutate of [
    (c) => (c.base.functions.at(-1).verify_jwt = false),
    (c) => (c.base.functions.at(-1).ezbr_sha256 = "changed"),
    (c) => c.base.functions.at(-1).version++,
    (c) => c.base.functions.push(c.base.functions.at(-1)),
    (c) => c.base.functions[0].version++,
    (c) => c.commusoftGrants.pop(),
    (c) => (c.tables[0].rls = false),
  ]) {
    const c = deployed();
    mutate(c);
    assert.equal(installedCommusoftWorker(c), false);
  }
});
const state = {
  activeJobs: 0,
  sources: [{ name: "platform_jobs", count: 1, fingerprint: "preserved" }],
};
function harness({ activeJobs = 0, wrongStatus = false, mutateAt = 0 } = {}) {
  let snapshots = 0;
  const calls = [];
  return {
    calls,
    get snapshots() {
      return snapshots;
    },
    args: {
      anon: "test-anon",
      service: "test-service",
      snapshot: async () => {
        snapshots++;
        return { ...state, activeJobs, ...(snapshots === mutateAt ? { sources: [] } : {}) };
      },
      invoke: async (o) => {
        calls.push(o);
        const h = o.headers;
        if (wrongStatus) return { status: 200, data: {} };
        if (!h.Authorization)
          return { status: 401, data: { message: "Missing authorization header" } };
        const code =
          o.method === "GET"
            ? "method_not_allowed"
            : h["x-serviceos-worker-key"] !== "test-service"
              ? "worker_forbidden"
              : o.body
                ? "worker_body_not_allowed"
                : null;
        return code
          ? {
              status: {
                method_not_allowed: 405,
                worker_forbidden: 403,
                worker_body_not_allowed: 400,
              }[code],
              data: { ok: false, code },
            }
          : { status: 200, data: { ok: true, result: { claimed: 0, outcomes: [] } } };
      },
    },
  };
}
test("empty runtime checks both authentication boundaries, rejects caller scope and preserves state", async () => {
  const h = harness(),
    r = await exerciseEmptyWorker(h.args);
  assert.equal(r.checks.length, 8);
  assert.equal(h.snapshots, 3);
  assert.equal(
    h.calls.filter(
      (c) =>
        !c.body &&
        !c.method &&
        c.headers.Authorization &&
        c.headers["x-serviceos-worker-key"] === "test-service",
    ).length,
    1,
  );
  assert.equal(r.preExistingSourcesPreserved, true);
});
test("active work or changed state stops the empty-queue verification without a valid invocation", async () => {
  const active = harness({ activeJobs: 1 });
  await assert.rejects(exerciseEmptyWorker(active.args));
  assert.equal(active.calls.length, 0);
  const changed = harness({ mutateAt: 2 });
  await assert.rejects(exerciseEmptyWorker(changed.args));
  assert.equal(changed.calls.length, 7);
  const after = harness({ mutateAt: 3 });
  await assert.rejects(exerciseEmptyWorker(after.args));
  assert.equal(after.calls.length, 8);
  const denied = harness({ wrongStatus: true });
  await assert.rejects(exerciseEmptyWorker(denied.args));
  assert.equal(denied.calls.length, 1);
});
