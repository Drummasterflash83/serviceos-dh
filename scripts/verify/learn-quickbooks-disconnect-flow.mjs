/** Disposable PostgreSQL only; actual lifecycle TypeScript and SQL, synthetic HTTP. */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { disconnectQuickBooks } from "../../supabase/functions/_shared/quickbooks/disconnect.ts";
import {
  startQuickBooksAuthorization,
  completeQuickBooksAuthorization,
} from "../../supabase/functions/_shared/quickbooks/oauth_flow.ts";
const container = process.env.SERVICEOS_QB_TEST_CONTAINER;
if (!/^serviceos-quickbooks-oauth-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("isolated fixture required");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (v) =>
  v === null
    ? "null"
    : "'" + String(typeof v === "object" ? JSON.stringify(v) : v).replaceAll("'", "''") + "'";
const sql = (statement) =>
  execFileSync(
    process.env.SERVICEOS_QB_TEST_DOCKER ?? "docker",
    ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const rpc =
  (role, actor = id(10)) =>
  async (name, args) => {
    assert.match(name, /^learn_quickbooks_[a-z_]+$/);
    assert.ok(Object.keys(args).every((k) => /^p_[a-z_]+$/.test(k)));
    try {
      return {
        data: JSON.parse(
          sql(
            `set request.jwt.claim.role=${q(role)};set request.jwt.claim.sub=${q(actor)};set role ${role};select to_jsonb(${name}(${Object.entries(
              args,
            )
              .map(([k, v]) => `${k}=>${q(v)}`)
              .join(",")}));`,
          ),
        ),
        error: null,
      };
    } catch (error) {
      return { data: null, error: String(error.stderr ?? error.message).slice(-1500) };
    }
  };
const user = rpc("authenticated"),
  service = rpc("service_role");
const ok = (r) => {
  assert.equal(r.error, null);
  return r.data;
};
ok(
  await service("learn_quickbooks_register_app", {
    p_id: id(800),
    p_environment: "sandbox",
    p_client_id: "disconnect-synthetic-app",
    p_redirect_uri: "https://example.invalid/quickbooks/callback",
    p_secret: "synthetic-secret",
  }),
);
let requestCounter = 820;
async function connect(connection = id(810), tenant = id(1)) {
  const start = await startQuickBooksAuthorization(
    {
      tenantId: tenant,
      connectionId: connection,
      appId: id(800),
      requestId: id(requestCounter++),
      reason: "Synthetic lifecycle verification",
    },
    user,
  );
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  const result = await completeQuickBooksAuthorization(
    `https://example.invalid/quickbooks/callback?state=${state}&code=synthetic-code&realmId=9911223344`,
    {
      rpc: service,
      minorVersion: 75,
      fetcher: async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes("/tokens/bearer")
              ? {
                  token_type: "bearer",
                  access_token: "synthetic-access",
                  refresh_token: "synthetic-refresh",
                  expires_in: 3600,
                  x_refresh_token_expires_in: 86400,
                }
              : { CompanyInfo: { Id: "1", CompanyName: "Synthetic disconnect company" } },
          ),
          { headers: { "content-type": "application/json" } },
        ),
    },
  );
  assert.equal(result.state, "saved");
}
await connect();
const retained = sql("select count(*) from learn_quickbooks_source_versions");
const revision = () =>
  Number(sql(`select revision from learn_quickbooks_connections where id=${q(id(810))}`));
