import test from "node:test";
import assert from "node:assert/strict";
import {
  scanProviderCalls,
  careSafeError,
} from "../../supabase/functions/_shared/care-provider-scan.ts";
import {
  runCareReview,
  type ReviewDependencies,
} from "../../supabase/functions/_shared/care-review-job.ts";
import { deliverCareAlert } from "../../supabase/functions/_shared/care-alert-delivery.ts";
const tenant = "00000000-0000-0000-0000-000000000001",
  call = "00000000-0000-0000-0000-000000000002";
const assistant = "00000000-0000-0000-0000-000000000003",
  lease = "00000000-0000-0000-0000-000000000004";
const result = {
  summary: "An unnecessary repeat.",
  findings: [
    {
      category: "repetition",
      severity: "normal",
      evidence: "Office is closed. Office is closed.",
      explanation: "The opening repeats.",
      suggestedChange: "Say the hours once.",
    },
  ],
  limitations: ["No acoustic diagnosis from text."],
};
function harness(overrides: Partial<ReviewDependencies> = {}) {
  const requests: string[] = [],
    completed: unknown[] = [];
  const deps: ReviewDependencies = {
    reviewKey: "synthetic",
    model: "test-model",
    settings: async () => ({
      enabled: true,
      approved_rules: "Say opening hours once.",
      version: 1,
    }),
    workspace: async () => ({ assistant_id: assistant, key: "synthetic" }),
    practiceSession: async () => null,
    feedback: async () => ["Please check the repeated greeting."],
    cached: async () => null,
    complete: async (...args) => {
      completed.push(args);
    },
    fetcher: async (url, init) => {
      requests.push(String(url));
      if (String(url).includes("api.vapi.ai"))
        return Response.json({
          id: call,
          assistantId: assistant,
          status: "ended",
          type: "inboundPhoneCall",
          transcript: "Office is closed. Office is closed.",
        });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.tools, undefined);
      assert.equal(JSON.stringify(body).includes("recordingUrl"), false);
      return Response.json({
        status: "completed",
        output: [{ content: [{ type: "output_text", text: JSON.stringify(result) }] }],
      });
    },
    ...overrides,
  };
  return { deps, requests, completed };
}
const job = { tenant_id: tenant, call_id: call, lease_id: lease };
test("completed call -> scoped evidence -> exact quote analysis -> atomic completion", async () => {
  const h = harness();
  const r = await runCareReview(job, h.deps);
  assert.equal(r.findings, 1);
  assert.equal(h.completed.length, 1);
  assert.equal(h.requests.length, 2);
  assert.deepEqual((h.completed[0] as unknown[])[0], job);
});
test("replayed evidence uses stored assessment without another AI request", async () => {
  const h = harness({ cached: async () => result });
  assert.equal((await runCareReview(job, h.deps)).replayed, true);
  assert.equal(h.requests.length, 1);
});
test("foreign assistant cannot be reviewed in the chosen tenant", async () => {
  const h = harness({ workspace: async () => ({ assistant_id: tenant, key: "synthetic" }) });
  await assert.rejects(runCareReview(job, h.deps), /call_scope_invalid/);
  assert.equal(h.completed.length, 0);
  assert.equal(h.requests.length, 1);
});
test("unfinished or missing evidence never counts as reviewed", async () => {
  for (const status of ["in-progress", "ended"]) {
    const h = harness({
      fetcher: async () => Response.json({ id: call, assistantId: assistant, status }),
    });
    await assert.rejects(runCareReview(job, h.deps), /awaiting_/);
    assert.equal(h.completed.length, 0);
  }
});
test("changed rules while reviewing refuse completion", async () => {
  let reads = 0;
  const h = harness({
    settings: async () => ({ enabled: true, approved_rules: "Approved rules", version: ++reads }),
  });
  await assert.rejects(runCareReview(job, h.deps), /review_settings_changed/);
  assert.equal(h.completed.length, 0);
});
test("failed persistence is not successful review", async () => {
  const h = harness({
    complete: async () => {
      throw Error("worker_store_unavailable");
    },
  });
  await assert.rejects(runCareReview(job, h.deps), /worker_store_unavailable/);
});
test("oversized feedback refuses before AI rather than omitting it", async () => {
  const h = harness({ feedback: async () => ["x".repeat(20001)] });
  await assert.rejects(runCareReview(job, h.deps), /evidence_too_large/);
  assert.equal(h.requests.length, 1);
});
test("scan handles more than a page with unordered inclusive boundary rows", async () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    assistantId: assistant,
    updatedAt: new Date(i * 1000).toISOString(),
    status: "ended",
  }));
  const found: string[] = [];
  const r = await scanProviderCalls({
    key: "synthetic",
    assistantId: assistant,
    from: new Date(0).toISOString(),
    through: new Date(10000).toISOString(),
    pageSize: 3,
    maxRequests: 30,
    observe: async (calls) => {
      found.push(...calls.map((c) => c.id));
    },
    fetcher: async (url) => {
      const u = new URL(String(url));
      const a = Date.parse(u.searchParams.get("updatedAtGe")!),
        b = Date.parse(u.searchParams.get("updatedAtLe")!);
      return Response.json(
        rows
          .filter((c) => Date.parse(c.updatedAt) >= a && Date.parse(c.updatedAt) <= b)
          .reverse()
          .slice(0, 3),
      );
    },
  });
  assert.equal(r.count, 9);
  assert.equal(new Set(found).size, 9);
  assert.equal(found.length, 9);
});
test("scan refuses saturation and never reports incomplete range as complete", async () => {
  const rows = [call, tenant].map((id) => ({
    id,
    assistantId: assistant,
    updatedAt: new Date(0).toISOString(),
    status: "ended",
  }));
  await assert.rejects(
    scanProviderCalls({
      key: "synthetic",
      assistantId: assistant,
      from: new Date(0).toISOString(),
      through: new Date(1).toISOString(),
      pageSize: 2,
      observe: async () => {},
      fetcher: async () => Response.json(rows),
    }),
    /scan_timestamp_saturated/,
  );
});
test("provider ignores scope filters: scan fails closed", async () => {
  await assert.rejects(
    scanProviderCalls({
      key: "synthetic",
      assistantId: assistant,
      from: new Date(0).toISOString(),
      through: new Date(1000).toISOString(),
      observe: async () => {},
      fetcher: async () =>
        Response.json([
          { id: call, assistantId: tenant, updatedAt: new Date(0).toISOString(), status: "ended" },
        ]),
    }),
    /scan_scope_invalid/,
  );
});
test("large scans resume bounded work without advancing an incomplete cutoff", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    assistantId: assistant,
    updatedAt: new Date(i * 1000).toISOString(),
    status: "ended",
  }));
  const found = new Set<string>();
  let pending: { from: string; to: string }[] = [],
    complete = false,
    runs = 0;
  while (!complete && runs++ < 50) {
    const r = await scanProviderCalls({
      key: "synthetic",
      assistantId: assistant,
      from: new Date(0).toISOString(),
      through: new Date(60000).toISOString(),
      pageSize: 4,
      maxRequests: 2,
      pending,
      observe: async (calls) => {
        calls.forEach((c) => found.add(c.id));
      },
      fetcher: async (url) => {
        const u = new URL(String(url));
        const from = Date.parse(u.searchParams.get("updatedAtGe")!),
          to = Date.parse(u.searchParams.get("updatedAtLe")!);
        return Response.json(
          rows
            .filter((c) => Date.parse(c.updatedAt) >= from && Date.parse(c.updatedAt) <= to)
            .slice(0, 4),
        );
      },
    });
    pending = r.pending;
    complete = r.complete;
  }
  assert.equal(complete, true);
  assert.equal(found.size, 30);
  assert.ok(runs > 1);
});
const alert = {
  id: call,
  tenant_id: tenant,
  issue_id: call,
  kind: "attention",
  reason: "received",
  lease_id: lease,
  team_id: "TOPENFOLK",
  channel_id: "CEMMA",
  client_msg_id: call,
};
function delivery(sendFails = false) {
  const sent: unknown[] = [],
    ack: unknown[] = [],
    failed: unknown[] = [];
  return {
    sent,
    ack,
    failed,
    deps: {
      token: "synthetic",
      allowedTeam: "TOPENFOLK",
      issue: async () => ({
        title: "Check repetition",
        priority: "normal",
        stage: "received",
        company: "Example",
      }),
      currentRoute: async () => ({ team_id: "TOPENFOLK", channel_id: "CEMMA", enabled: true }),
      ack: async (...a: unknown[]) => {
        ack.push(a);
      },
      fail: async (...a: unknown[]) => {
        failed.push(a);
      },
      fetcher: async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("auth.test")) return Response.json({ ok: true, team_id: "TOPENFOLK" });
        if (u.endsWith("conversations.info"))
          return Response.json({
            ok: true,
            channel: { id: "CEMMA", name: "ai-emma", is_member: true },
          });
        sent.push(JSON.parse(String(init?.body)));
        if (sendFails) throw Error("synthetic network timeout");
        return Response.json({ ok: true, channel: "CEMMA", ts: "1234.12345" });
      },
    },
  };
}
test("issue -> independently verified Slack workspace/channel -> receipt acknowledgement", async () => {
  const h = delivery();
  assert.equal((await deliverCareAlert(alert, h.deps)).delivered, true);
  assert.equal(h.ack.length, 1);
  assert.equal(h.failed.length, 0);
  assert.equal(JSON.stringify(h.sent).includes("recordingUrl"), false);
});
test("timeout after sending becomes unknown delivery, not success or blind retry", async () => {
  const h = delivery(true);
  const r = await deliverCareAlert(alert, h.deps);
  assert.equal(r.uncertain, true);
  assert.equal(h.ack.length, 0);
  assert.deepEqual(h.failed, [["care_operation_failed", true]]);
});
test("changed route refuses before Slack transmission", async () => {
  const h = delivery();
  h.deps.currentRoute = async () => ({ team_id: "TOTHER", channel_id: "COTHER", enabled: true });
  const r = await deliverCareAlert(alert, h.deps);
  assert.equal(r.delivered, false);
  assert.equal(h.sent.length, 0);
});
test("raw provider failures never become public diagnostics", () => {
  assert.equal(
    careSafeError(Error("Private file /customer/name and token=example")),
    "care_operation_failed",
  );
  assert.equal(careSafeError(Error("review_credit_required")), "review_credit_required");
});
