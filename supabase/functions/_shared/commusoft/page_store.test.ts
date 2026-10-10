import { test } from "node:test";
import assert from "node:assert/strict";
import { committedCommusoftPage, persistCommusoftPage } from "./page_store.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const saved = {
    pageId: id(9),
    checkpoint: { approvalId: id(6), after: 20, pages: 2, complete: false },
    records: 1,
    already: false,
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const state: { data: any; error: any; throws: boolean } = {
    data: saved,
    error: null,
    throws: false,
  };
  const ctx = {
    tenantId: id(1),
    jobId: id(2),
    jobType: "commusoft.source_sync",
    claim: { claimedBy: "fixture-worker", attemptCount: 1 },
    supabaseAdmin: {
      from() {
        throw Error("No direct storage access");
      },
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        if (state.throws) throw Error("private source content");
        return { data: state.data, error: state.error };
      },
    },
  };
  const input = {
    permitId: id(8),
    scope: {
      tenantId: id(1),
      jobId: id(2),
      accountId: id(3),
      connectorId: id(4),
      connectionId: id(5),
      connectionRevision: "2026-10-10T11:00:00Z",
      secretId: id(7),
      approval: { approvalId: id(6) },
      checkpoint: {},
      request: { region: "uk" as const, resource: "properties" as const, after: 10, limit: 100 },
      pages: 1,
      complete: false,
      scopeKey: "fixture",
    },
    page: {
      records: [{ id: 20 }],
      nextCursor: 20,
      collectionExhausted: false,
      rawEnvelope: {
        data: [{ id: 20 }],
        pagination: { hasMore: true, nextCursor: 20 },
        meta: { original: true },
      },
      quota: { remaining: null, resetAt: null, retryAt: null },
    },
  };
  return { ctx, input, state, calls, saved };
}
test("one atomic RPC retains the complete envelope and exact claim/permit; no direct writes", async () => {
  const f = fixture();
  assert.deepEqual(await persistCommusoftPage(f.ctx, f.input), f.saved);
  assert.deepEqual(f.calls, [
    {
      name: "learn_commusoft_commit_page",
      args: {
        p_tenant_id: id(1),
        p_job_id: id(2),
        p_claimed_by: "fixture-worker",
        p_attempt_count: 1,
        p_permit_id: id(8),
        p_envelope: f.input.page.rawEnvelope,
      },
    },
  ]);
  f.input.page.rawEnvelope.meta.original = false;
  assert.equal((f.calls[0].args.p_envelope as any).meta.original, true);
});
test("scope substitutions are rejected before publication", async () => {
  for (const field of ["tenantId", "jobId"] as const) {
    const f = fixture();
    f.input.scope[field] = id(99);
    await assert.rejects(persistCommusoftPage(f.ctx, f.input), /authority_unavailable/);
    assert.equal(f.calls.length, 0);
  }
});
test("receipt must match the submitted approval, cursor, counts and page number", async () => {
  for (const change of [{ after: 30 }, { pages: 1 }, { complete: true }, { approvalId: id(99) }]) {
    const f = fixture();
    f.state.data = { ...f.saved, checkpoint: { ...f.saved.checkpoint, ...change } };
    await assert.rejects(persistCommusoftPage(f.ctx, f.input), /receipt_invalid/);
  }
  const f = fixture();
  f.state.data = { ...f.saved, records: 2 };
  await assert.rejects(persistCommusoftPage(f.ctx, f.input), /receipt_invalid/);
});
test("lost acknowledgement is not retried automatically or reported as success", async () => {
  const f = fixture();
  f.state.throws = true;
  await assert.rejects(persistCommusoftPage(f.ctx, f.input), {
    message: "commusoft_publication_unavailable",
  });
  assert.equal(f.calls.length, 1);
  f.state.throws = false;
  f.state.error = { message: "private source content" };
  await assert.rejects(persistCommusoftPage(f.ctx, f.input), {
    message: "commusoft_publication_unavailable",
  });
  assert.equal(f.calls.length, 2);
});
test("recovery returns a source-free retained acknowledgement or explicit no-commit", async () => {
  const f = fixture();
  f.state.data = { ...f.saved, already: true, source: "must not escape" };
  assert.deepEqual(await committedCommusoftPage(f.ctx), { ...f.saved, already: true });
  assert.equal(f.calls[0].name, "learn_commusoft_committed_page");
  f.state.data = null;
  assert.equal(await committedCommusoftPage(f.ctx), null);
  f.state.error = {};
  await assert.rejects(committedCommusoftPage(f.ctx), /publication_unavailable/);
});
test("malformed recovery cannot be treated as a missing receipt or permission to fetch", async () => {
  for (const data of [
    {},
    { pageId: id(9) },
    { ...fixture().saved, already: false },
    {
      ...fixture().saved,
      already: true,
      checkpoint: { approvalId: id(6), after: null, pages: 1, complete: false },
    },
  ]) {
    const f = fixture();
    f.state.data = data;
    await assert.rejects(committedCommusoftPage(f.ctx), /receipt_invalid/);
  }
});
