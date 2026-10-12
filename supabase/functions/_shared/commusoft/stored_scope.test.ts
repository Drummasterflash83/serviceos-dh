import { test } from "node:test";
import assert from "node:assert/strict";
import { readStoredCommusoftScope } from "./stored_scope.ts";
import { CommusoftReadError } from "./read_page.ts";
import { readApprovedCommusoftPage } from "./bound_page.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-10T12:00:00Z");
function fixture() {
  const cfg = {
    approved: true,
    approvalId: id(6),
    connectionId: id(5),
    consentReference: "synthetic-approval",
    expiresAt: "2026-10-11T00:00:00Z",
    maxPages: 50,
    pageSize: 100,
    resource: "properties",
  };
  const rows: Record<string, any[]> = {
    tenants: [{ id: id(1), status: "active" }],
    feature_flags: ["learn.enabled", "learn.inputs.commusoft.enabled"].map((flag, i) => ({
      id: id(10 + i),
      tenant_id: id(1),
      flag,
      value: true,
    })),
    platform_jobs: [
      {
        id: id(2),
        tenant_id: id(1),
        job_type: "commusoft.source_sync",
        job_key: `commusoft.source:${id(3)}:${id(6)}`,
        status: "running",
        payload: { connector_account_id: id(3) },
        claimed_by: "synthetic-worker",
        attempt_count: 1,
        lease_expires_at: "2026-10-10T12:01:00Z",
      },
    ],
    connector_accounts: [
      {
        id: id(3),
        tenant_id: id(1),
        tenant_connector_id: id(4),
        account_key: "synthetic-account",
        status: "active",
        settings: { commusoft_import: cfg },
        sync_cursor: {},
      },
    ],
    tenant_connectors: [
      {
        id: id(4),
        tenant_id: id(1),
        connector_id: "commusoft",
        provider: "commusoft",
        enabled: true,
        status: "active",
      },
    ],
    provider_connections: [
      {
        id: id(5),
        tenant_id: id(1),
        provider: "commusoft",
        status: "configured",
        auth_mode: "private_api_key",
        revoked_at: null,
        verified_at: "2026-10-10T11:00:00Z",
        updated_at: "2026-10-10T11:00:00Z",
        non_secret_config: { region: "uk", account_key: "synthetic-account" },
        configured_fields: ["api_key"],
        secret_refs: { api_key: id(7) },
      },
    ],
  };
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  const ctx = {
    tenantId: id(1),
    jobId: id(2),
    jobType: "commusoft.source_sync",
    claim: { claimedBy: "synthetic-worker", attemptCount: 1 },
    payload: { connector_account_id: id(999), api_key: "untrusted", region: "us" },
    supabaseAdmin: {
      from(table: string) {
        const filters: [string, unknown][] = [];
        const q = {
          select: (_: string) => q,
          eq: (k: string, v: unknown) => {
            filters.push([k, v]);
            return q;
          },
          maybeSingle: async () => {
            reads.push({ table, filters });
            const matched = (rows[table] ?? []).filter((row) =>
              filters.every(([k, v]) => row[k] === v),
            );
            return {
              data: matched.length === 1 ? structuredClone(matched[0]) : null,
              error: matched.length > 1 ? {} : null,
            };
          },
        };
        return q;
      },
    },
  };
  let acquisitions = 0,
    fetches = 0;
  const deferrals: [string, number][] = [];
  const ports = {
    clock: () => now,
    acquire: async (_: any, __: any): Promise<any> => {
      acquisitions++;
      return { state: "ready", apiKey: "synthetic-key", permitId: id(8), sendBefore: now + 5000 };
    },
    defer: async (permit: string, retry: number) => {
      deferrals.push([permit, retry]);
      return true;
    },
    fetcher: (async () => {
      fetches++;
      return Response.json({ data: [{ id: 1 }], pagination: { hasMore: false, nextCursor: 1 } });
    }) as typeof fetch,
  };
  return {
    ctx,
    rows,
    cfg,
    reads,
    ports,
    deferrals,
    counts: () => ({ acquisitions, fetches }),
    read: () => readStoredCommusoftScope(ctx, () => now),
    run: () => readApprovedCommusoftPage(ctx, ports),
  };
}

