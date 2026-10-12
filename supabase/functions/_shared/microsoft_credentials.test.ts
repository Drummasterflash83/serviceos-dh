import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshMicrosoftAccessToken, MicrosoftCredentialError } from "./microsoft_oauth.ts";
import { createMicrosoftCapturePorts } from "./microsoft_capture_ports.ts";
import { handleMicrosoftCapture } from "./microsoft_capture_handler.ts";
import { MicrosoftMailError } from "./microsoft_graph_transport.ts";
import { MicrosoftJournalError } from "./microsoft_capture_engine.ts";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = { clientId: uid(1), clientSecret: "PRIVATE-secret&value" };
const now = Date.parse("2026-10-12T12:00:00Z");
const success = {
  access_token: "PRIVATE-access",
  refresh_token: "PRIVATE-rotated",
  token_type: "Bearer",
  scope: "Mail.Read",
  expires_in: 3600,
};
const safe = (code: string) => (e: unknown) =>
  e instanceof MicrosoftCredentialError && e.code === code && !String(e).includes("PRIVATE");
test("Microsoft refresh uses the bound directory, form encoding, read-only scope and refuses redirects", async () => {
  let calls = 0;
  const result = await refreshMicrosoftAccessToken(
    config,
    uid(2),
    "PRIVATE-refresh",
    async (url, init) => {
      calls++;
      assert.equal(url, `https://login.microsoftonline.com/${uid(2)}/oauth2/v2.0/token`);
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      const form = new URLSearchParams(String(init?.body));
      assert.deepEqual(Object.fromEntries(form), {
        client_id: uid(1),
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: "PRIVATE-refresh",
        scope: "https://graph.microsoft.com/Mail.Read",
      });
      return Response.json(success);
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.refreshToken, "PRIVATE-rotated");
  let fetched = false;
  await assert.rejects(
    refreshMicrosoftAccessToken(config, "common", "PRIVATE-refresh", async () => {
      fetched = true;
      return Response.json(success);
    }),
    safe("credential_unavailable"),
  );
  assert.equal(fetched, false);
});
test("refresh handles omitted fields and safely rejects wrong permissions, malformed, oversized and revoked responses", async () => {
  const omitted = { ...success } as any;
  delete omitted.refresh_token;
  delete omitted.scope;
  const result = await refreshMicrosoftAccessToken(config, uid(2), "PRIVATE-refresh", async () =>
    Response.json(omitted),
  );
  assert.equal(result.refreshToken, null);
  assert.equal(result.scope, "https://graph.microsoft.com/Mail.Read");
  for (const body of [
    { ...success, scope: "Mail.ReadBasic" },
    { ...success, token_type: "Basic" },
    { ...success, access_token: "PRIVATE\ninvalid" },
    { ...success, expires_in: 0 },
    { ...success, refresh_token: "" },
  ])
    await assert.rejects(
      refreshMicrosoftAccessToken(config, uid(2), "PRIVATE-refresh", async () =>
        Response.json(body),
      ),
      safe("refresh_failed"),
    );
  await assert.rejects(
    refreshMicrosoftAccessToken(config, uid(2), "PRIVATE-refresh", async () =>
      Response.json(
        { error: "invalid_grant", error_description: "PRIVATE-detail" },
        { status: 400 },
      ),
    ),
    safe("reauthorization_required"),
  );
  await assert.rejects(
    refreshMicrosoftAccessToken(
      config,
      uid(2),
      "PRIVATE-refresh",
      async () => new Response("PRIVATE".repeat(20000)),
    ),
    safe("refresh_failed"),
  );
  await assert.rejects(
    refreshMicrosoftAccessToken(config, uid(2), "PRIVATE-refresh", async () => {
      throw Error("PRIVATE-network");
    }),
    safe("refresh_failed"),
  );
});
const context = {
  tenantId: uid(3),
  accountId: uid(4),
  mailboxId: uid(5),
  bindingId: uid(6),
  kind: "folders" as const,
  folderId: "",
};
const claim = { tenantId: uid(3), jobId: uid(7), claimedBy: "worker", attemptCount: 1 };
function fixture() {
  let saved: any = {
    contract: "microsoft-credential/1",
    ...context,
    clientId: uid(1),
    microsoftTenantId: uid(2),
    tokenId: uid(8),
    updatedAt: new Date(now - 1000).toISOString(),
    accessToken: "PRIVATE-old",
    refreshToken: "PRIVATE-refresh",
    expiresAt: new Date(now - 1).toISOString(),
    scope: "Mail.Read",
    tokenType: "Bearer",
  };
  const calls: any[] = [];
  let refreshes = 0;
  const db = {
    async rpc(name: string, args: Record<string, any>) {
      calls.push({ name, args });
      if (name === "learn_microsoft_credential_refresh") {
        saved = {
          ...saved,
          accessToken: args.p_access,
          refreshToken: args.p_refresh,
          expiresAt: args.p_expires,
        };
        return {
          data: { contract: "microsoft-credential-refresh/1", state: "saved" },
          error: null,
        };
      }
      return { data: structuredClone(saved), error: null };
    },
  };
  const deps = {
    config: () => config,
    now: () => now,
    refresh: async () => {
      refreshes++;
      return {
        accessToken: "PRIVATE-new",
        refreshToken: "PRIVATE-rotated",
        expiresIn: 3600,
        scope: "Mail.Read",
      };
    },
  };
  return {
    db,
    deps,
    calls,
    get saved() {
      return saved;
    },
    get refreshes() {
      return refreshes;
    },
  };
}
test("port persists rotated refresh before using committed access and never refreshes a valid cached token", async () => {
  const f = fixture(),
    ports = createMicrosoftCapturePorts(f.db, f.deps);
  assert.equal(await ports.accessToken(context, claim), "PRIVATE-new");
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "learn_microsoft_credential_read",
      "learn_microsoft_credential_refresh",
      "learn_microsoft_credential_read",
    ],
  );
  assert.equal(f.saved.refreshToken, "PRIVATE-rotated");
  assert.equal(f.calls[1].args.p_old_refresh, "PRIVATE-refresh");
  assert.equal(f.calls[1].args.p_binding, context.bindingId);
  await ports.accessToken(context, claim);
  assert.equal(f.refreshes, 1);
});
test("port rejects foreign binding/client/mailbox/tenant and missing read scope before refresh", async () => {
  for (const [key, value] of [
    ["tenantId", uid(99)],
    ["mailboxId", uid(99)],
    ["bindingId", uid(99)],
    ["clientId", uid(99)],
    ["scope", "Mail.ReadBasic"],
    ["tokenType", 42],
  ]) {
    const f = fixture();
    f.saved[String(key)] = value;
    await assert.rejects(
      createMicrosoftCapturePorts(f.db, f.deps).accessToken(context, claim),
      safe("credential_unavailable"),
    );
    assert.equal(f.refreshes, 0);
  }
});
test("lost credential save acknowledgement stops capture without another refresh; concurrent reconnect wins", async () => {
  const f = fixture(),
    realRpc = f.db.rpc;
  f.db.rpc = async (name, args) => {
    const result = await realRpc(name, args);
    if (name.endsWith("_refresh")) throw Error("PRIVATE-lost");
    return result;
  };
  await assert.rejects(
    createMicrosoftCapturePorts(f.db, f.deps).accessToken(context, claim),
    safe("credential_save_unconfirmed"),
  );
  assert.equal(f.refreshes, 1);
  assert.equal(
    await createMicrosoftCapturePorts(f.db, f.deps).accessToken(context, claim),
    "PRIVATE-new",
  );
  assert.equal(f.refreshes, 1);
  const g = fixture(),
    read = g.db.rpc;
  g.db.rpc = async (name, args) => {
    if (name.endsWith("_refresh")) {
      g.saved.accessToken = "PRIVATE-winner";
      g.saved.refreshToken = "PRIVATE-winner-refresh";
      g.saved.expiresAt = new Date(now + 3600000).toISOString();
      return {
        data: { contract: "microsoft-credential-refresh/1", state: "changed" },
        error: null,
      };
    }
    return read(name, args);
  };
  assert.equal(
    await createMicrosoftCapturePorts(g.db, g.deps).accessToken(context, claim),
    "PRIVATE-winner",
  );
  assert.equal(g.refreshes, 1);
});
test("revocation after refresh blocks returning a credential and omitted replacement retains old refresh", async () => {
  const f = fixture();
  f.deps.refresh = async () => ({
    accessToken: "PRIVATE-new",
    refreshToken: null as any,
    expiresIn: 3600,
    scope: "Mail.Read",
  });
  await createMicrosoftCapturePorts(f.db, f.deps).accessToken(context, claim);
  assert.equal(f.saved.refreshToken, "PRIVATE-refresh");
  const g = fixture(),
    rpc = g.db.rpc;
  let saved = false;
  g.db.rpc = async (name, args) => {
    if (saved) return { data: null, error: { message: "PRIVATE-revoked" } } as any;
    const r = await rpc(name, args);
    if (name.endsWith("_refresh")) saved = true;
    return r;
  };
  await assert.rejects(
    createMicrosoftCapturePorts(g.db, g.deps).accessToken(context, claim),
    safe("credential_unavailable"),
  );
});
test("handler preserves unknown settlements, retry delays and explicit incomplete coverage", async () => {
  const ctx: any = {
    tenantId: claim.tenantId,
    jobId: claim.jobId,
    claim: { claimedBy: claim.claimedBy, attemptCount: 1 },
    jobType: "email.microsoft_discovery",
    supabaseAdmin: {
      rpc: async (_name: string, args: any) => ({
        data: {
          contract: "microsoft-job-stop/1",
          tenantId: claim.tenantId,
          jobId: claim.jobId,
          state: args.p_code === "throttled" ? "retrying" : "recover",
          code: args.p_code,
          attemptCount: 1,
          availableAt: new Date(now + 120000).toISOString(),
          historicalReceipt: false,
        },
        error: null,
      }),
    },
    payload: { accessToken: "PRIVATE-untrusted" },
  };
  const deps: any = {
    ports: () => ({}),
    run: async (_db: any, input: any) => {
      assert.equal(Object.hasOwn(input, "payload"), false);
      return {
        tenantId: ctx.tenantId,
        jobId: ctx.jobId,
        state: "completed",
        observationsStored: 2,
        mailboxCoverage: "unverified",
        sourceReceiptId: uid(9),
        successorId: uid(10),
      };
    },
  };
  const result = await handleMicrosoftCapture(ctx, deps);
  assert.equal(result.queueOutcome?.state, "completed");
  assert.equal(result.result?.coverage_complete, false);
  assert.equal(result.queueOutcome?.historicalReceipt, undefined);
  deps.run = async () => {
    throw new MicrosoftMailError("throttled", 120);
  };
  assert.equal((await handleMicrosoftCapture(ctx, deps)).error?.retryAfterSeconds, 120);
  deps.run = async () => {
    throw new MicrosoftJournalError("settlement_unconfirmed");
  };
  assert.equal((await handleMicrosoftCapture(ctx, deps)).queueOutcome?.state, "unconfirmed");
  deps.run = async () => {
    throw Error("PRIVATE-provider");
  };
  assert.equal(JSON.stringify(await handleMicrosoftCapture(ctx, deps)).includes("PRIVATE"), false);
});
test("foreign or malformed stop receipts cannot be reported as settled by the Microsoft worker", async () => {
  const base = {
    contract: "microsoft-job-stop/1",
    tenantId: claim.tenantId,
    jobId: claim.jobId,
    state: "retrying",
    code: "throttled",
    attemptCount: 1,
    availableAt: new Date(now + 120000).toISOString(),
    historicalReceipt: false,
  };
  for (const patch of [
    { tenantId: uid(99) },
    { jobId: uid(99) },
    { attemptCount: 0 },
    { state: "completed" },
    { code: "PRIVATE" },
    { availableAt: null },
    { historicalReceipt: "false" },
  ]) {
    const ctx: any = {
      tenantId: claim.tenantId,
      jobId: claim.jobId,
      claim,
      jobType: "email.microsoft_sync",
      payload: {},
      supabaseAdmin: { rpc: async () => ({ data: { ...base, ...patch }, error: null }) },
    };
    const r = await handleMicrosoftCapture(ctx, {
      ports: () => ({ accessToken: async () => "unused" }),
      run: async () => {
        throw new MicrosoftMailError("throttled", 120);
      },
    });
    assert.equal(r.queueOutcome?.state, "unconfirmed");
    assert.equal(JSON.stringify(r).includes("PRIVATE"), false);
  }
});
test("unsupported provider retry delays are held for review rather than shortened", async () => {
  const ctx: any = {
    tenantId: claim.tenantId,
    jobId: claim.jobId,
    claim,
    jobType: "email.microsoft_sync",
    payload: {},
    supabaseAdmin: {
      rpc: async (_name: string, args: any) => {
        assert.equal(args.p_code, "retry_delay_requires_review");
        assert.equal(args.p_retry_after, null);
        return {
          data: {
            contract: "microsoft-job-stop/1",
            tenantId: claim.tenantId,
            jobId: claim.jobId,
            state: "failed",
            code: args.p_code,
            attemptCount: 1,
            availableAt: null,
            historicalReceipt: false,
          },
          error: null,
        };
      },
    },
  };
  const result = await handleMicrosoftCapture(ctx, {
    ports: () => ({ accessToken: async () => "unused" }),
    run: async () => {
      throw new MicrosoftMailError("throttled", 31536001);
    },
  });
  assert.equal(result.queueOutcome?.state, "failed");
  assert.equal(result.error?.retryable, false);
});
