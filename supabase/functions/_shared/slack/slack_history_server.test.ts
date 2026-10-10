import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlackHistoryServerPorts } from "./slack_history_server.ts";
import { createHistoryRequestAdapter } from "./slack_history_request.ts";
import { createStoredHistoryBinding } from "./slack_history_binding.ts";
import { createSlackHistoryHandler } from "../worker_handlers/slack_history.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-09T12:00:00Z"),
  token = "xoxb-synthetic-not-a-credential";
function fixture() {
  const cfg = {
    approved: true,
    connectionId: id(5),
    teamId: "T123",
    channelId: "C123",
    oldest: "100.1",
    latest: "200.1",
    consentReference: "fixture",
    expiresAt: "2026-10-09T13:00:00Z",
    maxPages: 3,
  };
  const rows: any = {
    platform_jobs: {
      id: id(2),
      tenant_id: id(1),
      status: "running",
      claimed_by: "learn-slack:test",
      attempt_count: 1,
      lease_expires_at: "2026-10-09T12:03:00Z",
      job_type: "slack.history_sync",
      payload: { connector_account_id: id(3) },
    },
    connector_accounts: {
      id: id(3),
      tenant_id: id(1),
      tenant_connector_id: id(4),
      status: "active",
      settings: { slack_history: cfg },
      sync_cursor: {},
    },
    tenant_connectors: {
      id: id(4),
      tenant_id: id(1),
      connector_id: "slack",
      enabled: true,
      status: "active",
    },
    provider_connections: {
      id: id(5),
      tenant_id: id(1),
      provider: "slack",
      status: "configured",
      revoked_at: null,
      updated_at: "2026-10-09T11:00:00Z",
      non_secret_config: { team_id: "T123" },
      configured_fields: ["bot_token"],
      secret_refs: { bot_token: id(6) },
    },
  };
  const requests: any[] = [],
    rpc: any[] = [],
    reads: any[] = [],
    state = {
      storage: true,
      team: "T123",
      channel: {
        id: "C123",
        is_channel: true,
        is_private: false,
        is_shared: false,
        is_member: true,
      },
      history: {
        ok: true,
        has_more: true,
        messages: [{ ts: "123.1", text: "Synthetic message", user: "U123" }],
        response_metadata: { next_cursor: "next" },
      },
      recurringAllowed: true as boolean | null,
      override: null as null | ((method: string) => Response | Promise<Response> | undefined),
    };
  const db: any = {
    from(table: string) {
      const filters: any[] = [];
      const result = () => {
        reads.push({ table, filters });
        return table.startsWith("slack_message")
          ? { data: [], error: state.storage ? null : {} }
          : { data: structuredClone(rows[table] ?? null), error: null };
      };
      const q: any = {
        select: () => q,
        eq: (...args: any[]) => {
          filters.push(args);
          return q;
        },
        limit: () => Promise.resolve(result()),
        maybeSingle: async () => result(),
      };
      return q;
    },
    rpc: async (name: string, args: any) => {
      rpc.push({ name, args });
      if (name === "learn_slack_recurring_thread_allowed") return {data:state.recurringAllowed,error:null};
      if (name === "learn_slack_read_credential" || name === "learn_slack_read_thread_credential") return { data: token, error: null };
      if (name === "slack_thread_commit_page") {
        rows.slack_thread_imports.checkpoint = args.p_next;
        return { data: true, error: null };
      }
      if (name === "slack_history_commit_page") {
        rows.connector_accounts.sync_cursor = args.p_next;
        return { data: true, error: null };
      }
      throw Error("Unexpected RPC");
    },
  };
  const ctx: any = {
    tenantId: id(1),
    jobId: id(2),
    claim: { claimedBy: "learn-slack:test", attemptCount: 1 },
    payload: { connectionId: "untrusted", token: "untrusted", channel: "C999" },
    supabaseAdmin: db,
  };
  const fetcher: any = async (input: string, options: any) => {
    const u = new URL(input),
      method = u.pathname.split("/").at(-1)!;
    assert.equal(u.origin, "https://slack.com");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(input.includes(token), false);
    assert.equal(options.method, method === "auth.test" ? "POST" : "GET");
    requests.push({ method, params: Object.fromEntries(u.searchParams) });
    const overridden = await state.override?.(method);
    if (overridden) return overridden;
    return Response.json(
      method === "auth.test"
        ? { ok: true, team_id: state.team, bot_id: "B123" }
        : method === "conversations.info"
          ? { ok: true, channel: state.channel }
          : state.history,
    );
  };
  const bind = createStoredHistoryBinding(
    createHistoryRequestAdapter(
      createSlackHistoryServerPorts(ctx, fetcher, () => now),
      () => now,
    ),
    () => now,
  );
  return {
    ctx,
    rows,
    state,
    requests,
    rpc,
    reads,
    bind,
    run: () => createSlackHistoryHandler(bind, () => now)(ctx),
  };
}
function threadFixture() {
  const f = fixture();
  f.ctx.jobType = "slack.thread_sync";
  f.rows.platform_jobs.job_type = "slack.thread_sync";
  f.rows.platform_jobs.payload.thread_import_id = id(7);
  f.rows.slack_thread_imports = { id: id(7), tenant_id: id(1), account_id: id(3),
    scope: { ...f.rows.connector_accounts.settings.slack_history, parentTimestamp: "110.1", consentReference: "thread-fixture" }, checkpoint: {} };
  f.state.history.messages = [{ ts: "123.1", text: "Synthetic reply", user: "U123", thread_ts: "110.1" } as any];
  return f;
}
test("stored thread approval binds exact parent, replies method and independent checkpoint", async () => {
  const f = threadFixture(), result = await f.run();
  assert.equal(result.success, true);
  assert.deepEqual(f.requests.filter(r => r.method.startsWith("conversations.") && r.method !== "conversations.info"), [{
    method: "conversations.replies", params: { channel: "C123", oldest: "100.1", latest: "200.1", limit: "15", inclusive: "true", ts: "110.1" }
  }]);
  assert.ok(f.rpc.some(r => r.name === "learn_slack_read_thread_credential"));
  assert.ok(!f.rpc.some(r => r.name === "learn_slack_read_credential"));
  const saved = f.rpc.find(r => r.name === "slack_thread_commit_page");
  assert.equal(saved.args.p_import_id, id(7));
  assert.equal(saved.args.p_records[0].provider_payload.thread_ts, "110.1");
  assert.equal(f.rows.slack_thread_imports.checkpoint.pages, 1);
  assert.deepEqual(f.rows.connector_accounts.sync_cursor, {});
  assert.deepEqual(result.continuation?.payload, { connector_account_id: id(3), thread_import_id: id(7) });
  assert.equal(result.continuation?.jobType, "slack.thread_sync");
});
test("foreign, changed or missing thread approvals fail before a credential or provider request", async () => {
  for (const mutate of [
    (f: any) => f.rows.slack_thread_imports.tenant_id = id(99),
    (f: any) => f.rows.slack_thread_imports.account_id = id(99),
    (f: any) => delete f.rows.slack_thread_imports.scope.parentTimestamp,
    (f: any) => f.rows.slack_thread_imports.scope.expiresAt = "2026-10-09T11:00:00Z",
    (f: any) => f.rows.platform_jobs.job_type = "slack.history_sync",
    (f: any) => f.rows.slack_thread_imports = null,
  ]) {
    const f = threadFixture(); mutate(f);
    assert.equal((await f.run()).success, false);
    assert.equal(f.rpc.length, 0); assert.equal(f.requests.length, 0);
  }
});
test("history and thread bindings cannot switch methods or widen the approved parent", async () => {
  const history = fixture(), thread = threadFixture();
  for (const f of [history, thread]) {
    const binding = await f.bind(f.ctx); assert.ok(binding);
    const wrongMethod = f === history ? "conversations.replies" : "conversations.history";
    const args = { channel: "C123", oldest: "100.1", latest: "200.1", limit: 15, ...(f === thread ? { ts: "110.1" } : {}) };
    await assert.rejects(binding.request(wrongMethod, args), /history_request_scope_unavailable/);
    await assert.rejects(binding.request("conversations.replies", { ...args, ts: "109.1" }), /history_request_scope_unavailable/);
    assert.equal(f.requests.some(r => r.method === "conversations.replies" || r.method === "conversations.history"), false);
  }
});
test("actual server transport scopes secret lookup, validates workspace/channel and checkpoints one page with delayed continuation", async () => {
  const f = fixture(),
    r = await f.run();
  assert.equal(r.success, true);
  assert.equal(r.result?.stopReason, "run_page_limit");
  assert.equal(r.continuation?.availableAt, "2026-10-09T12:01:00.000Z");
  assert.deepEqual(r.continuation?.payload, { connector_account_id: id(3) });
  assert.deepEqual(f.rpc.find((r) => r.name === "learn_slack_read_credential")?.args, {
    p_tenant_id: id(1),
    p_job_id: id(2),
    p_claimed_by: "learn-slack:test",
    p_attempt_count: 1,
    p_connection_id: id(5),
    p_revision: "2026-10-09T11:00:00Z",
    p_secret_id: id(6),
  });
  assert.ok(
    f.reads.every((r) =>
      r.filters.some(([key, value]: any) => key === "tenant_id" && value === id(1)),
    ),
  );
  assert.deepEqual(
    f.requests.filter((r) => r.method === "conversations.history"),
    [
      {
        method: "conversations.history",
        params: {
          channel: "C123",
          oldest: "100.1",
          latest: "200.1",
          limit: "15",
          inclusive: "true",
        },
      },
    ],
  );
  const committed = f.rpc.find((r) => r.name === "slack_history_commit_page");
  assert.equal(committed.args.p_records[0].provider_payload.user, "U123");
  assert.equal(JSON.stringify(r).includes(token), false);
});
test("missing storage, foreign/revoked/unconfigured connection and absent explicit binding never obtain credentials", async () => {
  for (const mutate of [
    (f: any) => (f.state.storage = false),
    (f: any) => (f.rows.provider_connections.tenant_id = id(99)),
    (f: any) => (f.rows.provider_connections.status = "revoked"),
    (f: any) => (f.rows.provider_connections.revoked_at = "2026-10-09T11:00:00Z"),
    (f: any) => delete f.rows.connector_accounts.settings.slack_history.connectionId,
    (f: any) => (f.rows.provider_connections.non_secret_config.team_id = "T999"),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal((await f.run()).success, false);
    assert.equal(f.rpc.length, 0);
    assert.equal(f.requests.length, 0);
  }
});
test("wrong workspace, shared/private/nonmember channel never requests messages", async () => {
  for (const change of [
    { team: "T999" },
    { channel: { is_private: true } },
    { channel: { is_shared: true } },
    { channel: { is_member: false } },
    { channel: { is_pending_ext_shared: true } },
    { channel: { is_channel: false } },
  ]) {
    const f = fixture();
    if (change.team) f.state.team = change.team;
    if (change.channel) Object.assign(f.state.channel, change.channel);
    assert.equal((await f.run()).success, false);
    assert.equal(
      f.requests.some((r) => r.method === "conversations.history"),
      false,
    );
    assert.equal(
      f.rpc.some((r) => r.name === "slack_history_commit_page"),
      false,
    );
  }
});
test("revocation or credential revision change during provider response prevents publication", async () => {
  for (const mutate of [
    (f: any) => (f.rows.connector_accounts.settings.slack_history.approved = false),
    (f: any) => (f.rows.provider_connections.updated_at = "2026-10-09T12:00:00Z"),
    (f: any) => (f.rows.platform_jobs.claimed_by = "replacement"),
    (f: any) => (f.rows.platform_jobs.lease_expires_at = "2026-10-09T12:00:00Z"),
  ]) {
    const f = fixture();
    f.state.override = (method) => {
      if (method === "conversations.history") mutate(f);
      return undefined;
    };
    assert.equal((await f.run()).success, false);
    assert.equal(
      f.rpc.some((r) => r.name === "slack_history_commit_page"),
      false,
    );
  }
});
test("rate limiting during binding or history preserves provider delay without exposing error content or retrying inline", async () => {
  for (const step of ["auth.test", "conversations.info", "conversations.history"]) {
    const f = fixture();
    f.state.override = (method) =>
      method === step
        ? new Response("private provider prose", { status: 429, headers: { "retry-after": "120" } })
        : undefined;
    const r = await f.run();
    assert.equal(r.success, false);
    assert.equal(r.error?.code, "slack_history_rate_limited");
    assert.equal(r.error?.retryable, true);
    assert.equal(r.error?.retryAfterSeconds, 120);
    assert.equal(f.requests.filter((r) => r.method === step).length, 1);
    assert.equal(
      f.rpc.some((r) => r.name === "slack_history_commit_page"),
      false,
    );
    assert.equal(JSON.stringify(r).includes("private"), false);
  }
});
test("oversized and malformed responses are discarded, while missing permission is terminal", async () => {
  for (const response of [
    new Response("x".repeat(4 * 1024 * 1024 + 1)),
    new Response("not json"),
    Response.json({ ok: false, error: "missing_scope", detail: "private prose" }),
  ]) {
    const f = fixture();
    f.state.override = (method) => (method === "conversations.history" ? response : undefined);
    const r = await f.run();
    assert.equal(r.success, false);
    assert.equal(r.error?.retryable, false);
    assert.equal(
      f.rpc.some((r) => r.name === "slack_history_commit_page"),
      false,
    );
    assert.equal(JSON.stringify(r).includes("private prose"), false);
  }
});
test("resumed page uses durable cursor; complete and exhausted windows do not schedule more work", async () => {
  const f = fixture();
  await f.run();
  f.state.history = {
    ok: true,
    has_more: false,
    messages: [],
    response_metadata: { next_cursor: "" },
  };
  const result = await f.run();
  assert.equal(result.success, true);
  assert.equal(result.continuation, undefined);
  assert.equal(
    f.requests.filter((r) => r.method === "conversations.history").at(-1)?.params.cursor,
    "next",
  );
  const g = fixture();
  g.rows.connector_accounts.settings.slack_history.maxPages = 1;
  const exhausted = await g.run();
  assert.equal(exhausted.result?.stopReason, "page_budget_exhausted");
  assert.equal(exhausted.continuation, undefined);
  assert.equal(exhausted.result?.ingestion_complete, false);
});

test('worker commits channel broadcasts through the real adapter and transport without inferring complete threads',async()=>{
 const f=fixture();
 const broadcast={ts:'123.1',text:'Synthetic broadcast',user:'U123',subtype:'thread_broadcast',thread_ts:'90.1',root:{ts:'90.1',text:'Retained reference'}};
 f.state.history={ok:true,has_more:false,messages:[broadcast],response_metadata:{next_cursor:''}};
 const result=await f.run();assert.equal(result.success,true);
 const saved=f.rpc.find(r=>r.name==='slack_history_commit_page');
 assert.ok(saved);assert.deepEqual(saved.args.p_records[0].provider_payload,broadcast);
 assert.equal(saved.args.p_records[0].thread_timestamp,'90.1');
 assert.equal(result.result?.threadCoverage,'unverified');
 assert.equal(f.requests.find(r=>r.method==='conversations.history').params.inclusive,'true');
 assert.ok(!f.requests.some(r=>r.method==='conversations.replies'));
 const denied=fixture();denied.state.history.messages=[{...broadcast,thread_ts:'124.1'}];
 assert.equal((await denied.run()).success,false);
 assert.ok(!denied.rpc.some(r=>r.name==='slack_history_commit_page'));
 assert.deepEqual(denied.rows.connector_accounts.sync_cursor,{});
});

 test('recurring thread gate is checked before credential access and again after provider reads',async()=>{
  for(const allowed of [false,null]){
   const f=threadFixture();f.rows.slack_thread_imports.definition={recurringHistoryImportId:id(9)};f.state.recurringAllowed=allowed;
   const result=await f.run();assert.equal(result.success,false);assert.equal(f.requests.length,0);
   assert.ok(!f.rpc.some(r=>r.name==='learn_slack_read_thread_credential'));
  }
  const active=threadFixture();active.rows.slack_thread_imports.definition={recurringHistoryImportId:id(9)};
  assert.equal((await active.run()).success,true);
  const paused=threadFixture();paused.rows.slack_thread_imports.definition={recurringHistoryImportId:id(9)};
  paused.state.override=(method)=>{if(method==='conversations.replies'){paused.state.recurringAllowed=false;return new Response(JSON.stringify(paused.state.history),{status:200});}};
  assert.equal((await paused.run()).success,false);
  assert.ok(!paused.rpc.some(r=>r.name==='slack_thread_commit_page'));
 });