test("scope comes from tenant-scoped durable rows, never queued payload", async () => {
  const f = fixture(),
    scope = await f.read();
  assert.ok(scope);
  assert.equal(scope.accountId, id(3));
  assert.equal(scope.request.region, "uk");
  assert.equal(scope.request.after, null);
  assert.equal(scope.pages, 0);
  for (const read of f.reads.filter((r) => r.table !== "tenants"))
    assert.ok(read.filters.some(([k, v]) => k === "tenant_id" && v === id(1)));
});

test("refresh bounds come from stored approval and cannot be supplied by queued payload", async () => {
  const f = fixture();
  const window = {
    updatedFrom: "2026-10-09T00:00:00.000Z",
    updatedBefore: "2026-10-10T00:00:00.000Z",
  };
  Object.assign(f.cfg, window);
  Object.assign(f.rows.platform_jobs[0].payload, { updatedFrom: "1970-01-01T00:00:00.000Z" });
  const scope = await f.read();
  assert.ok(scope);
  assert.equal(scope.request.updatedFrom, window.updatedFrom);
  assert.equal(scope.request.updatedBefore, window.updatedBefore);
  await f.run();
  assert.deepEqual(f.counts(), { acquisitions: 1, fetches: 1 });
});

test("partial durable refresh windows fail before credentials or provider access", async () => {
  for (const change of [
    { updatedFrom: "2026-10-09T00:00:00.000Z" },
    { updatedBefore: "2026-10-10T00:00:00.000Z" },
    { updatedFrom: "2026-10-10T00:00:00.000Z", updatedBefore: "2026-10-09T00:00:00.000Z" },
  ]) {
    const f = fixture();
    Object.assign(f.cfg, change);
    assert.equal(await f.read(), null);
    await assert.rejects(f.run(), (error: any) => error.code === "authority_unavailable");
    assert.deepEqual(f.counts(), { acquisitions: 0, fetches: 0 });
  }
});

test("changed durable refresh bounds invalidate an acquired credential before any provider request", async () => {
  const f = fixture();
  Object.assign(f.cfg, {
    updatedFrom: "2026-10-09T00:00:00.000Z",
    updatedBefore: "2026-10-10T00:00:00.000Z",
  });
  const acquire = f.ports.acquire;
  f.ports.acquire = async (...args) => {
    const permit = await acquire(...args);
    Object.assign(f.cfg, { updatedFrom: "2026-10-08T00:00:00.000Z" });
    return permit;
  };
  await assert.rejects(f.run(), (error: any) => error.code === "authority_unavailable");
  assert.deepEqual(f.counts(), { acquisitions: 1, fetches: 0 });
});

test("authority transport failures at every read boundary stop provider work and remain retryable", async () => {
  for (const failAt of [1, 8, 15, 22, 29]) {
    const f = fixture();
    const from = f.ctx.supabaseAdmin.from;
    let count = 0;
    f.ctx.supabaseAdmin.from = (table) => {
      const query = from(table),
        read = query.maybeSingle;
      query.maybeSingle = async () => {
        const result = await read();
        return ++count === failAt
          ? { data: null, error: { message: "private database response" }, status: 503 }
          : result;
      };
      return query;
    };
    await assert.rejects(f.run(), (error: any) => {
      assert.equal(error.message.includes("private"), false);
      return error.code === "authority_transport_unavailable";
    });
    assert.equal(f.counts().fetches, failAt <= 15 ? 0 : 1);
    assert.equal(count, failAt);
  }
});

test("failed credential acquisition transport never sends a provider request", async () => {
  const f = fixture();
  f.ports.acquire = async () => {
    throw new CommusoftReadError("authority_transport_unavailable");
  };
  await assert.rejects(f.run(), (error: any) => error.code === "authority_transport_unavailable");
  assert.equal(f.counts().fetches, 0);
});

