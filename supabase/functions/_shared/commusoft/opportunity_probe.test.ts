import test from "node:test";
import assert from "node:assert/strict";
import {
  opportunityProbeOrigin,
  runOpportunityProbe,
  validOpportunityProbeRequest,
} from "./opportunity_probe.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const connectionId = "11111111-1111-1111-1111-111111111111";
const requestId = "22222222-2222-2222-2222-222222222222";
const permitId = "33333333-3333-3333-3333-333333333333";
const request = {
  tenantId,
  connectionId,
  requestId,
  reason: "Inspect a bounded opportunity source page",
};
function fixture({ authorized = true, records = 1, status = 200 } = {}) {
  let calls = 0,
    checks = 0,
    finishes = 0,
    failures = 0;
  const ports = {
    userRpc: async (name: string) => ({
      data:
        name === "new_dawn_commusoft_opportunity_probe_start"
          ? { requestId, state: "prepared", limit: 10 }
          : null,
      error: null,
    }),
    serviceRpc: async (name: string) => {
      if (name === "new_dawn_commusoft_opportunity_probe_acquire")
        return {
          data: {
            state: "ready",
            requestId,
            tenantId,
            connectionId,
            region: "uk",
            apiKey: "SYNTHETIC-ONLY",
            permitId,
            sendBefore: Date.now() + 5000,
          },
          error: null,
        };
      if (name === "new_dawn_commusoft_opportunity_probe_current") {
        checks++;
        return { data: authorized, error: null };
      }
      if (name === "new_dawn_commusoft_opportunity_probe_finish") {
        finishes++;
        return {
          data: {
            version: "commusoft-opportunity-probe/1",
            requestId,
            recordCount: records,
            pipelineCounts: [{ pipeline: "Further Works", count: records }],
          },
          error: null,
        };
      }
      if (name === "new_dawn_commusoft_opportunity_probe_fail") {
        failures++;
        return { data: null, error: null };
      }
      throw Error(`Unexpected RPC: ${name}`);
    },
    fetcher: async (url: string | URL | Request, options?: RequestInit) => {
      calls++;
      assert.equal(
        String(url),
        "https://app.commusoft.co.uk/api/v2/opportunities?limit=10&includeCount=true",
      );
      assert.equal(options?.method, "GET");
      assert.equal(
        options?.headers && (options.headers as Record<string, string>).Authorization,
        "Bearer SYNTHETIC-ONLY",
      );
      return Response.json(
        {
          meta: { totalRecords: records },
          pagination: { hasMore: false },
          data: Array.from({ length: records }, (_, i) => ({
            id: String(i + 1),
            pipeline: "Further Works",
            description: "private fixture",
          })),
        },
        { status },
      );
    },
  };
  return { ports, stats: () => ({ calls, checks, finishes, failures }) };
}

test("accepts only exact project origins and exact bounded request", () => {
  assert.equal(
    opportunityProbeOrigin("https://tgbnakbxwcqjeimygroz.supabase.co", "https://app.openfolk.ai"),
    "https://app.openfolk.ai",
  );
  assert.equal(
    opportunityProbeOrigin("https://tgbnakbxwcqjeimygroz.supabase.co", "https://evil.example"),
    null,
  );
  assert.equal(
    opportunityProbeOrigin("https://saatxzwxvdvqevbnskxy.supabase.co", "https://test.openfolk.ai"),
    "https://test.openfolk.ai",
  );
  assert.equal(
    opportunityProbeOrigin("https://saatxzwxvdvqevbnskxy.supabase.co", "https://app.openfolk.ai"),
    null,
  );
  assert.equal(validOpportunityProbeRequest(request), true);
  assert.equal(validOpportunityProbeRequest({ ...request, after: "1" }), false);
});

test("one-use source page performs one GET and returns only summary", async () => {
  const f = fixture();
  const result = await runOpportunityProbe(request, f.ports);
  assert.deepEqual(f.stats(), { calls: 1, checks: 3, finishes: 1, failures: 0 });
  assert.equal(JSON.stringify(result).includes("private fixture"), false);
  assert.equal(JSON.stringify(result).includes("SYNTHETIC-ONLY"), false);
});

test("revoked permit and oversized page fail closed", async () => {
  const revoked = fixture({ authorized: false });
  await assert.rejects(runOpportunityProbe(request, revoked.ports), /scope_changed/);
  assert.deepEqual(revoked.stats(), { calls: 0, checks: 1, finishes: 0, failures: 1 });
  const oversized = fixture({ records: 11 });
  await assert.rejects(runOpportunityProbe(request, oversized.ports), /response_invalid/);
  assert.equal(oversized.stats().calls, 1);
  assert.equal(oversized.stats().finishes, 0);
});
