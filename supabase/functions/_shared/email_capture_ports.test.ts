import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmailCapturePorts } from "./email_capture_ports.ts";
import { GmailCaptureError, DELEGATION_CAPTURE_CODES } from "./gmail_capture_page.ts";
import { refreshGmailAccessToken, RefreshError } from "./gmail_oauth.ts";
import { getDelegatedToken, DelegationError } from "./google_workspace.ts";
import type { EmailJobAttempt } from "./email_job_attempt.ts";
const readScope = "https://www.googleapis.com/auth/gmail.readonly",
  now = Date.parse("2026-10-10T15:00:00.000Z");
const tenant = "00000000-0000-4000-8000-000000000001",
  account = "00000000-0000-4000-8000-000000000002",
  connection = "00000000-0000-4000-8000-000000000003";
const base: EmailJobAttempt = {
  tenantId: tenant,
  accountId: account,
  attemptId: "00000000-0000-4000-8000-000000000004",
  jobId: "00000000-0000-4000-8000-000000000005",
  stream: "recent",
  syncType: "workspace_messages",
  status: "running",
  recordsProcessed: 0,
  recovered: false,
  leaseExpiresAt: new Date(now + 3600000).toISOString(),
  payload: { email_account_id: account },
};
const safeError =
  (code: string, uncertain = false) =>
  (e: unknown) =>
    e instanceof GmailCaptureError &&
    e.code === code &&
    e.persistenceUnknown === uncertain &&
    !e.message.includes("PRIVATE");