function contactFixture() {
  const f = fixture();
  Object.assign(f.cfg, {
    resource: "propertyContacts",
    contactType: "customer",
    contactPlanVersion: 1,
    firstPropertyId: 42,
    contactTargetCount: 2,
  });
  f.rows.learn_commusoft_contact_targets = [
    {
      tenant_id: id(1),
      connection_id: id(5),
      approval_id: id(6),
      property_id: 42,
      property_type: "customer",
      position: 1,
      next_property_id: 84,
    },
    {
      tenant_id: id(1),
      connection_id: id(5),
      approval_id: id(6),
      property_id: 84,
      property_type: "customer",
      position: 2,
      next_property_id: null,
    },
  ];
  return f;
}
test("contacts bind immutable plan membership before credential acquisition", async () => {
  for (const mutate of [
    (f: ReturnType<typeof contactFixture>) => {
      delete (f.cfg as any).contactPlanVersion;
    },
    (f: ReturnType<typeof contactFixture>) => {
      f.rows.learn_commusoft_contact_targets[0].tenant_id = id(99);
    },
    (f: ReturnType<typeof contactFixture>) => {
      f.rows.learn_commusoft_contact_targets[0].property_type = "workaddress";
    },
    (f: ReturnType<typeof contactFixture>) => {
      f.rows.learn_commusoft_contact_targets[0].position = 2;
    },
    (f: ReturnType<typeof contactFixture>) => {
      f.rows.learn_commusoft_contact_targets[0].next_property_id = null;
    },
  ]) {
    const f = contactFixture();
    mutate(f);
    assert.equal(await f.read(), null);
    await assert.rejects(f.run(), /authority_unavailable/);
    assert.deepEqual(f.counts(), { acquisitions: 0, fetches: 0 });
  }
  const f = contactFixture();
  Object.assign(f.ctx.payload, { propertyId: 99 });
  assert.equal((await f.read())?.request.propertyId, 42);
  f.rows.connector_accounts[0].sync_cursor = {
    approvalId: id(6),
    pages: 2,
    after: null,
    complete: false,
    propertyId: 84,
    propertiesCompleted: 1,
  };
  const scope = await f.read();
  assert.equal(scope?.request.propertyId, 84);
  assert.equal(scope?.request.after, null);
  assert.deepEqual(scope?.contactTarget, {
    propertyId: 84,
    nextPropertyId: null,
    position: 2,
    total: 2,
  });
  f.rows.connector_accounts[0].sync_cursor.propertiesCompleted = 0;
  assert.equal(await f.read(), null);
});

test("client, module, connector, account, approval, lease and credential gates all fail closed", async () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.rows.tenants[0].status = "suspended";
    },
    (f) => {
      f.rows.feature_flags[0].value = false;
    },
    (f) => {
      f.rows.feature_flags[1].value = { enabled: true };
    },
    (f) => {
      f.rows.feature_flags[1].tenant_id = null;
    },
    (f) => {
      f.rows.feature_flags.pop();
    },
    (f) => {
      f.rows.tenant_connectors[0].enabled = false;
    },
    (f) => {
      f.rows.tenant_connectors[0].provider = "other";
    },
    (f) => {
      f.rows.connector_accounts[0].status = "disabled";
    },
    (f) => {
      f.rows.connector_accounts[0].tenant_id = id(99);
    },
    (f) => {
      f.cfg.approved = false;
    },
    (f) => {
      f.cfg.expiresAt = "2026-10-10T12:00:00Z";
    },
    (f) => {
      f.cfg.pageSize = 101;
    },
    (f) => {
      f.cfg.maxPages = 2147483648;
    },
    (f) => {
      f.rows.platform_jobs[0].claimed_by = "another-worker";
    },
    (f) => {
      f.rows.platform_jobs[0].attempt_count = 2;
    },
    (f) => {
      f.rows.platform_jobs[0].lease_expires_at = "2026-10-10T12:00:00Z";
    },
    (f) => {
      f.rows.platform_jobs[0].status = "completed";
    },
    (f) => {
      f.rows.provider_connections[0].revoked_at = "2026-10-10T11:59:00Z";
    },
    (f) => {
      f.rows.provider_connections[0].verified_at = null;
    },
    (f) => {
      f.rows.provider_connections[0].auth_mode = "bearer";
    },
    (f) => {
      f.rows.provider_connections[0].non_secret_config.account_key = "other";
    },
    (f) => {
      f.rows.provider_connections[0].secret_refs.api_key = "not-a-uuid";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.equal(await f.read(), null);
    await assert.rejects(f.run(), /authority_unavailable/);
    assert.deepEqual(f.counts(), { acquisitions: 0, fetches: 0 });
  }
});

