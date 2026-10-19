import assert from "node:assert/strict";
import test from "node:test";
import { runExactJobDetail, validateExactJobDetailRequest } from "./exact_job_detail.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const sourceVersionId = "00000000-0000-4000-8000-000000000004";
const request = { tenantId, jobId, requestId, reason: "Check one job source detail" };
const ready = { state: "ready", request_id: requestId, tenant_id: tenantId, job_id: jobId,
  source_version_id: sourceVersionId, external_id: "123", region: "uk", api_key: "fixture-key" };
const rpcReply = (data: unknown) => ({ data, error: null });

test("one exact GET is bound to the prepared reviewed job and confirmed result", async () => {
  const calls: string[] = [];
  const result = await runExactJobDetail(request, {
    userRpc: async (name, args) => { calls.push(name); assert.equal(args.p_job, jobId); return rpcReply({ request_id: requestId, state: "prepared" }); },
    serviceRpc: async (name, args) => {
      calls.push(name); assert.equal(args.p_request, requestId);
      if (name.endsWith("_acquire")) return rpcReply(ready);
      if (name.endsWith("_current")) return rpcReply(true);
      if (name.endsWith("_finish")) {
        assert.equal(JSON.parse(String(args.p_raw)).id, 123);
        return rpcReply({ version: "commusoft-exact-job-detail/1", request_id: requestId,
          job_id: jobId, source_version_id: sourceVersionId });
      }
      throw Error(name);
    },
    fetcher: async (url, init) => {
      calls.push("GET"); assert.equal(url, "https://app.commusoft.co.uk/api/v2/jobs/123");
      assert.equal(init?.method, "GET"); assert.equal((init?.headers as Record<string,string>)["X-API-VERSION"], "2.0");
      return Response.json({ id: 123, usersCurrentlyAssignedToJob: [] });
    },
  });
  assert.equal((result as Record<string,unknown>).job_id, jobId);
  assert.equal(calls.filter((name) => name === "GET").length, 1);
  assert.equal(calls.filter((name) => name.endsWith("_current")).length, 2);
});

test("missing current authority prevents the provider request", async () => {
  let gets = 0, failed = 0;
  await assert.rejects(runExactJobDetail(request, {
    userRpc: async () => rpcReply({ request_id: requestId, state: "prepared" }),
    serviceRpc: async (name) => name.endsWith("_acquire") ? rpcReply(ready)
      : name.endsWith("_current") ? rpcReply(false)
      : (failed++, rpcReply(null)),
    fetcher: async () => { gets++; throw Error("must not run"); },
  }), /scope_changed/);
  assert.equal(gets, 0); assert.equal(failed, 1);
});

test("response identity mismatch cannot be saved or returned", async () => {
  let finished = 0;
  await assert.rejects(runExactJobDetail(request, {
    userRpc: async () => rpcReply({ request_id: requestId, state: "prepared" }),
    serviceRpc: async (name) => name.endsWith("_acquire") ? rpcReply(ready)
      : name.endsWith("_current") ? rpcReply(true)
      : (name.endsWith("_finish") && finished++, rpcReply(null)),
    fetcher: async () => Response.json({ id: 999 }),
  }), /response_invalid/);
  assert.equal(finished, 0);
});

test("authority lost after the GET withholds even a valid response", async () => {
  let currentReads = 0, finished = 0, failed = 0;
  await assert.rejects(runExactJobDetail(request, {
    userRpc: async () => rpcReply({ request_id: requestId, state: "prepared" }),
    serviceRpc: async (name) => {
      if (name.endsWith("_acquire")) return rpcReply(ready);
      if (name.endsWith("_current")) return rpcReply(++currentReads === 1);
      if (name.endsWith("_finish")) finished++;
      if (name.endsWith("_fail")) failed++;
      return rpcReply(null);
    },
    fetcher: async () => Response.json({ id: 123 }),
  }), /scope_changed/);
  assert.equal(currentReads, 2); assert.equal(finished, 0); assert.equal(failed, 1);
});

test("malformed requests and unapproved source targets fail closed", () => {
  assert.equal(validateExactJobDetailRequest(request), true);
  assert.equal(validateExactJobDetailRequest({ ...request, extra: "x" }), false);
  assert.equal(validateExactJobDetailRequest({ ...request, reason: "no" }), false);
});