function fixture(oauth = false) {
  const attempt = {
    ...base,
    syncType: oauth ? "messages" : "workspace_messages",
  } as EmailJobAttempt;
  const rows: Record<string, any[]> = {
    email_accounts: [
      {
        id: account,
        tenant_id: tenant,
        provider: "gmail",
        email_address: "office_one@example.invalid",
        status: oauth ? "active" : "active_dwd",
        auth_state: "unknown",
        backfill_page_token: null,
        backfill_total_fetched: 0,
      },
    ],
    google_workspace_mailboxes: [
      {
        id: "mailbox",
        tenant_id: tenant,
        connection_id: connection,
        email_address: "office_one@example.invalid",
        status: "pending",
        sync_enabled: true,
        mailbox_type: "user",
      },
    ],
    google_workspace_connections: [
      {
        id: connection,
        tenant_id: tenant,
        domain: "example.invalid",
        status: "active",
        service_account_email: "service@example.iam.gserviceaccount.com",
        service_account_client_id: "123",
        last_verified_at: new Date(now - 60000).toISOString(),
      },
    ],
    email_oauth_tokens: [
      {
        id: "token",
        tenant_id: tenant,
        email_account_id: account,
        provider: "gmail",
        access_token: "PRIVATE-cached",
        refresh_token: "PRIVATE-refresh",
        expires_at: new Date(now + 3600000).toISOString(),
        scope: readScope,
        token_type: "Bearer",
        updated_at: new Date(now - 5000).toISOString(),
      },
    ],
  };
  const queries: any[] = [],
    writes: any[] = [],
    counter = { delegate: 0, refresh: 0, config: 0 },
    behavior = { loseWrite: false };
  const db = {
    rpc: async () => ({
      data: {
        version: "learn-capture-admission/1",
        tenant_id: tenant,
        source: "email",
        allowed: true,
        checked_at: new Date(now).toISOString(),
      },
      error: null,
    }),
    from: (table: string) => {
      const filters: any[] = [],
        state: { patch?: any; columns?: string; limit?: number; single?: boolean } = {};
      const builder: any = {
        select: (columns: string) => {
          state.columns = columns;
          return builder;
        },
        eq: (key: string, value: unknown) => {
          filters.push({ key, value, mode: "eq" });
          return builder;
        },
        ilike: (key: string, value: string) => {
          filters.push({ key, value, mode: "ilike" });
          return builder;
        },
        limit: (n: number) => {
          state.limit = n;
          return builder;
        },
        maybeSingle: () => {
          state.single = true;
          return builder;
        },
        update: (patch: any) => {
          state.patch = patch;
          return builder;
        },
        then: (yes: any, no: any) => {
          queries.push({ table, filters: structuredClone(filters), ...state });
          const found = (rows[table] ?? [])
            .filter((row) =>
              filters.every((f) =>
                f.mode === "eq"
                  ? row[f.key] === f.value
                  : typeof row[f.key] === "string" &&
                    row[f.key].toLowerCase() === f.value.replace(/\\([\\%_])/g, "$1").toLowerCase(),
              ),
            )
            .slice(0, state.limit ?? Infinity);
          if (state.patch)
            for (const row of found) {
              Object.assign(row, state.patch);
              writes.push(structuredClone(state.patch));
            }
          return Promise.resolve({
            data: state.single ? structuredClone(found[0] ?? null) : structuredClone(found),
            error: state.patch && behavior.loseWrite ? { message: "PRIVATE_DB_RESPONSE" } : null,
          }).then(yes, no);
        },
      };
      return builder;
    },
  };
  const deps = {
    clock: () => now,
    workspaceConfig: () => ({
      ok: true as const,
      config: {
        clientEmail: "service@example.iam.gserviceaccount.com",
        privateKey: "PRIVATE-synthetic-key",
        clientId: "123",
      },
    }),
    delegate: async (mailbox: string) => {
      counter.delegate++;
      assert.equal(mailbox, "office_one@example.invalid");
      return { accessToken: "PRIVATE-delegated", scope: readScope, expiresIn: 3600 };
    },
    oauthConfig: () => {
      counter.config++;
      return {
        clientId: "synthetic-client",
        clientSecret: "PRIVATE-client",
        redirectUri: "https://example.invalid/callback",
      };
    },
    refresh: async (_config: any, refresh: string) => {
      counter.refresh++;
      assert.equal(refresh, "PRIVATE-refresh");
      return { accessToken: "PRIVATE-refreshed", expiresIn: 3600, scope: null, tokenType: null };
    },
  };
  return {
    attempt,
    rows,
    queries,
    writes,
    counter,
    behavior,
    db,
    deps,
    ports: createEmailCapturePorts(db, deps),
  };
}
test("Workspace capture resolves the enabled tenant mailbox and rechecks authority before delegation", async () => {
  const f = fixture();
  assert.equal(f.queries.length, 0);
  const source = await f.ports.mailbox(f.attempt);
  assert.equal(JSON.stringify(source).includes("PRIVATE"), false);
  assert.equal(await f.ports.accessToken(f.attempt, source), "PRIVATE-delegated");
  assert.equal(f.counter.delegate, 1);
  assert.equal(f.queries.filter((q) => q.table === "email_accounts").length, 2);
  assert.ok(
    f.queries.every((q) => q.filters.some((x: any) => x.key === "tenant_id" && x.value === tenant)),
  );
  assert.ok(
    f.queries.some((q) =>
      q.filters.some((x: any) => x.mode === "ilike" && x.value === "office\\_one@example.invalid"),
    ),
  );
  assert.deepEqual(await f.ports.admission(tenant), { allowed: true });
});
test("disabled, removed, suspended, ambiguous and foreign Workspace relationships never mint a token", async () => {
  const mutations = [
    (f: any) => (f.rows.google_workspace_mailboxes[0].sync_enabled = false),
    (f: any) => (f.rows.google_workspace_mailboxes[0].status = "removed"),
    (f: any) => (f.rows.google_workspace_mailboxes[0].mailbox_type = "suspended"),
    (f: any) =>
      f.rows.google_workspace_mailboxes.push({
        ...f.rows.google_workspace_mailboxes[0],
        id: "other",
      }),
    (f: any) => (f.rows.google_workspace_connections[0].tenant_id = account),
    (f: any) => (f.rows.google_workspace_connections[0].status = "disabled"),
    (f: any) => (f.rows.google_workspace_connections[0].domain = "foreign.invalid"),
    (f: any) =>
      (f.rows.google_workspace_connections[0].service_account_email = "wrong@example.invalid"),
    (f: any) => (f.rows.google_workspace_connections[0].service_account_client_id = "999"),
    (f: any) => (f.rows.google_workspace_connections[0].last_verified_at = null),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.ports.mailbox(f.attempt), safeError("source_ineligible"));
    assert.equal(f.counter.delegate, 0);
  }
});
test("authority changes after mailbox resolution and fabricated source objects are refused before credentials", async () => {
  const f = fixture(),
    source = await f.ports.mailbox(f.attempt);
  f.rows.google_workspace_mailboxes[0].sync_enabled = false;
  await assert.rejects(f.ports.accessToken(f.attempt, source), safeError("source_ineligible"));
  assert.equal(f.counter.delegate, 0);
  f.rows.google_workspace_mailboxes[0].sync_enabled = true;
  await assert.rejects(
    f.ports.accessToken(f.attempt, { ...source }),
    safeError("source_ineligible"),
  );
  assert.equal(f.counter.delegate, 0);
});
test("OAuth reuses a valid read-authorized cached token without loading client secrets or refreshing", async () => {
  const f = fixture(true),
    source = await f.ports.mailbox(f.attempt);
  assert.equal(await f.ports.accessToken(f.attempt, source), "PRIVATE-cached");
  assert.equal(f.counter.refresh, 0);
  assert.equal(f.counter.config, 0);
  assert.equal(f.writes.length, 0);
  const read = f.queries.find((q) => q.table === "email_oauth_tokens");
  assert.ok(read.filters.some((x: any) => x.key === "tenant_id" && x.value === tenant));
  assert.ok(read.filters.some((x: any) => x.key === "email_account_id" && x.value === account));
});
test("OAuth refresh saves by tenant, mailbox and observed token version without replacing the refresh secret", async () => {
  const f = fixture(true);
  f.rows.email_oauth_tokens[0].expires_at = new Date(now - 1).toISOString();
  const source = await f.ports.mailbox(f.attempt);
  assert.equal(await f.ports.accessToken(f.attempt, source), "PRIVATE-refreshed");
  assert.equal(f.counter.refresh, 1);
  assert.equal(f.writes.length, 1);
  assert.equal("refresh_token" in f.writes[0], false);
  assert.equal(f.writes[0].scope, readScope);
  const write = f.queries.find((q) => q.patch);
  assert.ok(write.filters.some((x: any) => x.key === "updated_at"));
  assert.ok(write.filters.some((x: any) => x.key === "refresh_token"));
  assert.equal(f.rows.email_oauth_tokens[0].refresh_token, "PRIVATE-refresh");
});
test("a concurrent OAuth reconnection wins the comparison and its validated cached token is retained", async () => {
  const f = fixture(true);
  f.rows.email_oauth_tokens[0].expires_at = new Date(now - 1).toISOString();
  f.deps.refresh = async () => {
    f.counter.refresh++;
    Object.assign(f.rows.email_oauth_tokens[0], {
      access_token: "PRIVATE-new-connection",
      refresh_token: "PRIVATE-new-refresh",
      updated_at: new Date(now).toISOString(),
      expires_at: new Date(now + 3600000).toISOString(),
    });
    return {
      accessToken: "PRIVATE-obsolete-refresh",
      expiresIn: 3600,
      scope: null,
      tokenType: null,
    };
  };
  const p = createEmailCapturePorts(f.db, f.deps),
    source = await p.mailbox(f.attempt);
  assert.equal(await p.accessToken(f.attempt, source), "PRIVATE-new-connection");
  assert.equal(f.writes.length, 0);
  assert.equal(f.counter.refresh, 1);
  assert.equal(f.rows.email_oauth_tokens[0].refresh_token, "PRIVATE-new-refresh");
});
test("unknown OAuth cache writes remain uncertain without automatic refresh retries", async () => {
  const f = fixture(true);
  f.rows.email_oauth_tokens[0].expires_at = new Date(now - 1).toISOString();
  f.behavior.loseWrite = true;
  const source = await f.ports.mailbox(f.attempt);
  await assert.rejects(
    f.ports.accessToken(f.attempt, source),
    safeError("persistence_failed", true),
  );
  assert.equal(f.counter.refresh, 1);
  assert.equal(f.writes.length, 1);
});
test("foreign OAuth rows and scopes that cannot read message bodies are refused", async () => {
  const foreign = fixture(true);
  foreign.rows.email_oauth_tokens[0].tenant_id = account;
  const source = await foreign.ports.mailbox(foreign.attempt);
  await assert.rejects(
    foreign.ports.accessToken(foreign.attempt, source),
    safeError("source_ineligible"),
  );
  const missing = fixture(true);
  missing.rows.email_oauth_tokens[0].scope = "https://www.googleapis.com/auth/gmail.send";
  const s = await missing.ports.mailbox(missing.attempt);
  await assert.rejects(
    missing.ports.accessToken(missing.attempt, s),
    safeError("source_ineligible"),
  );
  assert.equal(missing.writes.length, 0);
});
test("classified provider credential failures expose safe capture codes only", async () => {
  const f = fixture(true);
  f.rows.email_oauth_tokens[0].expires_at = null;
  f.deps.refresh = async () => {
    throw new RefreshError("PRIVATE-provider", true);
  };
  const p = createEmailCapturePorts(f.db, f.deps),
    s = await p.mailbox(f.attempt);
  await assert.rejects(p.accessToken(f.attempt, s), safeError("source_ineligible"));
  const d = fixture();
  d.deps.delegate = async () => {
    throw new DelegationError("PRIVATE-provider", false);
  };
  const dp = createEmailCapturePorts(d.db, d.deps),
    ds = await dp.mailbox(d.attempt);
  await assert.rejects(dp.accessToken(d.attempt, ds), safeError("fetch_failed"));
});
test("real OAuth and delegation token helpers disable redirects and set timeouts", async () => {
  const old = globalThis.fetch,
    seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), init });
    return Response.json({
      access_token: "PRIVATE-test-token",
      expires_in: 3600,
      scope: readScope,
      token_type: "Bearer",
    });
  }) as typeof fetch;
  try {
    await refreshGmailAccessToken(
      {
        clientId: "synthetic",
        clientSecret: "PRIVATE-test",
        redirectUri: "https://example.invalid",
      },
      "PRIVATE-refresh",
    );
    const key = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pem =
      "-----BEGIN PRIVATE KEY-----\n" +
      Buffer.from(await crypto.subtle.exportKey("pkcs8", key.privateKey)).toString("base64") +
      "\n-----END PRIVATE KEY-----";
    await getDelegatedToken(
      {
        clientEmail: "synthetic@example.invalid",
        privateKey: pem,
        subject: "office@example.invalid",
        domain: "example.invalid",
      },
      [readScope],
    );
    assert.equal(seen.length, 2);
    for (const call of seen) {
      assert.equal(call.url, "https://oauth2.googleapis.com/token");
      assert.equal(call.init.redirect, "error");
      assert.ok(call.init.signal instanceof AbortSignal);
    }
  } finally {
    globalThis.fetch = old;
  }
});

test("OAuth tokens nearing the bounded page budget are refreshed before capture", async () => {
  const f = fixture(true);
  f.rows.email_oauth_tokens[0].expires_at = new Date(now + 90000).toISOString();
  const source = await f.ports.mailbox(f.attempt);
  assert.equal(await f.ports.accessToken(f.attempt, source), "PRIVATE-refreshed");
  assert.equal(f.counter.refresh, 1);
});

test("permanent Workspace failures retain only allowlisted diagnostics", async () => {
  for (const code of [...DELEGATION_CAPTURE_CODES, "PRIVATE-provider-body"]) {
    const f = fixture();
    f.deps.delegate = async () => {
      throw new DelegationError(code, true);
    };
    const p = createEmailCapturePorts(f.db, f.deps),
      source = await p.mailbox(f.attempt);
    await assert.rejects(
      p.accessToken(f.attempt, source),
      safeError(code === "PRIVATE-provider-body" ? "source_ineligible" : code),
    );
    assert.equal(f.writes.length, 0);
  }
});