test("only the approved checkpoint can resume; exhausted or complete windows issue no request", async () => {
  const f = fixture();
  f.rows.connector_accounts[0].sync_cursor = {
    approvalId: id(6),
    after: 45,
    pages: 1,
    complete: false,
  };
  assert.equal((await f.read())?.request.after, 45);
  for (const change of [
    { approvalId: id(9) },
    { pages: -1 },
    { pages: 0 },
    { after: null },
    { complete: true },
  ]) {
    const g = fixture();
    g.rows.connector_accounts[0].sync_cursor = {
      approvalId: id(6),
      after: 45,
      pages: 1,
      complete: false,
      ...change,
    };
    assert.equal(await g.read(), null);
  }
  for (const saved of [
    { approvalId: id(6), after: null, pages: 1, complete: true },
    { approvalId: id(6), after: 45, pages: 50, complete: false },
  ]) {
    f.rows.connector_accounts[0].sync_cursor = saved;
    await assert.rejects(f.run(), /authority_unavailable/);
  }
  assert.deepEqual(f.counts(), { acquisitions: 0, fetches: 0 });
});

test("successful bound read does not return credentials", async () => {
  const f = fixture(),
    result = await f.run();
  assert.equal(result.page.records[0].id, 1);
  assert.equal(JSON.stringify(result).includes("synthetic-key"), false);
  assert.deepEqual(f.counts(), { acquisitions: 1, fetches: 1 });
});

test("connection rotation during acquisition prevents provider read", async () => {
  const f = fixture(),
    acquire = f.ports.acquire;
  f.ports.acquire = async (...args: any[]) => {
    const result = await acquire(args[0], args[1]);
    f.rows.provider_connections[0].updated_at = "2026-10-10T11:59:00Z";
    return result;
  };
  await assert.rejects(f.run(), /authority_unavailable/);
  assert.deepEqual(f.counts(), { acquisitions: 1, fetches: 0 });
});

test("module disable or checkpoint change during provider request discards returned data", async () => {
  for (const change of ["flag", "cursor", "approval"] as const) {
    const f = fixture(),
      fetcher = f.ports.fetcher;
    f.ports.fetcher = async (...args) => {
      if (change === "flag") f.rows.feature_flags[0].value = false;
      if (change === "cursor")
        f.rows.connector_accounts[0].sync_cursor = {
          approvalId: id(6),
          after: 9,
          pages: 1,
          complete: false,
        };
      if (change === "approval") f.cfg.approvalId = id(99);
      return fetcher(...args);
    };
    await assert.rejects(f.run(), /authority_unavailable/);
  }
});

test("expired send window remains retryable without contacting the provider", async () => {
  const f = fixture();
  f.ports.acquire = async () => ({
    state: "ready",
    apiKey: "synthetic-key",
    permitId: id(8),
    sendBefore: now,
  });
  await assert.rejects(f.run(), (e: any) => e.code === "request_window_expired");
  assert.equal(f.counts().fetches, 0);
});

test("shared permit wait issues no request; throttling persists shared deferral", async () => {
  const f = fixture();
  f.ports.acquire = async () => ({ state: "wait", retryAt: now + 120000 });
  await assert.rejects(
    f.run(),
    (e: any) => e.code === "rate_limited" && e.retryAt === now + 120000,
  );
  assert.equal(f.counts().fetches, 0);
  const g = fixture();
  g.ports.fetcher = async () => Response.json({ error: "private" }, { status: 429 });
  await assert.rejects(g.run(), /rate_limited/);
  assert.deepEqual(g.deferrals, [[id(8), now + 60000]]);
});

test("failed shared deferral never produces success or exposes port errors", async () => {
  const f = fixture();
  f.ports.fetcher = async () =>
    Response.json(
      { data: [], pagination: { hasMore: false, nextCursor: null } },
      { headers: { "X-RateLimit-Remaining": "0" } },
    );
  f.ports.defer = async () => {
    throw Error("private credential-port details");
  };
  await assert.rejects(
    f.run(),
    (e: any) =>
      e.code === "provider_unavailable" &&
      e.message === "provider_unavailable" &&
      e.retryAt === now + 60000,
  );
});