const input = (n) => ({
  tenantId: id(1),
  connectionId: id(810),
  requestId: id(n),
  revision: revision(),
  reason: "Synthetic operator disconnect",
});
let calls = 0;
const fetcher = async () => {
  calls++;
  return new Response(null, { status: 200 });
};
const first = input(850);
assert.equal(
  (await disconnectQuickBooks(first, { userRpc: user, serviceRpc: service, fetcher })).state,
  "revoked",
);
assert.equal(calls, 1);
assert.equal(
  (await disconnectQuickBooks(first, { userRpc: user, serviceRpc: service, fetcher })).state,
  "revoked",
);
assert.equal(calls, 1);
assert.equal(
  sql(
    `select status='disconnected' and token_secret_id is null from learn_quickbooks_connections where id=${q(id(810))}`,
  ),
  "t",
);
assert.equal(sql("select count(*) from learn_quickbooks_source_versions"), retained);
assert.equal(
  ok(await user("learn_quickbooks_disconnect_status", { p_tenant: id(1) })).requests.find(
    (r) => r.id === id(850),
  ).state,
  "revoked",
);
await connect(); // Same connection/realm retains history after a verified revoke.
const second = input(851);
assert.equal(
  (
    await disconnectQuickBooks(second, {
      userRpc: user,
      serviceRpc: service,
      fetcher: async () => {
        calls++;
        throw Error("network lost");
      },
    })
  ).state,
  "manual_review",
);
assert.equal(calls, 2);
await assert.rejects(
  startQuickBooksAuthorization(
    {
      tenantId: id(1),
      connectionId: id(810),
      appId: id(800),
      requestId: id(870),
      reason: "Unresolved same connection",
    },
    user,
  ),
);
await assert.rejects(
  startQuickBooksAuthorization(
    {
      tenantId: id(2),
      connectionId: id(811),
      appId: id(800),
      requestId: id(871),
      reason: "Unknown realm during uncertain revoke",
    },
    user,
  ),
);
assert.notEqual(
  (
    await service("learn_quickbooks_disconnect_review", {
      p_tenant: id(1),
      p_request: id(851),
      p_reason: "Service must not forge human review",
    })
  ).error,
  null,
);
assert.notEqual(
  (
    await user("learn_quickbooks_disconnect_review", {
      p_tenant: id(2),
      p_request: id(851),
      p_reason: "Wrong tenant review must be rejected",
    })
  ).error,
  null,
);
assert.equal(
  ok(
    await user("learn_quickbooks_disconnect_review", {
      p_tenant: id(1),
      p_request: id(851),
      p_reason: "Synthetic provider connected-apps page checked and grant removed",
    }),
  ).state,
  "reviewed",
);
await connect();
// A second tenant sharing the provider grant must not be silently disconnected.
await connect(id(811), id(2));
const shared = input(852);
assert.equal(
  (await disconnectQuickBooks(shared, { userRpc: user, serviceRpc: service, fetcher })).state,
  "manual_review",
);
assert.equal(
  sql(`select code from learn_quickbooks_disconnections where id=${q(id(852))}`),
  "shared_provider_grant",
);
assert.equal(calls, 2);
assert.equal(
  sql(`select status from learn_quickbooks_connections where id=${q(id(811))}`),
  "awaiting_confirmation",
);
assert.equal(sql("select count(*) from learn_quickbooks_source_versions"), retained);
// Review records a human/provider action, never an API success receipt.
assert.notEqual(
  (
    await user("learn_quickbooks_disconnect_review", {
      p_tenant: id(1),
      p_request: id(852),
      p_reason: "Cannot settle while another shared connection is active",
    })
  ).error,
  null,
);
sql(`update learn_quickbooks_connections set status='disconnected' where id=${q(id(811))}`);
assert.equal(
  ok(
    await user("learn_quickbooks_disconnect_review", {
      p_tenant: id(1),
      p_request: id(852),
      p_reason: "Synthetic owner removed app in QuickBooks and reviewed shared connection",
    }),
  ).state,
  "reviewed",
);
await connect();
const expired = input(853);
ok(
  await user("learn_quickbooks_disconnect_request", {
    p_tenant: expired.tenantId,
    p_connection: expired.connectionId,
    p_request: expired.requestId,
    p_revision: expired.revision,
    p_reason: expired.reason,
  }),
);
const lease = ok(await service("learn_quickbooks_disconnect_acquire", { p_request: id(853) }));
assert.equal(lease.state, "ready");
assert.equal(
  ok(await service("learn_quickbooks_disconnect_acquire", { p_request: id(853) })).state,
  "revoking",
);
sql(
  `update learn_quickbooks_disconnections set lease_until=clock_timestamp()-interval '1 second' where id=${q(id(853))}`,
);
assert.equal(
  ok(
    await service("learn_quickbooks_disconnect_current", {
      p_request: id(853),
      p_lease: lease.leaseId,
    }),
  ),
  false,
);
assert.equal(
  ok(await service("learn_quickbooks_disconnect_acquire", { p_request: id(853) })).state,
  "manual_review",
);
assert.notEqual(
  (
    await service("learn_quickbooks_disconnect_finish", {
      p_request: id(853),
      p_lease: lease.leaseId,
      p_revoked: true,
    })
  ).error,
  null,
);
sql(
  "select fixture_assert(not has_table_privilege('authenticated','learn_quickbooks_disconnections','select'),'no direct user reads');select fixture_assert(not has_table_privilege('service_role','learn_quickbooks_disconnections','select'),'no direct service reads');select fixture_assert(not has_function_privilege('authenticated','learn_quickbooks_disconnect_acquire(uuid)','execute'),'no user credential release');",
);
assert.notEqual(
  (await rpc("authenticated", id(11))("learn_quickbooks_disconnect_status", { p_tenant: id(1) }))
    .error,
  null,
);
assert.equal(sql("select count(*) from learn_quickbooks_source_versions"), retained);
ok(
  await user("learn_quickbooks_disconnect_review", {
    p_tenant: id(1),
    p_request: id(853),
    p_reason: "Synthetic provider removal verified after the expired request",
  }),
);
await connect();
const race = input(854);
ok(
  await user("learn_quickbooks_disconnect_request", {
    p_tenant: race.tenantId,
    p_connection: race.connectionId,
    p_request: race.requestId,
    p_revision: race.revision,
    p_reason: race.reason,
  }),
);
console.log(
  "PASS: actual TypeScript/SQL disconnect, one-shot revoke, preserved sources, replay, reconnect, uncertain review, cross-tenant shared-grant fencing, expiry and permissions.",
);
